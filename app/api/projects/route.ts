import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Node.js runtime required for XRPL (WebSocket + dynamic import of xrpl)
export const runtime = 'nodejs'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('projects')
    .select(`*, borrowers(company_name, contact_name, email), lenders(company_name, contact_name)`)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const body = await request.json()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Generate loan number
  const loanNumber = `LN-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`

  const { data, error } = await supabase
    .from('projects')
    .insert({ ...body, loan_number: loanNumber })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Create default required documents
  const defaultDocs = [
    { name: 'Executed Loan Agreement', doc_type: 'loan_agreement', required: true },
    { name: 'Title Commitment', doc_type: 'title_commitment', required: true },
    { name: 'Approved Plans & Permits', doc_type: 'plans_permits', required: true },
    { name: 'Insurance Certificate', doc_type: 'insurance', required: true },
  ]

  await supabase.from('documents').insert(defaultDocs.map(d => ({ ...d, project_id: data.id })))

  await supabase.from('activity_log').insert({
    project_id: data.id,
    user_id: user.id,
    action: 'project_created',
    entity_type: 'project',
    entity_id: data.id,
    details: { name: body.name },
  })

  // ─── XRPL: Mint loan NFT (optional — non-fatal if XRPL unavailable) ────────
  // Fetch borrower + lender names for the NFT metadata before minting.
  // This runs after the project is created so a failure here never blocks origination.
  try {
    const { isXrplConfigured, mintLoanNFT } = await import('@/lib/xrpl/nft')
    if (isXrplConfigured()) {
      const [{ data: borrower }, { data: lender }] = await Promise.all([
        supabase.from('borrowers').select('company_name').eq('id', body.borrower_id).single(),
        supabase.from('lenders').select('company_name').eq('id', body.lender_id).single(),
      ])

      const nft = await mintLoanNFT({
        projectId: data.id,
        loanNumber: loanNumber,
        projectName: body.name,
        propertyAddress: [body.address, body.city, body.state, body.zip].filter(Boolean).join(', '),
        borrowerName: borrower?.company_name ?? 'Unknown Borrower',
        lenderName: lender?.company_name ?? 'Unknown Lender',
        loanAmount: body.loan_amount,
        interestRate: body.interest_rate ?? null,
        maturityDate: body.maturity_date ?? null,
      })

      // Persist the NFT token ID and mint hash on the project record
      await supabase.from('projects').update({
        loan_nft_token_id: nft.nftTokenId,
        loan_nft_mint_hash: nft.txnHash,
      }).eq('id', data.id)

      await supabase.from('activity_log').insert({
        project_id: data.id,
        user_id: user.id,
        action: 'loan_nft_minted',
        entity_type: 'project',
        entity_id: data.id,
        details: { nft_token_id: nft.nftTokenId, mint_hash: nft.txnHash },
      })

      console.log(`[XRPL] Loan NFT minted — tokenId ${nft.nftTokenId}`)
    } else {
      console.log('[XRPL] Not configured — loan created without NFT')
    }
  } catch (nftError) {
    const message = nftError instanceof Error ? nftError.message : String(nftError)
    console.warn('[XRPL] Loan NFT mint skipped (non-fatal):', message.slice(0, 200))
  }

  return NextResponse.json({ data }, { status: 201 })
}
