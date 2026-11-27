/**
 * Proves both dollar-token release methods in lib/xrpl/settlement.ts end to
 * end on the XRP Ledger TEST network, with throwaway faucet wallets and a
 * test dollar token issued by one of them (real RLUSD cannot be escrowed yet).
 *
 *   node scripts/prove-rlusd-settlement.js
 *
 * No real funds, no stored keys: every wallet is created for the run and
 * forgotten when it ends. Only addresses and transaction hashes are printed.
 */
const { execFileSync } = require('child_process')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const out = path.join(root, 'node_modules', '.cache', 'settlement-proof')
fs.mkdirSync(out, { recursive: true })
try {
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(root, 'lib', 'xrpl', 'settlement.ts'),
    '--outDir', out, '--module', 'commonjs', '--target', 'es2020',
    '--skipLibCheck', '--esModuleInterop', '--moduleResolution', 'node',
  ], { stdio: 'pipe' })
} catch (e) { /* type complaints do not stop the emit */ }
const S = require(path.join(out, 'settlement.js'))
const { Client } = require('xrpl')

const TESTNET = 'wss://s.altnet.rippletest.net:51233'
let passed = 0
function ok(label, cond, detail) {
  if (!cond) { console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); process.exitCode = 1; throw new Error('proof failed: ' + label) }
  passed++; console.log(`ok    ${label}${detail ? ' — ' + detail : ''}`)
}
async function expectRefused(label, fn) {
  try { await fn() } catch (e) { passed++; console.log(`ok    ${label} — refused (${String(e.message).slice(0, 60)})`); return }
  console.error(`FAIL  ${label} — it was accepted`); process.exitCode = 1; throw new Error('proof failed: ' + label)
}
async function send(client, wallet, tx) {
  const prepared = await client.autofill(tx)
  const { tx_blob } = wallet.sign(prepared)
  const done = await S.submitAndConfirm(client, tx_blob)
  return { hash: done.hash, sequence: prepared.Sequence }
}
function condition() {
  const preimage = crypto.randomBytes(32)
  const fp = crypto.createHash('sha256').update(preimage).digest('hex')
  return {
    condition: ('A0258020' + fp + '810120').toUpperCase(),
    fulfillment: ('A0228020' + preimage.toString('hex')).toUpperCase(),
  }
}

