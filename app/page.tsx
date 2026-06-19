import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Home() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Authenticated users go straight to their dashboard
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    redirect(`/${(profile as any)?.role || 'borrower'}`)
  }

  // Everyone else sees the landing page
  return (
    <div style={{ background: '#0f1923', color: '#e8edf2', fontFamily: "Inter, system-ui, -apple-system, sans-serif", minHeight: '100vh' }}>

      {/* ─── NAV ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(15,25,35,0.85)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(42,63,87,0.6)',
        padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 60,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: '#c9a84c', borderRadius: 7, padding: '6px 11px',
            fontSize: 13, fontWeight: 900, color: '#0f1923', letterSpacing: '-0.5px',
          }}>BC</div>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            Build<span style={{ color: '#c9a84c' }}>Chain</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <a href="#how-it-works" style={{ fontSize: 13, color: '#7f9ab0', textDecoration: 'none' }}>How it works</a>
          <a href="#for-lenders" style={{ fontSize: 13, color: '#7f9ab0', textDecoration: 'none' }}>Lenders</a>
          <a href="#technology" style={{ fontSize: 13, color: '#7f9ab0', textDecoration: 'none' }}>Technology</a>
          <Link href="/login" style={{
            fontSize: 13, fontWeight: 600, color: '#c9a84c',
            border: '1px solid rgba(201,168,76,0.35)', borderRadius: 8,
            padding: '6px 16px', textDecoration: 'none',
          }}>Log in</Link>
        </div>
      </nav>

      {/* ─── HERO ────────────────────────────────────────────────────────────── */}
      <section style={{ padding: '100px 24px 80px', textAlign: 'center', maxWidth: 860, margin: '0 auto' }}>

        {/* Patent badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)',
          borderRadius: 100, padding: '6px 14px', marginBottom: 32,
        }}>
          <span style={{ fontSize: 12 }}>⬡</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#c9a84c', letterSpacing: '0.02em' }}>
            Protected by Provisional Patent BLDCHN-001-P · XRP Ledger
          </span>
        </div>

        <h1 style={{
          fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 800, lineHeight: 1.1,
          letterSpacing: '-1.5px', margin: '0 0 24px',
        }}>
          Construction Lending,<br />
          <span style={{ color: '#c9a84c' }}>Verified On-Chain.</span>
        </h1>

        <p style={{
          fontSize: 'clamp(16px, 2vw, 20px)', color: '#7f9ab0', lineHeight: 1.7,
          maxWidth: 620, margin: '0 auto 40px', fontWeight: 400,
        }}>
          BuildChain automates construction draw disbursement using dual-condition
          smart escrow on the XRP Ledger — funds only release when an inspector
          credential NFT <em>and</em> a lien waiver NFT are both verified simultaneously.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="mailto:jcaruso27@yahoo.com?subject=BuildChain Demo Request" style={{
            background: '#c9a84c', color: '#0f1923', fontWeight: 700, fontSize: 15,
            padding: '14px 28px', borderRadius: 10, textDecoration: 'none', letterSpacing: '-0.2px',
          }}>Request a Demo →</a>
          <a href="#how-it-works" style={{
            background: 'rgba(255,255,255,0.05)', color: '#e8edf2', fontWeight: 600, fontSize: 15,
            padding: '14px 28px', borderRadius: 10, textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>See how it works</a>
        </div>

        {/* Stats row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          marginTop: 72,
          background: 'rgba(22,32,50,0.8)', borderRadius: 14,
          border: '1px solid rgba(42,63,87,0.6)', overflow: 'hidden',
        }}>
          {[
            { value: '$2T+', label: 'Annual US construction lending volume' },
            { value: '15–45', label: 'Days saved per draw with automation' },
            { value: '0', label: 'Manual steps in the dual-condition release' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '28px 20px', borderRight: i < 2 ? '1px solid rgba(42,63,87,0.6)' : undefined }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#c9a84c', letterSpacing: '-1px' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#7f9ab0', marginTop: 4, lineHeight: 1.5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── THE PROBLEM ─────────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', background: 'rgba(22,32,50,0.5)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>The Problem</p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-0.8px', margin: '0 0 48px', lineHeight: 1.2 }}>
            Construction draws are the most<br />fraud-prone process in real estate.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {[
              { icon: '📋', title: 'Manual & opaque', body: 'Draw requests move through email, PDFs, and spreadsheets. No single source of truth. Lenders fund draws without verified proof of work.' },
              { icon: '🏚', title: 'Lien exposure', body: "Subcontractors file mechanics liens when GCs don't pay. Lenders inherit the risk. Lien waivers are collected on paper and easily forged." },
              { icon: '🔍', title: 'Inspection theater', body: 'Inspector reports are PDFs that can be altered. There\'s no tamper-proof record that a qualified inspector actually passed the site.' },
            ].map((c, i) => (
              <div key={i} style={{
                background: '#1e2d40', border: '1px solid #2a3f57', borderRadius: 12, padding: '24px',
              }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{c.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{c.title}</div>
                <div style={{ fontSize: 14, color: '#7f9ab0', lineHeight: 1.7 }}>{c.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ────────────────────────────────────────────────────── */}
      <section id="how-it-works" style={{ padding: '100px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>How it works</p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-0.8px', margin: '0 0 16px', lineHeight: 1.2 }}>
            Two conditions. One automatic release.
          </h2>
          <p style={{ fontSize: 16, color: '#7f9ab0', margin: '0 0 64px', maxWidth: 560, lineHeight: 1.7 }}>
            Funds locked in XRPL escrow only move when both on-chain conditions
            are satisfied simultaneously — not one, not the other. Both.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {[
              {
                step: '01',
                icon: '🏗',
                title: 'Draw submitted',
                body: 'Borrower submits a draw request with G703 schedule of values. Lender approves and BuildChain creates an XRPL escrow — funds locked on-chain, untouchable until both conditions are met.',
                tag: 'EscrowCreate → XRP Ledger',
                highlight: false,
              },
              {
                step: '02',
                icon: '🔍',
                title: 'Inspector credential minted',
                body: 'A licensed inspector visits the site and submits their report through a token-gated portal. On pass, BuildChain mints an XLS-20 Inspector Credential NFT (taxon 3) — a tamper-proof on-chain record.',
                tag: 'NFT taxon 3 · Condition 1',
                highlight: true,
              },
              {
                step: '03',
                icon: '📝',
                title: 'Lien waiver NFT minted',
                body: 'Lender confirms receipt of the signed lien waiver. BuildChain mints an XLS-20 Lien Waiver NFT (taxon 2). The Verification Orchestrator detects both NFTs are present and automatically executes EscrowFinish.',
                tag: 'NFT taxon 2 · Condition 2 → Auto-release',
                highlight: true,
              },
            ].map((s, i) => (
              <div key={i} style={{
                background: s.highlight ? 'rgba(201,168,76,0.04)' : '#1e2d40',
                border: `1px solid ${s.highlight ? 'rgba(201,168,76,0.25)' : '#2a3f57'}`,
                borderRadius: 12, padding: '28px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <span style={{ fontSize: 28 }}>{s.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: s.highlight ? '#c9a84c' : '#2a3f57', letterSpacing: '0.05em' }}>{s.step}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: '#7f9ab0', lineHeight: 1.7, marginBottom: 16 }}>{s.body}</div>
                <div style={{
                  fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                  color: s.highlight ? '#c9a84c' : '#2d7dd2',
                  background: s.highlight ? 'rgba(201,168,76,0.08)' : 'rgba(45,125,210,0.08)',
                  padding: '4px 10px', borderRadius: 6, display: 'inline-block',
                }}>{s.tag}</div>
              </div>
            ))}
          </div>

          {/* Verification receipt callout */}
          <div style={{
            marginTop: 32, padding: '20px 24px', borderRadius: 12,
            background: 'rgba(45,125,210,0.06)', border: '1px solid rgba(45,125,210,0.2)',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 22 }}>⬡</div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>Verification Receipt generated on every release</div>
              <div style={{ fontSize: 12, color: '#7f9ab0' }}>
                Each funded draw records both NFT IDs, the EscrowFinish hash, timestamp, and patent reference in an immutable JSONB receipt — a complete audit trail for lenders, regulators, and title companies.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOR LENDERS ─────────────────────────────────────────────────────── */}
      <section id="for-lenders" style={{ padding: '100px 24px', background: 'rgba(22,32,50,0.5)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 64, alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>For Lenders</p>
            <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 38px)', fontWeight: 800, letterSpacing: '-0.8px', margin: '0 0 20px', lineHeight: 1.2 }}>
              Your compliance team in code.
            </h2>
            <p style={{ fontSize: 15, color: '#7f9ab0', lineHeight: 1.8, margin: '0 0 32px' }}>
              BuildChain gives lenders a real-time, on-chain audit trail for every draw.
              No more chasing inspection reports, hunting lien waivers, or trusting
              scanned PDFs. The ledger does not lie.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { icon: '🔒', text: 'Funds locked in escrow until both NFTs verified — disbursement fraud eliminated' },
                { icon: '📊', text: 'Real-time portfolio visibility — draw utilization, LTV, maturity schedule in one dashboard' },
                { icon: '⚡', text: 'Automatic EscrowFinish — no manual wire, no delays, no human error' },
                { icon: '📜', text: 'Immutable verification receipts — ready for regulatory exams and title company review' },
              ].map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
                  <span style={{ fontSize: 14, color: '#7f9ab0', lineHeight: 1.6 }}>{f.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Mini dashboard mockup */}
            <div style={{ background: '#1e2d40', border: '1px solid #2a3f57', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#7f9ab0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Portfolio Overview</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Active Loans', value: '12', color: '#e8edf2' },
                  { label: 'Total Committed', value: '$18.4M', color: '#c9a84c' },
                  { label: 'Pending Draws', value: '3', color: '#f39c12' },
                  { label: 'Avg Portfolio LTV', value: '68%', color: '#2ecc71' },
                ].map((s, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: '#7f9ab0', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: '#1e2d40', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#2ecc71', marginBottom: 12 }}>⬡ Auto-Release · Draw #DR-0014</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#7f9ab0' }}>① Inspector Credential NFT</span>
                  <span style={{ color: '#2ecc71', fontWeight: 700 }}>✅ Verified</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#7f9ab0' }}>② Lien Waiver NFT</span>
                  <span style={{ color: '#2ecc71', fontWeight: 700 }}>✅ On-ledger</span>
                </div>
                <div style={{ borderTop: '1px solid rgba(42,63,87,0.6)', paddingTop: 10, marginTop: 4, fontSize: 11, color: '#c9a84c', fontFamily: 'monospace' }}>
                  EscrowFinish · $285,000 · BLDCHN-001-P §V
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOR BORROWERS & GCs ─────────────────────────────────────────────── */}
      <section style={{ padding: '100px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 48 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#2d7dd2', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>For Borrowers</p>
              <h3 style={{ fontSize: 'clamp(20px, 3vw, 28px)', fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 16px', lineHeight: 1.3 }}>No more draw black holes.</h3>
              <p style={{ fontSize: 14, color: '#7f9ab0', lineHeight: 1.8, margin: '0 0 24px' }}>
                Submit a draw, track it in real time. Know exactly where your request is —
                inspection scheduled, lien waiver pending, funds in escrow, released.
                No more calling your lender&apos;s assistant.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'G703 schedule of values built in',
                  'Real-time draw pipeline tracker',
                  'Retainage auto-calculated',
                  'Instant notification on every status change',
                ].map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#7f9ab0' }}>
                    <span style={{ color: '#2d7dd2', fontWeight: 800, fontSize: 10 }}>✓</span> {f}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#1ab3a6', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>For General Contractors</p>
              <h3 style={{ fontSize: 'clamp(20px, 3vw, 28px)', fontWeight: 800, letterSpacing: '-0.5px', margin: '0 0 16px', lineHeight: 1.3 }}>Building Block AI handles the paperwork.</h3>
              <p style={{ fontSize: 14, color: '#7f9ab0', lineHeight: 1.8, margin: '0 0 24px' }}>
                Building Block is an AI agent that reads your job cost reports, assembles
                the draw package, collects lien waivers from subs, and submits directly
                to BuildChain — no manual entry, no missed documents.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  'Reads AIA G702/G703 formats automatically',
                  'Collects sub lien waivers via smart workflow',
                  'Submits complete draw packages via API',
                  'Notifies GC when funds are released',
                ].map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#7f9ab0' }}>
                    <span style={{ color: '#1ab3a6', fontWeight: 800, fontSize: 10 }}>✓</span> {f}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── TECHNOLOGY ──────────────────────────────────────────────────────── */}
      <section id="technology" style={{ padding: '100px 24px', background: 'rgba(22,32,50,0.5)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Technology</p>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-0.8px', margin: '0 0 16px', lineHeight: 1.2 }}>
            Built on the XRP Ledger.
          </h2>
          <p style={{ fontSize: 16, color: '#7f9ab0', margin: '0 auto 64px', maxWidth: 540, lineHeight: 1.7 }}>
            XRPL settles in 3–5 seconds with $0.0001 transaction fees. Native escrow
            and XLS-20 NFTs are protocol-level — no smart contract risk, no gas wars.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 48 }}>
            {[
              { icon: '⬡', title: 'XLS-20 NFTs', body: 'Inspector credentials (taxon 3) and lien waivers (taxon 2) minted as non-transferable on-chain records', color: '#c9a84c' },
              { icon: '🔐', title: 'Native Escrow', body: 'EscrowCreate locks funds at approval. EscrowFinish fires automatically when both NFTs are present', color: '#2d7dd2' },
              { icon: '📋', title: 'Loan Digital Title', body: 'Each loan mints a Loan NFT (taxon 0) at origination — burned when the loan is paid off', color: '#1ab3a6' },
              { icon: '⚡', title: 'RLUSD Ready', body: 'ESCROW_CURRENCY=RLUSD env flag reserved — stablecoin disbursements available when XRPL Hooks go live', color: '#2ecc71' },
            ].map((t, i) => (
              <div key={i} style={{ background: '#1e2d40', border: '1px solid #2a3f57', borderRadius: 12, padding: '24px 20px', textAlign: 'left' }}>
                <div style={{ fontSize: 24, color: t.color, marginBottom: 12 }}>{t.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: '#7f9ab0', lineHeight: 1.7 }}>{t.body}</div>
              </div>
            ))}
          </div>

          {/* Patent badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 12,
            background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)',
            borderRadius: 12, padding: '16px 24px', textAlign: 'left',
          }}>
            <div style={{ fontSize: 28 }}>🛡</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#c9a84c', marginBottom: 2 }}>
                Provisional Patent BLDCHN-001-P
              </div>
              <div style={{ fontSize: 12, color: '#7f9ab0' }}>
                &ldquo;Multi-Condition Verification System and Method for Automated Construction Draw Disbursement
                Using Distributed Ledger Technology&rdquo; — Filed April 20, 2026
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─────────────────────────────────────────────────────────────── */}
      <section style={{ padding: '100px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-1px', margin: '0 0 20px', lineHeight: 1.2 }}>
            Ready to modernize your<br />construction lending?
          </h2>
          <p style={{ fontSize: 16, color: '#7f9ab0', lineHeight: 1.7, margin: '0 auto 40px', maxWidth: 480 }}>
            BuildChain is in active deployment. Whether you&apos;re a lender, developer,
            or GC — let&apos;s talk about bringing verified, on-chain draw management to your portfolio.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="mailto:jcaruso27@yahoo.com?subject=BuildChain Demo Request" style={{
              background: '#c9a84c', color: '#0f1923', fontWeight: 700, fontSize: 15,
              padding: '14px 32px', borderRadius: 10, textDecoration: 'none',
            }}>Request a Demo →</a>
            <Link href="/login" style={{
              background: 'rgba(255,255,255,0.05)', color: '#e8edf2', fontWeight: 600, fontSize: 15,
              padding: '14px 28px', borderRadius: 10, textDecoration: 'none',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>Log in to platform</Link>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid #2a3f57', padding: '40px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: '#c9a84c', borderRadius: 6, padding: '4px 9px',
            fontSize: 11, fontWeight: 900, color: '#0f1923',
          }}>BC</div>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            Build<span style={{ color: '#c9a84c' }}>Chain</span>
          </span>
          <span style={{ fontSize: 12, color: '#7f9ab0' }}>· Construction Loan Protocol</span>
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#7f9ab0' }}>Patent BLDCHN-001-P</span>
          <span style={{ fontSize: 12, color: '#7f9ab0' }}>Powered by XRP Ledger</span>
          <Link href="/login" style={{ fontSize: 12, color: '#c9a84c', textDecoration: 'none' }}>Platform login →</Link>
        </div>
      </footer>

    </div>
  )
}
