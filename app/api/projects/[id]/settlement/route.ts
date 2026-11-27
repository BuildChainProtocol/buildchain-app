import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Wallet, xrpToDrops } from 'xrpl'
import { getConnectedClient } from '@/lib/xrpl/client'
import { isTestnet } from '@/lib/xrpl/escrow'
import { buildchainAddress, settlementToken } from '@/lib/xrpl/release'
import { issuerAllowsEscrow, setUpLoanAccount, submitAndConfirm, tokenBalance, verifyLoanAccount } from '@/lib/xrpl/settlement'

// An admin chooses how a project's draws settle, and for the two-signature
// method opens the loan's ledger account.
//   GET   the method, and what the ledger says about it right now
//   POST  { method } set it; for two_signature, create the loan account if there is none
export const runtime = 'nodejs'
export const maxDuration = 60

const METHODS = ['test_xrp', 'token_escrow', 'two_signature']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(id: string): Promise<{ supabase: any; project: any } | NextResponse> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((profile as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data: project } = await supabase
    .from('projects').select('id, name, settlement_method, loan_account, lenders ( xrp_address, company_name )')
    .eq('id', id).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  return { supabase, project }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { project } = loaded
  const lenderWallet = project.lenders?.xrp_address ?? null
  const out: Record<string, unknown> = {
    method: project.settlement_method ?? 'test_xrp',
    loanAccount: project.loan_account ?? null,
    lenderWallet,
    network: isTestnet() ? 'testnet' : 'mainnet',
    tokenConfigured: !!process.env.SETTLEMENT_TOKEN_ISSUER,
  }
  if (!process.env.SETTLEMENT_TOKEN_ISSUER) return NextResponse.json(out)
  try {
    const token = settlementToken()
    const client = await getConnectedClient()
    try {
      out.token = token
      out.issuerAllowsEscrow = await issuerAllowsEscrow(client, token.issuer)
      if (lenderWallet) out.lenderBalance = await tokenBalance(client, lenderWallet, token)
      if (project.loan_account && lenderWallet) {
        out.loanAccountProblems = await verifyLoanAccount(client, project.loan_account, {
          lender: lenderWallet, buildchain: buildchainAddress(), token,
        })
        out.loanAccountBalance = await tokenBalance(client, project.loan_account, token)
      }
    } finally { await client.disconnect() }
  } catch (err) {
    out.ledgerError = err instanceof Error ? err.message.slice(0, 200) : 'Ledger lookup failed'
  }
  return NextResponse.json(out)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const loaded = await load(params.id)
  if (loaded instanceof NextResponse) return loaded
  const { supabase, project } = loaded
  const body = await req.json().catch(() => ({}))
  const method = String(body?.method ?? '')
  if (!METHODS.includes(method)) return NextResponse.json({ error: `method must be one of: ${METHODS.join(', ')}` }, { status: 400 })

  const { count } = await supabase.from('draw_requests').select('id', { count: 'exact', head: true })
    .eq('project_id', project.id).in('settlement_state', ['awaiting_lender_signature', 'locked'])
  if (count) return NextResponse.json({ error: 'This project has a draw waiting on a signature or a release. Finish it before changing the method.' }, { status: 409 })

  let loanAccount: string | null = project.loan_account ?? null
  try {
    if (method !== 'test_xrp') {
      const token = settlementToken()
      const lenderWallet = project.lenders?.xrp_address
      if (!lenderWallet) return NextResponse.json({ error: 'The lender has not connected a wallet yet' }, { status: 409 })
      if (!isTestnet() && process.env.SETTLEMENT_MAINNET_ENABLED !== 'true') {
        return NextResponse.json({ error: 'Dollar-token settlement on mainnet is switched off' }, { status: 409 })
      }
      const client = await getConnectedClient()
      try {
        if (method === 'token_escrow' && !(await issuerAllowsEscrow(client, token.issuer))) {
          return NextResponse.json({ error: 'The token\'s issuer has not enabled escrow for it. Use the two-signature method.' }, { status: 409 })
        }
        if (method === 'two_signature' && !loanAccount) {
          // A new account whose key is used only to set it up and is never stored:
          // once its master key is disabled, only the two signers together control it.
          const seed = process.env.XRPL_WALLET_SEED
          if (!seed) throw new Error('XRPL_WALLET_SEED is not set in environment variables')
          const platform = Wallet.fromSeed(seed)
          const loan = Wallet.generate()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fund: any = await client.autofill({
            TransactionType: 'Payment', Account: platform.address, Destination: loan.address,
            Amount: xrpToDrops(process.env.LOAN_ACCOUNT_RESERVE_XRP ?? '10'),
          })
          await submitAndConfirm(client, platform.sign(fund).tx_blob)
          await setUpLoanAccount(client, loan, {
            lender: lenderWallet, buildchain: platform.address, token,
            tickets: Math.min(40, Math.max(1, parseInt(process.env.LOAN_ACCOUNT_TICKETS ?? '20', 10) || 20)),
          })
          loanAccount = loan.address
        }
      } finally { await client.disconnect() }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 300) : 'Ledger error' }, { status: 502 })
  }

  const { error } = await supabase.from('projects')
    .update({ settlement_method: method, loan_account: loanAccount }).eq('id', project.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await supabase.from('activity_log').insert({
    project_id: project.id, action: 'settlement_method_set', entity_type: 'project', entity_id: project.id,
    details: { method, loan_account: loanAccount },
  })
  return NextResponse.json({ method, loanAccount })
}
