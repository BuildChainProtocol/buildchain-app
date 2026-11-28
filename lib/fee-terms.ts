/**
 * The protocol fee terms a lender agrees to, in one place.
 *
 * Decided by the company on 2026-11-27 (see the fee terms sheet). When the
 * terms change, change the text AND the version: every lender's recorded
 * agreement names the version they accepted, and a new version must be
 * accepted again before a fee under it can apply.
 */

import { feeRateBps, FEE_TERMS_VERSION } from '@/lib/fees'

export { FEE_TERMS_VERSION }

/** Days from the invoice date until it is due. */
export const INVOICE_DUE_DAYS = 30

export function feeRatePercent(): string {
  return `${(feeRateBps() / 100).toFixed(2)}%`
}

/** The terms, as plain sentences. Shown to the lender exactly as written here. */
export function feeTerms(): { version: string; rate: string; points: string[] } {
  const rate = feeRatePercent()
  return {
    version: FEE_TERMS_VERSION,
    rate,
    points: [
      `The protocol fee is ${rate} of each amount released to a payee through BuildChain, including retainage when it is released.`,
      'The lender pays the fee. It is never taken out of a contractor\'s or subcontractor\'s payment.',
      'A fee applies only to a release that actually happens. Nothing is charged for a draw that is declined, withdrawn or taken back.',
      'The first draw released for you is free.',
      `Fees are invoiced monthly, after the month ends, and each invoice is due ${INVOICE_DUE_DAYS} days after its date.`,
      'There is no minimum, no per-draw charge, no subscription, and no charge for inspection or lien-waiver records.',
      'During the pilot on the XRP Ledger test network no real funds move and no fee is charged.',
      'BuildChain will tell you at least 30 days before any change to these terms, and a change applies only once you have accepted it.',
    ],
  }
}
