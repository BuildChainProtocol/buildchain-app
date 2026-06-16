// BuildChain — XRPL Testnet Wallet Generator
// Run: node generate-xrpl-wallet.mjs
// This generates a funded testnet wallet for XRPL escrow integration.
// DO NOT use these values on mainnet — testnet XRP has no real value.

import { Client, Wallet } from 'xrpl'

const client = new Client('wss://s.altnet.rippletest.net:51233')

console.log('\n🔗 Connecting to XRPL testnet...')
await client.connect()

console.log('🪙  Requesting funded testnet wallet from faucet...\n')
const { wallet, balance } = await client.fundWallet()

console.log('✅  Wallet generated and funded!\n')
console.log('─────────────────────────────────────────────────────')
console.log('Add these to Vercel → Settings → Environment Variables:')
console.log('─────────────────────────────────────────────────────')
console.log(`XRPL_WALLET_SEED=${wallet.seed}`)
console.log(`XRPL_DEFAULT_DESTINATION=${wallet.address}`)
console.log('─────────────────────────────────────────────────────')
console.log(`\nWallet address : ${wallet.address}`)
console.log(`Wallet seed    : ${wallet.seed}`)
console.log(`Testnet balance: ${balance} XRP`)
console.log('\n⚠️  Save the seed somewhere safe — it cannot be recovered.')
console.log('⚠️  This is a TESTNET wallet — no real money.\n')

await client.disconnect()
