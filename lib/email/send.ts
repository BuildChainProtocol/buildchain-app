/**
 * BuildChain — email utility
 * Thin Resend wrapper. All calls are non-blocking (try/catch at call site).
 */

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from   = process.env.EMAIL_FROM

  if (!apiKey || !from || apiKey === 're_your_key_here') {
    console.log('[Email] Resend not configured — skipping:', opts.subject)
    return
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const { error } = await resend.emails.send({
    from,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
  })

  if (error) {
    console.warn('[Email] Resend error:', error)
  } else {
    console.log(`[Email] Sent "${opts.subject}" to ${Array.isArray(opts.to) ? opts.to.join(', ') : opts.to}`)
  }
}