async function main() {
  const client = new Client(TESTNET)
  await client.connect()
  console.log('Connected to the XRPL test network. Creating throwaway wallets…')
  const fund = async () => (await client.fundWallet()).wallet
  const issuer = await fund(), lender = await fund(), payee = await fund(), bc = await fund(), loan = await fund()
  console.log(`issuer ${issuer.address}\nlender ${lender.address}\npayee  ${payee.address}\nBuildChain ${bc.address}\nloan account ${loan.address}\n`)

  // A test dollar token under the RLUSD currency code, issued by our own test issuer.
  const token = { currency: 'RLUSD', issuer: issuer.address }
  await send(client, issuer, { TransactionType: 'AccountSet', Account: issuer.address, SetFlag: 8 })
  ok('before the issuer opts in, the token is not escrowable', !(await S.issuerAllowsEscrow(client, issuer.address)))
  await send(client, issuer, { TransactionType: 'AccountSet', Account: issuer.address, SetFlag: S.ASF_ALLOW_TRUST_LINE_LOCKING })
  ok('issuer enabled Allow Trust Line Locking', await S.issuerAllowsEscrow(client, issuer.address))
  for (const w of [lender, payee]) {
    await send(client, w, { TransactionType: 'TrustSet', Account: w.address,
      LimitAmount: { currency: S.currencyCode('RLUSD'), issuer: issuer.address, value: '1000000000' } })
  }
  await send(client, issuer, { TransactionType: 'Payment', Account: issuer.address, Destination: lender.address,
    Amount: S.tokenAmount(token, 500000) })
  ok('lender holds 500,000.00 test dollars', Number(await S.tokenBalance(client, lender.address, token)) === 500000)

  // ── Method A: native token escrow ────────────────────────────────────────
  console.log('\nMethod A — native token escrow, signed by the lender')
  const draw1 = 84250.75
  const c1 = condition()
  const cancelAfter = new Date(Date.now() + 90 * 24 * 3600 * 1000)
  const createTx = S.buildLenderEscrowCreate({ lender: lender.address, payee: payee.address, token, usd: draw1,
    condition: c1.condition, cancelAfter, drawRequestId: 'proof-draw-1' })
  const created = await send(client, lender, createTx)          // the lender's own signature
  console.log(`      EscrowCreate ${created.hash}`)
  ok('lender balance fell by the draw while it is locked',
    Number(await S.tokenBalance(client, lender.address, token)) === 500000 - draw1)
  ok('BuildChain verifies the lender\'s escrow against the draw',
    (await S.verifyLenderEscrow(client, { owner: lender.address, sequence: created.sequence, payee: payee.address,
      token, usd: draw1, condition: c1.condition, minCancelAfter: new Date(Date.now() + 80 * 24 * 3600 * 1000) })).length === 0)
  ok('a wrong amount is caught by the same check',
    (await S.verifyLenderEscrow(client, { owner: lender.address, sequence: created.sequence, payee: payee.address,
      token, usd: draw1 + 1, condition: c1.condition })).length === 1)
  await expectRefused('nobody can release it without BuildChain\'s fulfillment', () =>
    send(client, payee, { TransactionType: 'EscrowFinish', Account: payee.address, Owner: lender.address, OfferSequence: created.sequence }))
  await expectRefused('the lender cannot cancel before the deadline', () =>
    send(client, lender, { TransactionType: 'EscrowCancel', Account: lender.address, Owner: lender.address, OfferSequence: created.sequence }))
  const fin = await S.finishTokenEscrow(client, bc, { owner: lender.address, sequence: created.sequence,
    condition: c1.condition, fulfillment: c1.fulfillment, drawRequestId: 'proof-draw-1' })
  console.log(`      EscrowFinish ${fin.hash}`)
  ok('payee received exactly the draw in test dollars', Number(await S.tokenBalance(client, payee.address, token)) === draw1,
    await S.tokenBalance(client, payee.address, token))

  // An unreleased escrow goes back to the lender after its deadline.
  const draw2 = 1000
  const c2 = condition()
  const soon = new Date(Date.now() + 20 * 1000)
  const created2 = await send(client, lender, S.buildLenderEscrowCreate({ lender: lender.address, payee: payee.address,
    token, usd: draw2, condition: c2.condition, cancelAfter: soon, drawRequestId: 'proof-draw-2' }))
  const before = Number(await S.tokenBalance(client, lender.address, token))
  console.log('      waiting for the cancel deadline (about 40 s)…')
  await new Promise(r => setTimeout(r, 40000))
  await send(client, lender, { TransactionType: 'EscrowCancel', Account: lender.address, Owner: lender.address, OfferSequence: created2.sequence })
  ok('after the deadline the lender gets an unreleased draw back',
    Number(await S.tokenBalance(client, lender.address, token)) === before + draw2)

  // ── Method B: two-signature loan account ─────────────────────────────────
  console.log('\nMethod B — two-signature loan account')
  const setup = await S.setUpLoanAccount(client, loan, { lender: lender.address, buildchain: bc.address, token, tickets: 3 })
  ok('loan account passes the on-ledger check a lender would run',
    (await S.verifyLoanAccount(client, loan.address, { lender: lender.address, buildchain: bc.address, token })).length === 0)
  ok('three release tickets are ready', setup.ticketSequences.length === 3)
  await send(client, lender, { TransactionType: 'Payment', Account: lender.address, Destination: loan.address,
    Amount: S.tokenAmount(token, 200000) })
  ok('lender deposited 200,000.00 test dollars', Number(await S.tokenBalance(client, loan.address, token)) === 200000)
  await expectRefused('the key that created the loan account can no longer move anything', () =>
    send(client, loan, { TransactionType: 'Payment', Account: loan.address, Destination: payee.address, Amount: S.tokenAmount(token, 1) }))

  const draw3 = 61500.5
  const payeeBefore = Number(await S.tokenBalance(client, payee.address, token))
  const release = S.buildReleasePayment({ loanAccount: loan.address, payee: payee.address, token, usd: draw3,
    ticketSequence: setup.ticketSequences[0], drawRequestId: 'proof-draw-3' })
  const lenderSig = S.signAsSigner(lender, release)             // at approval
  await expectRefused('the lender\'s signature alone releases nothing', () => S.submitMultisigned(client, [lenderSig]))
  const bcSig = S.signAsSigner(bc, release)                     // only when both conditions are recorded
  await expectRefused('BuildChain\'s signature alone releases nothing', () => S.submitMultisigned(client, [bcSig]))
  ok('BuildChain confirms the lender signed exactly this release',
    S.verifyLenderSignedRelease(lenderSig, release, lender.address).length === 0)
  ok('a signature over a different amount is caught',
    S.verifyLenderSignedRelease(S.signAsSigner(lender, { ...release, Amount: S.tokenAmount(token, draw3 + 1) }), release, lender.address).length > 0)
  ok('a signature from someone other than the lender is caught',
    S.verifyLenderSignedRelease(S.signAsSigner(payee, release), release, lender.address).length > 0)
  const rel = await S.countersignAndSubmit(client, bc, lenderSig)   // what the app does at release
  console.log(`      Release payment ${rel.hash}`)
  ok('payee received exactly the draw', Number(await S.tokenBalance(client, payee.address, token)) === payeeBefore + draw3)
  ok('loan account holds the remainder', Number(await S.tokenBalance(client, loan.address, token)) === 200000 - draw3)
  await expectRefused('the same signed release cannot be replayed', () => S.submitMultisigned(client, [lenderSig, bcSig]))

  // Take-backs on the loan account.
  console.log('\nMethod B — refunds and withdrawn releases')
  const lenderBefore = Number(await S.tokenBalance(client, lender.address, token))
  const refund = S.buildRefundPayment({ loanAccount: loan.address, lender: lender.address, token, usd: 25000,
    ticketSequence: setup.ticketSequences[1] })
  const refundSig = S.signAsSigner(lender, refund)
  ok('the lender\'s refund signature matches the refund', S.verifyLenderSigned(refundSig, refund, lender.address).length === 0)
  await S.countersignAndSubmit(client, bc, refundSig)
  ok('the lender got 25,000.00 back from the loan account',
    Number(await S.tokenBalance(client, lender.address, token)) === lenderBefore + 25000)

  const withdrawn = S.buildReleasePayment({ loanAccount: loan.address, payee: payee.address, token, usd: 5000,
    ticketSequence: setup.ticketSequences[2], drawRequestId: 'proof-draw-4' })
  const withdrawnSig = S.signAsSigner(lender, withdrawn)          // the lender approved, then the draw is declined
  const voidTx = S.buildVoidTicket({ loanAccount: loan.address, ticketSequence: setup.ticketSequences[2], drawRequestId: 'proof-draw-4' })
  const voidSig = S.signAsSigner(lender, voidTx)
  ok('the lender\'s withdrawal signature matches', S.verifyLenderSigned(voidSig, voidTx, lender.address).length === 0)
  ok('a release signature cannot pass as a withdrawal', S.verifyLenderSigned(withdrawnSig, voidTx, lender.address).length > 0)
  await S.countersignAndSubmit(client, bc, voidSig)
  await expectRefused('after a withdrawal, the earlier release signature is dead', () => S.countersignAndSubmit(client, bc, withdrawnSig))
  ok('the withdrawn draw\'s money is still in the loan account',
    Number(await S.tokenBalance(client, loan.address, token)) === 200000 - draw3 - 25000)

  await client.disconnect()
  console.log(`\nAll ${passed} checks passed on the XRPL test network.`)
}

main().catch(async (e) => { console.error(e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 500) })
