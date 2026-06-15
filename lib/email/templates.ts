/**
 * BuildChain — email templates
 * All templates return { subject, html }.
 * Keep HTML inline-styled for maximum email client compatibility.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://buildchain-app.vercel.app'

const DARK    = '#0d1b2a'
const NAVY    = '#0f2133'
const GOLD    = '#f39c12'
const MUTED   = '#7a8fa6'
const BORDER  = '#1e3347'
const LIGHT   = '#e8edf2'

function base(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>BuildChain</title>
</head>
<body style="margin:0;padding:0;background:${DARK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${DARK};padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Logo -->
        <tr><td style="padding-bottom:24px;">
          <div style="background:${GOLD};display:inline-block;padding:8px 14px;border-radius:8px;font-size:14px;font-weight:900;color:${DARK};letter-spacing:-0.5px;">BC</div>
          <span style="color:${LIGHT};font-size:18px;font-weight:700;margin-left:10px;vertical-align:middle;">Build<span style="color:${GOLD};">Chain</span></span>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:${NAVY};border:1px solid ${BORDER};border-radius:12px;padding:32px;">
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:20px;text-align:center;">
          <p style="color:${MUTED};font-size:12px;margin:0;">
            BuildChain Protocol · Construction Loan Management<br/>
            <a href="${APP_URL}" style="color:${MUTED};">buildchain-app.vercel.app</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function btn(text: string, url: string): string {
  return `<a href="${url}"
    style="display:inline-block;background:${GOLD};color:${DARK};font-weight:700;font-size:14px;
           padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:20px;">
    ${text}
  </a>`
}

function keyval(label: string, value: string): string {
  return `<tr>
    <td style="color:${MUTED};font-size:13px;padding:6px 0;width:40%;">${label}</td>
    <td style="color:${LIGHT};font-size:13px;padding:6px 0;font-weight:600;">${value}</td>
  </tr>`
}

function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

// ─── DRAW SUBMITTED → lender ────────────────────────────────────────────────

interface DrawSubmittedOpts {
  lenderName: string
  borrowerName: string
  projectName: string
  drawAmount: number
  drawPurpose: string
  projectId: string
  drawId: string
}

export function drawSubmittedEmail(o: DrawSubmittedOpts) {
  const url = `${APP_URL}/lender/approvals`
  const subject = `Action required: Draw request on ${o.projectName}`
  const html = base(`
    <h2 style="color:${LIGHT};font-size:20px;font-weight:700;margin:0 0 8px;">New Draw Request</h2>
    <p style="color:${MUTED};font-size:14px;margin:0 0 24px;">A draw request is waiting for your review.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
      ${keyval('Project', o.projectName)}
      ${keyval('Borrower', o.borrowerName)}
      ${keyval('Amount', formatUSD(o.drawAmount))}
      ${keyval('Purpose', o.drawPurpose)}
    </table>

    ${btn('Review Draw Request', url)}

    <p style="color:${MUTED};font-size:12px;margin-top:20px;">
      Logged in as ${o.lenderName}. Once approved, an XRPL escrow will be created on-chain.
    </p>
  `)
  return { subject, html }
}

// ─── DRAW APPROVED → borrower ────────────────────────────────────────────────

interface DrawApprovedOpts {
  borrowerName: string
  lenderName: string
  projectName: string
  drawAmount: number
  escrowTxnHash?: string | null
}

export function drawApprovedEmail(o: DrawApprovedOpts) {
  const subject = `Draw approved — ${formatUSD(o.drawAmount)} on ${o.projectName}`
  const xrplLine = o.escrowTxnHash
    ? `<p style="color:${MUTED};font-size:12px;margin:12px 0 0;">
         On-chain escrow created:
         <a href="https://testnet.xrpl.org/transactions/${o.escrowTxnHash}" style="color:${GOLD};font-family:monospace;">
           ${o.escrowTxnHash.slice(0, 16)}…
         </a>
       </p>`
    : ''

  const html = base(`
    <h2 style="color:${GOLD};font-size:20px;font-weight:700;margin:0 0 8px;">✓ Draw Approved</h2>
    <p style="color:${MUTED};font-size:14px;margin:0 0 24px;">
      Your draw request has been approved by <strong style="color:${LIGHT};">${o.lenderName}</strong>.
      Funds will be released once the platform admin confirms disbursement.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
      ${keyval('Project', o.projectName)}
      ${keyval('Amount approved', formatUSD(o.drawAmount))}
      ${keyval('Approved by', o.lenderName)}
    </table>

    ${xrplLine}
    ${btn('View Project', `${APP_URL}/borrower`)}
  `)
  return { subject, html }
}

// ─── DRAW DECLINED → borrower ────────────────────────────────────────────────

interface DrawDeclinedOpts {
  borrowerName: string
  lenderName: string
  projectName: string
  drawAmount: number
  declineNotes?: string | null
}

export function drawDeclinedEmail(o: DrawDeclinedOpts) {
  const subject = `Draw request declined — ${o.projectName}`
  const notesLine = o.declineNotes
    ? `<div style="background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.2);border-radius:8px;padding:12px 16px;margin-top:16px;">
         <p style="color:${MUTED};font-size:12px;margin:0 0 4px;font-weight:600;">LENDER NOTE</p>
         <p style="color:${LIGHT};font-size:13px;margin:0;">${o.declineNotes}</p>
       </div>`
    : ''

  const html = base(`
    <h2 style="color:#e74c3c;font-size:20px;font-weight:700;margin:0 0 8px;">Draw Request Declined</h2>
    <p style="color:${MUTED};font-size:14px;margin:0 0 24px;">
      Your draw request on <strong style="color:${LIGHT};">${o.projectName}</strong> was not approved
      by ${o.lenderName} at this time. You may resubmit with additional documentation.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
      ${keyval('Project', o.projectName)}
      ${keyval('Requested amount', formatUSD(o.drawAmount))}
      ${keyval('Reviewed by', o.lenderName)}
    </table>

    ${notesLine}
    ${btn('View Project', `${APP_URL}/borrower`)}
  `)
  return { subject, html }
}

// ─── DRAW FUNDED → borrower ──────────────────────────────────────────────────

interface DrawFundedOpts {
  borrowerName: string
  projectName: string
  drawAmount: number
  totalDrawn: number
  loanAmount: number
  escrowFinishHash?: string | null
}

export function drawFundedEmail(o: DrawFundedOpts) {
  const pct = Math.round((o.totalDrawn / o.loanAmount) * 100)
  const subject = `Funds released — ${formatUSD(o.drawAmount)} on ${o.projectName}`
  const hashLine = o.escrowFinishHash
    ? `<p style="color:${MUTED};font-size:12px;margin:12px 0 0;">
         Settlement TX:
         <a href="https://testnet.xrpl.org/transactions/${o.escrowFinishHash}" style="color:${GOLD};font-family:monospace;">
           ${o.escrowFinishHash.slice(0, 16)}…
         </a>
       </p>`
    : ''

  const html = base(`
    <h2 style="color:${GOLD};font-size:20px;font-weight:700;margin:0 0 8px;">💸 Draw Funds Released</h2>
    <p style="color:${MUTED};font-size:14px;margin:0 0 24px;">
      Your draw has been disbursed. The funds are on their way.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
      ${keyval('Project', o.projectName)}
      ${keyval('Disbursed', formatUSD(o.drawAmount))}
      ${keyval('Total drawn', `${formatUSD(o.totalDrawn)} of ${formatUSD(o.loanAmount)} (${pct}%)`)}
    </table>

    ${hashLine}
    ${btn('View Project', `${APP_URL}/borrower`)}
  `)
  return { subject, html }
}

// ─── DOCUMENT UPLOADED → admin ───────────────────────────────────────────────

interface DocUploadedOpts {
  projectName: string
  uploaderName: string
  docTitle: string
  projectId: string
}

export function documentUploadedEmail(o: DocUploadedOpts) {
  const subject = `Document uploaded — ${o.projectName} needs review`
  const html = base(`
    <h2 style="color:${LIGHT};font-size:20px;font-weight:700;margin:0 0 8px;">New Document Uploaded</h2>
    <p style="color:${MUTED};font-size:14px;margin:0 0 24px;">
      A document has been uploaded and is pending admin review.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
      ${keyval('Project', o.projectName)}
      ${keyval('Uploaded by', o.uploaderName)}
      ${keyval('Document', o.docTitle)}
    </table>

    ${btn('Review Document', `${APP_URL}/admin/projects/${o.projectId}?tab=documents`)}
  `)
  return { subject, html }
}
