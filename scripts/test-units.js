/**
 * Unit tests for the money rules that need no network: amounts, the check on a
 * lender's signature, the fee, and the address used in emailed links.
 *
 *   node scripts/test-units.js
 *
 * The TypeScript sources are compiled to a scratch folder first (no extra
 * tooling needed). Exits non-zero on the first failure.
 */
const { execFileSync } = require('child_process')
const assert = require('assert')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const out = path.join(root, 'node_modules', '.cache', 'unit-tests')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
try {
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(root, 'lib', 'xrpl', 'settlement.ts'),
    path.join(root, 'lib', 'app-url.ts'),
    path.join(root, 'lib', 'network.ts'),
    path.join(root, 'lib', 'api-key.ts'),
    '--outDir', out, '--module', 'commonjs', '--target', 'es2020',
    '--skipLibCheck', '--esModuleInterop', '--moduleResolution', 'node', '--rootDir', path.join(root, 'lib'),
  ], { stdio: 'pipe' })
} catch (e) { /* type complaints do not stop the emit */ }
const S = require(path.join(out, 'xrpl', 'settlement.js'))
const { appUrl } = require(path.join(out, 'app-url.js'))
const net = require(path.join(out, 'network.js'))
const { sameKey, bearer } = require(path.join(out, 'api-key.js'))
const { Wallet } = require('xrpl')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`ok    ${name}`) }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exit(1) }
}
function withEnv(vars, fn) {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { return fn() } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

// ── Amounts ──────────────────────────────────────────────────────────────────
test('a dollar amount becomes a two-decimal token value', () => {
  assert.strictEqual(S.usdValue(84250.75), '84250.75')
  assert.strictEqual(S.usdValue(1000), '1000.00')
  assert.strictEqual(S.usdValue(0.1 + 0.2), '0.30')      // floating-point noise is not a fraction of a cent
})
test('zero, negative, non-numbers and fractions of a cent are refused', () => {
  for (const bad of [0, -5, NaN, Infinity, 10.005]) assert.throws(() => S.usdValue(bad))
})
test('currency codes: three letters as-is, longer names as 40 hex characters', () => {
  assert.strictEqual(S.currencyCode('USD'), 'USD')
  assert.strictEqual(S.currencyCode('RLUSD'), '524C555344000000000000000000000000000000')
  assert.strictEqual(S.currencyCode('524c555344000000000000000000000000000000'), '524C555344000000000000000000000000000000')
})

// ── The check on a lender's signature ────────────────────────────────────────
const loan = Wallet.generate(), lender = Wallet.generate(), payee = Wallet.generate(), other = Wallet.generate(), issuer = Wallet.generate()
const token = { currency: 'RLUSD', issuer: issuer.address }
const release = S.buildReleasePayment({ loanAccount: loan.address, payee: payee.address, token, usd: 61500.5, ticketSequence: 7, drawRequestId: 'd1' })

test('a correct lender signature passes (and "61500.50" equals "61500.5")', () => {
  assert.deepStrictEqual(S.verifyLenderSigned(S.signAsSigner(lender, release), release, lender.address), [])
})
test('a different amount is caught', () => {
  const bad = S.signAsSigner(lender, { ...release, Amount: S.tokenAmount(token, 61500.51) })
  assert.ok(S.verifyLenderSigned(bad, release, lender.address).includes('Amount is not what was requested'))
})
test('a different payee is caught', () => {
  const bad = S.signAsSigner(lender, { ...release, Destination: other.address })
  assert.ok(S.verifyLenderSigned(bad, release, lender.address).length > 0)
})
test('a different token issuer is caught', () => {
  const bad = S.signAsSigner(lender, { ...release, Amount: { ...release.Amount, issuer: other.address } })
  assert.ok(S.verifyLenderSigned(bad, release, lender.address).length > 0)
})
test('a different ticket or fee is caught', () => {
  assert.ok(S.verifyLenderSigned(S.signAsSigner(lender, { ...release, TicketSequence: 8 }), release, lender.address).length > 0)
  assert.ok(S.verifyLenderSigned(S.signAsSigner(lender, { ...release, Fee: '999999' }), release, lender.address).length > 0)
})
test('an added field is caught (nothing may be slipped in)', () => {
  for (const extra of [{ LastLedgerSequence: 99 }, { DestinationTag: 5 }, { Flags: 131072 }, { SendMax: S.tokenAmount(token, 90000) }]) {
    assert.ok(S.verifyLenderSigned(S.signAsSigner(lender, { ...release, ...extra }), release, lender.address).length > 0, JSON.stringify(extra))
  }
})
test('a signature by anyone but the lender is caught', () => {
  assert.ok(S.verifyLenderSigned(S.signAsSigner(other, release), release, lender.address).includes('It is not signed by the lender alone'))
})
test('a withdrawal cannot be passed off as a release, or the reverse', () => {
  const voidTx = S.buildVoidTicket({ loanAccount: loan.address, ticketSequence: 7, drawRequestId: 'd1' })
  assert.ok(S.verifyLenderSigned(S.signAsSigner(lender, release), voidTx, lender.address).length > 0)
  assert.ok(S.verifyLenderSigned(S.signAsSigner(lender, voidTx), release, lender.address).length > 0)
})
test('garbage is rejected, not thrown', () => {
  assert.deepStrictEqual(S.verifyLenderSigned('ZZZZ', release, lender.address), ['The signed transaction could not be read'])
})
test('a refund goes only to the lender', () => {
  const refund = S.buildRefundPayment({ loanAccount: loan.address, lender: lender.address, token, usd: 100, ticketSequence: 9 })
  assert.strictEqual(refund.Destination, lender.address)
  assert.strictEqual(refund.Account, loan.address)
})
test('a lender escrow carries the condition and a cancel date', () => {
  const tx = S.buildLenderEscrowCreate({ lender: lender.address, payee: payee.address, token, usd: 250, condition: 'a0258020' + '11'.repeat(32) + '810120', cancelAfter: new Date('2027-03-01T00:00:00Z') })
  assert.strictEqual(tx.Account, lender.address)
  assert.strictEqual(tx.Destination, payee.address)
  assert.strictEqual(tx.Condition, tx.Condition.toUpperCase())
  assert.ok(tx.CancelAfter > 0)
})

// ── The address used in emailed links ────────────────────────────────────────
test('a localhost address is ignored on the hosted site', () => {
  withEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000', VERCEL: '1' }, () => assert.strictEqual(appUrl(), 'https://www.buildchain.finance'))
  withEnv({ NEXT_PUBLIC_APP_URL: undefined, VERCEL: '1' }, () => assert.strictEqual(appUrl(), 'https://www.buildchain.finance'))
  withEnv({ NEXT_PUBLIC_APP_URL: 'https://www.buildchain.finance/', VERCEL: '1' }, () => assert.strictEqual(appUrl(), 'https://www.buildchain.finance'))
  withEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000', VERCEL: undefined }, () => assert.strictEqual(appUrl(), 'http://localhost:3000'))
})

// ── Network wording ──────────────────────────────────────────────────────────
test('the "no funds were transferred" note exists only on the test network', () => {
  withEnv({ XRPL_NETWORK: 'wss://s.altnet.rippletest.net:51233' }, () => { assert.ok(net.onTestNetwork()); assert.ok(net.pilotNote().includes('no funds were transferred')) })
  withEnv({ XRPL_NETWORK: undefined }, () => assert.ok(net.onTestNetwork()))
  withEnv({ XRPL_NETWORK: 'wss://xrplcluster.com' }, () => { assert.ok(!net.onTestNetwork()); assert.strictEqual(net.pilotNote(), '') })
})

// ── API key comparison ───────────────────────────────────────────────────────
test('an unset key never opens a route', () => {
  assert.strictEqual(sameKey('anything', undefined), false)
  assert.strictEqual(sameKey('', ''), false)
  assert.strictEqual(sameKey('abc', 'abc'), true)
  assert.strictEqual(sameKey('abc', 'abd'), false)
  assert.strictEqual(sameKey('abc', 'abcd'), false)
  assert.strictEqual(bearer('Bearer  k1 '), 'k1')
})

console.log(`\nAll ${passed} unit tests passed.`)
