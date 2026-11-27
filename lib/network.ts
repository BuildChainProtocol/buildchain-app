/**
 * Which XRP Ledger network this site runs on, and the wording that depends
 * on it. On the test network every message to a person says that no real
 * funds moved; that sentence disappears only when the site is pointed at
 * mainnet, so the two can never get out of step.
 */

export function onTestNetwork(): boolean {
  const network = process.env.XRPL_NETWORK ?? ''
  return !network || network.includes('altnet') || network.includes('testnet')
}

/** Block-explorer address for a transaction on the network in use. */
export function explorerTx(hash: string): string {
  return `${onTestNetwork() ? 'https://testnet.xrpl.org' : 'https://livenet.xrpl.org'}/transactions/${hash}`
}

/** "the XRP Ledger test network" or "the XRP Ledger". */
export function ledgerName(): string {
  return onTestNetwork() ? 'the XRP Ledger test network' : 'the XRP Ledger'
}

/** Appended to anything that tells a person a draw was released. Empty on mainnet. */
export function pilotNote(): string {
  return onTestNetwork() ? ' This is a pilot on the test network: no funds were transferred.' : ''
}
