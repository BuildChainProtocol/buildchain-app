import { Client } from 'xrpl'

const XRPL_WS = process.env.XRPL_NETWORK ?? 'wss://s.altnet.rippletest.net:51233'

/**
 * Returns a fresh connected XRPL client.
 * Caller is responsible for calling client.disconnect() when done.
 * We use a new connection per call (no singleton) because
 * Next.js API routes are short-lived serverless functions.
 */
export async function getConnectedClient(): Promise<Client> {
  const client = new Client(XRPL_WS)
  await client.connect()
  return client
}
