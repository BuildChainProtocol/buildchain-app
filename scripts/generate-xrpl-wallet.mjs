/**
 * One-time script: generate a funded XRPL testnet platform wallet
 *
 * Run:  node scripts/generate-xrpl-wallet.mjs
 *
 * This creates TWO wallets:
 *   PLATFORM  — the BuildChain escrow manager (signs EscrowCreate / EscrowFinish)
 *   BORROWER  — a default test destination for escrow funds on testnet
 *
 * Copy the printed env vars into your .env.local file.
 * The testnet faucet funds each wallet with 1000 test XRP.
 */

import { Client, Wallet } from 'xrpl'

const TESTNET = 'wss://s.altnet.rippletest.net:51233'

async function main() {
  console.log('\n BuildChain XRPL Wallet Generator\n')
  console.log('Connecting to XRPL Testnet...')
  const client = new Client(TESTNET)
  await client.connect()

  console.log('Requesting funded wallets from testnet faucet (this takes ~10s)...\n')

  const { wallet: platformWallet, balance: platformBalance } = await client.fundWallet()
  const { wallet: borrowerWallet, balance: borrowerBalance } = await client.fundWallet()

  await client.disconnect()

  console.log('='.repeat(60))
  console.log('Add these to your .env.local:')
  console.log('='.repeat(60))
  console.log()
  console.log(`XRPL_NETWORK=wss://s.altnet.rippletest.net:51233`)
  console.log(`XRPL_WALLET_SEED=${platformWallet.seed}`)
  console.log(`XRPL_WALLET_ADDRESS=${platformWallet.address}`)
  console.log(`XRPL_DEFAULT_DESTINATION=${borrowerWallet.address}`)
  console.log(`XRPL_ESCROW_FINISH_AFTER_SECONDS=30`)
  console.log()
  console.log('='.repeat(60))
  console.log('Wallet details:')
  console.log('='.repeat(60))
  console.log()
  console.log('PLATFORM WALLET (creates + finishes escrows)')
  console.log(`  Address : ${platformWallet.address}`)
  console.log(`  Seed    : ${platformWallet.seed}`)
  console.log(`  Balance : ${platformBalance} XRP`)
  console.log(`  Explorer: https://testnet.xrpl.org/accounts/${platformWallet.address}`)
  console.log()
  console.log('DEFAULT BORROWER WALLET (receives escrow funds on testnet)')
  console.log(`  Address : ${borrowerWallet.address}`)
  console.log(`  Seed    : ${borrowerWallet.seed}`)
  console.log(`  Balance : ${borrowerBalance} XRP`)
  console.log(`  Explorer: https://testnet.xrpl.org/accounts/${borrowerWallet.address}`)
  console.log()
  console.log('KEEP THESE SEEDS PRIVATE. Do not commit .env.local to git.')
  console.log()
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
