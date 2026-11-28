/**
 * Tell the owner when something needs a person.
 *
 * Until now a failed release, a refused notice to Building Block or a missing
 * fee line was a line in the hosting logs that nobody reads. An alert is
 * written to every admin's notifications and emailed to the admins (and to
 * ALERT_EMAIL when set). It never throws: reporting a problem must not cause
 * another one.
 */

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function alertOwner(o: {
  /** short, plain: "A draw could not be released" */
  title: string
  /** what happened and what to do, in a sentence or two */
  body: string
  /** a path inside the site to open, e.g. "/admin/draws" */
  link?: string
  /** extra facts for the email */
  details?: Record<string, unknown>
}): Promise<void> {
  console.error(`[ALERT] ${o.title}: ${o.body}`, o.details ?? '')
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return
    const admin = createClient(url, key, { auth: { persistSession: false } })
    const { data: admins } = await admin.from('profiles').select('id, email').eq('role', 'admin')
    const rows = (admins ?? []) as Array<{ id: string; email: string | null }>

    if (rows.length) {
      await admin.from('notifications').insert(rows.map(a => ({
        user_id: a.id, type: 'system_alert', title: o.title.slice(0, 120), body: o.body.slice(0, 500),
        link: o.link && /^\/[A-Za-z0-9]/.test(o.link) ? o.link : '/admin',
      })))
    }

    const to = Array.from(new Set([
      ...rows.map(a => a.email).filter((e): e is string => !!e),
      ...(process.env.ALERT_EMAIL ? [process.env.ALERT_EMAIL] : []),
    ]))
    const facts = Object.entries(o.details ?? {})
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5b6573">${esc(k)}</td><td style="padding:4px 0;font-family:monospace">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</td></tr>`)
      .join('')
    for (const address of to) {
      await sendEmail({
        to: address,
        subject: `BuildChain needs attention: ${o.title}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
          <h2 style="margin:0 0 8px">${esc(o.title)}</h2>
          <p style="margin:0 0 16px">${esc(o.body)}</p>
          ${facts ? `<table style="font-size:13px;border-collapse:collapse">${facts}</table>` : ''}
        </div>`,
      })
    }
  } catch (err) {
    console.error('[ALERT] could not be delivered:', err instanceof Error ? err.message : err)
  }
}
