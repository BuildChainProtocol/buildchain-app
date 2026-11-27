import { createClient } from '@/lib/supabase/server'
import { serviceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

// Node.js runtime: the xrpl package is loaded to check a wallet address.
export const runtime = 'nodejs'

/**
 * PATCH /api/borrowers/[id]   (admin only)
 *
 * Edits a borrower (general contractor) record, or links / unlinks the
 * account that signs in as it. Only the fields named below are read from the
 * request.
 *
 * Body (all optional, at least one needed):
 *   company_name, contact_name, email, phone, active,
 *   license_number, license_state, rating,
 *   xrp_address: string | null   must be a valid classic address; null clears
 *   link_email: string           link the existing borrower account with this email
 *   unlink: true                 remove the linked account
 */

const TABLE = 'borrowers'
const KIND = 'borrower'
const RATINGS = ['preferred', 'standard', 'new', 'probation']
// A draw in one of these states is waiting on, or locked by, a lender signature.
const IN_FLIGHT = ['awaiting_lender_signature', 'locked']

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

/** '' and null clear the field; a string is trimmed; anything else is refused. */
function optionalText(v: unknown, max = 300): string | null | undefined {
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max)
  return t === '' ? null : t
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail('Unauthorized', 401)

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if ((me as { role?: string } | null)?.role !== 'admin') return fail('Forbidden', 403)

  let raw: Record<string, unknown>
  try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Invalid JSON body', 400)

  if (has(raw, 'link_email') && raw.unlink === true) {
    return fail('Send link_email or unlink, not both', 400)
  }

  // The caller is an admin (checked above), so the service key may be used.
  let admin
  try { admin = serviceClient() } catch (e) {
    return fail(e instanceof Error ? e.message : 'The server is not configured for this', 500)
  }

  const { data: record, error: readErr } = await admin
    .from(TABLE).select('id, company_name, email, profile_id').eq('id', params.id).maybeSingle()
  if (readErr) return fail(readErr.message, 500)
  if (!record) return fail('Borrower not found', 404)

  // ── Named fields only ─────────────────────────────────────────────────────
  const updates: Record<string, unknown> = {}

  if (has(raw, 'company_name')) {
    const v = optionalText(raw.company_name)
    if (!v) return fail('Company name cannot be empty', 400)
    updates.company_name = v
  }
  for (const k of ['contact_name', 'phone', 'license_number', 'license_state'] as const) {
    if (has(raw, k)) {
      const v = optionalText(raw[k], k === 'license_state' ? 20 : 300)
      if (v === undefined) return fail(`${k} must be text`, 400)
      updates[k] = v
    }
  }
  if (has(raw, 'email')) {
    const v = optionalText(raw.email)
    if (v === undefined) return fail('email must be text', 400)
    if (v !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return fail('That email address is not valid', 400)
    updates.email = v
  }
  if (has(raw, 'active')) {
    if (typeof raw.active !== 'boolean') return fail('active must be true or false', 400)
    updates.active = raw.active
  }
  if (has(raw, 'rating')) {
    if (raw.rating === null || raw.rating === '') {
      updates.rating = null
    } else if (typeof raw.rating === 'string' && RATINGS.includes(raw.rating)) {
      updates.rating = raw.rating
    } else {
      return fail(`rating must be one of: ${RATINGS.join(', ')}`, 400)
    }
  }
  if (has(raw, 'xrp_address')) {
    if (raw.xrp_address === null || raw.xrp_address === '') {
      updates.xrp_address = null
    } else {
      const address = typeof raw.xrp_address === 'string' ? raw.xrp_address.trim() : ''
      const { isValidClassicAddress } = await import('xrpl')
      if (!address || !isValidClassicAddress(address)) {
        return fail('That is not a valid XRP Ledger address (it starts with r)', 400)
      }
      updates.xrp_address = address
    }
  }

  // ── Link an existing account ──────────────────────────────────────────────
  let logAction: 'record_linked' | 'record_unlinked' | null = null
  let logEmail: string | null = null
  let logProfileId: string | null = null

  if (has(raw, 'link_email')) {
    const email = typeof raw.link_email === 'string' ? raw.link_email.trim() : ''
    if (!email) return fail('Enter the email of the account to link', 400)

    // Case-insensitive match. The pattern is escaped, and the result is
    // compared again here, so only an exact match (ignoring case) counts.
    const pattern = email.replace(/[\\%_]/g, '\\$&')
    const { data: found, error: findErr } = await admin
      .from('profiles').select('id, email, role').ilike('email', pattern)
    if (findErr) return fail(findErr.message, 500)
    const matches = ((found ?? []) as { id: string; email: string | null; role: string }[])
      .filter(p => (p.email ?? '').toLowerCase() === email.toLowerCase())

    if (matches.length === 0) {
      return fail(`No account exists with the email ${email}. Send an invitation instead.`, 404)
    }
    if (matches.length > 1) {
      return fail(`More than one account uses the email ${email}, so it cannot be linked by email`, 409)
    }
    const account = matches[0]
    if (account.role !== KIND) {
      return fail(`The account ${account.email} is a ${account.role} account. A borrower record needs a borrower account.`, 409)
    }
    if (record.profile_id && record.profile_id !== account.id) {
      return fail('This borrower is already linked to a different account. Unlink it first.', 409)
    }
    const { data: other, error: otherErr } = await admin
      .from(TABLE).select('id, company_name').eq('profile_id', account.id).neq('id', params.id).limit(1)
    if (otherErr) return fail(otherErr.message, 500)
    if (other && other.length > 0) {
      return fail(`The account ${account.email} is already linked to another borrower (${other[0].company_name}). Unlink it there first.`, 409)
    }

    if (record.profile_id !== account.id) {
      updates.profile_id = account.id
      logAction = 'record_linked'
      logEmail = account.email
      logProfileId = account.id
    }
  }

  // ── Unlink ────────────────────────────────────────────────────────────────
  if (raw.unlink === true && record.profile_id) {
    const { data: projects, error: projErr } = await admin
      .from('projects').select('id').eq('borrower_id', params.id)
    if (projErr) return fail(projErr.message, 500)
    const projectIds = ((projects ?? []) as { id: string }[]).map(p => p.id)
    if (projectIds.length > 0) {
      const { data: inFlight, error: drawErr } = await admin
        .from('draw_requests').select('id, request_number')
        .in('project_id', projectIds).in('settlement_state', IN_FLIGHT).limit(1)
      if (drawErr) return fail(drawErr.message, 500)
      if (inFlight && inFlight.length > 0) {
        return fail(
          `Draw ${inFlight[0].request_number ?? inFlight[0].id} on one of this borrower's projects is waiting on or locked by a lender signature. Settle or withdraw it before unlinking the account.`,
          409
        )
      }
    }
    const { data: prior } = await admin.from('profiles').select('email').eq('id', record.profile_id).maybeSingle()
    updates.profile_id = null
    logAction = 'record_unlinked'
    logEmail = (prior as { email?: string | null } | null)?.email ?? null
    logProfileId = record.profile_id
  }

  const linkOnly = has(raw, 'link_email') || raw.unlink === true
  if (Object.keys(updates).length === 0) {
    if (!linkOnly) return fail('Nothing to update', 400)
    // Already in the state that was asked for (same account linked, or nothing to unlink).
  }

  let row = record
  if (Object.keys(updates).length > 0) {
    const { data: updated, error: updErr } = await admin
      .from(TABLE).update(updates).eq('id', params.id).select().single()
    if (updErr) return fail(updErr.message, 400)
    row = updated
  } else {
    const { data: full } = await admin.from(TABLE).select('*').eq('id', params.id).single()
    if (full) row = full
  }

  if (logAction) {
    const { error: logErr } = await admin.from('activity_log').insert({
      project_id: null,
      user_id: user.id,
      action: logAction,
      entity_type: KIND,
      entity_id: params.id,
      details: { email: logEmail, profile_id: logProfileId, company_name: row.company_name },
    })
    if (logErr) console.warn(`[borrowers] ${logAction} was not logged:`, logErr.message)
  }

  let accountEmail: string | null = null
  if (row.profile_id) {
    const { data: acct } = await admin.from('profiles').select('email').eq('id', row.profile_id).maybeSingle()
    accountEmail = (acct as { email?: string | null } | null)?.email ?? null
  }

  return NextResponse.json({ data: { ...row, account_email: accountEmail } })
}
