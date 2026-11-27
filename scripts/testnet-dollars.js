/**
 * Test dollars for the XRP Ledger TEST network.
 *
 * Real RLUSD cannot be escrowed yet and has no free test supply we control, so
 * the pilot uses a test dollar token under the RLUSD currency code, issued by
 * a test-network account kept on this computer only.
 *
 *   node scripts/testnet-dollars.js init                 create the issuer (once)
 *   node scripts/testnet-dollars.js status               show the issuer address
 *   node scripts/testnet-dollars.js fund <address>       give a test wallet test XRP (new accounts)
 *   node scripts/testnet-dollars.js send <address> <amount>   send test dollars (needs a trust line)
 *   node scripts/testnet-dollars.js balance <address>
 *
 * The issuer's key is written to ../.testnet/issuer.json, outside this
 * repository. It is a TEST-NETWORK key with no value; never use it on mainnet.
 */
const fs = require('fs')
const path = require('path')
const { Client, Wallet } = require('xrpl')

const TESTNET = 'wss://s.altnet.rippletest.net:51233'
const FAUCET = 'https://faucet.altnet.rippletest.net/accounts'
const dir = path.join(__dirname, '..', '..', '.testnet')
const file = path.join(dir, 'issuer.json')
const CODE = Buffer.from('RLUSD', 'ascii').toString('hex').toUpperCase().padEnd(40, '0')

async function send(client, wallet, tx) {
  const prepared = await client.autofill(tx)
  const res = await client.submitAndWait(wallet.sign(prepared).tx_blob)
  const result = res.result.meta.TransactionResult
  if (result !== 'tesSUCCESS') throw new Error(result)
  return res.result.hash
}
function issuer() {
  if (!fs.existsSync(file)) throw new Error('No test issuer yet. Run: node scripts/testnet-dollars.js init')
  return Wallet.fromSeed(JSON.parse(fs.readFileSync(file, 'utf8')).seed)
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2)
  const client = new Client(TESTNET)
  await client.connect()
  try {
    if (cmd === 'init') {
      if (fs.existsSync(file)) { console.log(`Test issuer already exists: ${issuer().address}`); return }
      const { wallet } = await client.fundWallet()
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ network: 'testnet', address: wallet.address, seed: wallet.seed }, null, 2))
      await send(client, wallet, { TransactionType: 'AccountSet', Account: wallet.address, SetFlag: 8 })   // default ripple
      await send(client, wallet, { TransactionType: 'AccountSet', Account: wallet.address, SetFlag: 17 })  // allow trust line locking
      console.log(`Test issuer created: ${wallet.address}`)
      console.log('Set SETTLEMENT_TOKEN_ISSUER to that address (it is public, not a secret).')
    } else if (cmd === 'status') {
      const w = issuer()
      const info = await client.request({ command: 'account_info', account: w.address, ledger_index: 'validated' })
      console.log(`Test issuer ${w.address}\nallows escrow: ${((info.result.account_data.Flags >>> 0) & 0x40000000) !== 0}`)
    } else if (cmd === 'fund' && a) {
      const res = await fetch(FAUCET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: a }) })
      console.log(res.ok ? `Test XRP sent to ${a}` : `Faucet refused (${res.status})`)
    } else if (cmd === 'send' && a && Number(b) > 0) {
      const w = issuer()
      const hash = await send(client, w, { TransactionType: 'Payment', Account: w.address, Destination: a,
        Amount: { currency: CODE, issuer: w.address, value: Number(b).toFixed(2) } })
      console.log(`Sent ${Number(b).toFixed(2)} test dollars to ${a}\n${hash}`)
    } else if (cmd === 'balance' && a) {
      const w = issuer()
      const res = await client.request({ command: 'account_lines', account: a, peer: w.address, ledger_index: 'validated' })
      const line = res.result.lines.find(l => l.currency === CODE)
      console.log(line ? `${line.balance} test dollars` : 'No trust line for the test dollar yet')
    } else {
      console.log('Usage: init | status | fund <address> | send <address> <amount> | balance <address>')
    }
  } finally { await client.disconnect() }
}
main().catch(e => { console.error(e.message.includes('tecPATH_DRY') || e.message.includes('tecNO_LINE')
  ? 'That wallet has no trust line for the test dollar yet.' : e.message); process.exitCode = 1 })
