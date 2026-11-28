/**
 * Xaman (the XRPL wallet app) sign requests.
 *
 * BuildChain never sees a lender's key. It builds a transaction, asks Xaman to
 * show it to the lender, and the lender approves it on their own phone. The
 * app is identified by XAMAN_API_KEY / XAMAN_API_SECRET (server only), created
 * in the Xaman developer console.
 */

const API = 'https://xumm.app/api/v1/platform'

export function isXamanConfigured(): boolean {
  return !!(process.env.XAMAN_API_KEY && process.env.XAMAN_API_SECRET)
}

function headers(): Record<string, string> {
  const key = process.env.XAMAN_API_KEY
  const secret = process.env.XAMAN_API_SECRET
  if (!key || !secret) throw new Error('Xaman is not set up: XAMAN_API_KEY and XAMAN_API_SECRET are missing')
  return { 'Content-Type': 'application/json', 'X-API-Key': key, 'X-API-Secret': secret }
}

export interface SignRequest {
  /** Xaman's id for this request */
  uuid: string
  /** opens the request in Xaman (phone) or shows the QR (desktop) */
  url: string
  /** PNG of the QR code to scan */
  qrPng: string
  /** true when Xaman sent it straight to the lender's phone (no QR needed) */
  pushed: boolean
}

export interface SignResult {
  /** the lender opened it and chose: signed or rejected */
  resolved: boolean
  signed: boolean
  expired: boolean
  /** the account that signed */
  account: string | null
  /** the transaction hash, when Xaman submitted it */
  txid: string | null
  /** the signed transaction, hex */
  hex: string | null
  /**
   * Given once a wallet has signed for this app: with it, later requests are
   * pushed to that phone. Server-only; treat it like a password.
   */
  userToken: string | null
}

/**
 * Ask Xaman to present a transaction for signing.
 *   submit    Xaman submits it to the ledger after signing (single-signer transactions)
 *   multisign the lender signs as one signer of a multi-signature account; nothing is submitted
 *   userToken push the request to the phone that signed before
 */
export async function createSignRequest(o: {
  txjson: Record<string, unknown>
  submit: boolean
  multisign?: boolean
  /** shown to the lender inside Xaman */
  instruction: string
  /** our reference, at most 40 characters */
  identifier?: string
  expireMinutes?: number
  userToken?: string | null
}): Promise<SignRequest> {
  const res = await fetch(`${API}/payload`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      txjson: o.txjson,
      ...(o.userToken ? { user_token: o.userToken } : {}),
      options: {
        submit: o.submit,
        ...(o.multisign ? { multisign: true } : {}),
        expire: o.expireMinutes ?? 30,
      },
      custom_meta: {
        instruction: o.instruction.slice(0, 280),
        ...(o.identifier ? { identifier: o.identifier.slice(0, 40) } : {}),
      },
    }),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => null) as
    { uuid?: string; next?: { always?: string }; refs?: { qr_png?: string }; pushed?: boolean; error?: { reference?: string; code?: number } } | null
  if (!res.ok || !json?.uuid || !json.next?.always || !json.refs?.qr_png) {
    throw new Error(`Xaman did not accept the sign request (${res.status}${json?.error?.code ? `, code ${json.error.code}` : ''})`)
  }
  return { uuid: json.uuid, url: json.next.always, qrPng: json.refs.qr_png, pushed: !!json.pushed }
}

export async function getSignResult(uuid: string): Promise<SignResult> {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error('Not a Xaman request id')
  const res = await fetch(`${API}/payload/${uuid}`, { headers: headers(), cache: 'no-store' })
  const json = await res.json().catch(() => null) as {
    meta?: { resolved?: boolean; signed?: boolean; expired?: boolean; cancelled?: boolean }
    response?: { account?: string | null; txid?: string | null; hex?: string | null }
    application?: { issued_user_token?: string | null }
  } | null
  if (!res.ok || !json?.meta) throw new Error(`Xaman did not return the sign request (${res.status})`)
  return {
    resolved: !!json.meta.resolved,
    signed: !!json.meta.signed,
    expired: !!json.meta.expired || !!json.meta.cancelled,
    account: json.response?.account ?? null,
    txid: json.response?.txid ?? null,
    hex: json.response?.hex ?? null,
    userToken: json.application?.issued_user_token ?? null,
  }
}

/**
 * Withdraw a sign request that must no longer be signed (it was superseded,
 * or its draw was declined). Returns whether it is now certain the request
 * can never be signed. Callers that only tidy up may ignore the answer.
 */
export async function cancelSignRequest(uuid: string | null | undefined): Promise<boolean> {
  if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) return true
  try {
    const res = await fetch(`${API}/payload/${uuid}`, { method: 'DELETE', headers: headers(), cache: 'no-store' })
    const json = await res.json().catch(() => null) as { result?: { cancelled?: boolean; reason?: string } } | null
    // True only when it can no longer be signed: withdrawn now, or already
    // withdrawn or expired. (Already signed, or open on the phone, is false.)
    return !!json?.result?.cancelled || ['ALREADY_CANCELLED', 'ALREADY_EXPIRED'].includes(String(json?.result?.reason))
  } catch { return false }
}
