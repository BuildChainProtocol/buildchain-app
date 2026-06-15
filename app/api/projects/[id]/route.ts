import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Node.js runtime required for XRPL dynamic imports
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      borrowers(id, company_name, contact_name, email, phone, rating, license_number, license_state),
      lenders(id, company_name, contact_name, email, phone, max_ltv, loan_types),
      draw_requests(id, request_number, amount, phase, purpose, status, submitted_at, funded_at, escrow_txn_hash, escrow_finish_hash),
      documents(id, name, doc_type, status, required, file_name, file_size, storage_path, uploaded_at)
    `)
    .eq('id', params.id)
    .order('created_at', { referencedTable: 'draw_requests', ascending: false })
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  // Fetch activity log separately to avoid nested join permission issues
  const { data: activity } = await supabase
    .from('activity_log')
    .select('id, action, details, created_at, user_id, profiles(full_name)')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })
    .limit(50)
  return NextResponse.json({ data: { ...data, activity_log: activity || [] } })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch current project state so we can detect stage transitions
  const { data: current } = await supabase
    .from('projects')
    .select('stage, loan_nft_token_id')
    .eq('id', params.id)
    .single()

  const { data, error } = await supabase
    .from('projects')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await supabase.from('activity_log').insert({
    project_id: params.id,
    user_id: user.id,
    action: 'project_updated',
    entity_type: 'project',
    entity_id: params.id,
    details: body,
  })

  // ─── XRPL: Burn loan NFT when loan completes (proof of settlement) ─────────
  const isCompletingNow = body.stage === 'complete' && current?.stage !== 'complete'
  if (isCompletingNow && current?.loan_nft_token_id) {
    try {
      const { isXrplConfigured, completeLoanNFT } = await import('@/lib/xrpl/nft')
      if (isXrplConfigured()) {
        const result = await completeLoanNFT({ nftTokenId: current.loan_nft_token_id })

        await supabase.from('projects').update({
          loan_nft_burn_hash: result.txnHash,
        }).eq('id', params.id)

        await supabase.from('activity_log').insert({
          project_id: params.id,
          user_id: user.id,
          action: 'loan_nft_burned',
          entity_type: 'project',
          entity_id: params.id,
          details: { burn_hash: result.txnHash, nft_token_id: current.loan_nft_token_id },
        })

        console.log(`[XRPL] Loan NFT burned (loan complete) — hash ${result.txnHash}`)
      }
    } catch (nftError) {
      const message = nftError instanceof Error ? nftError.message : String(nftError)
      console.warn('[XRPL] Loan NFT burn skipped (non-fatal):', message.slice(0, 200))
    }
  }

  return NextResponse.json({ data })
}
