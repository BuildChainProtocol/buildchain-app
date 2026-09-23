import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Home() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    redirect(`/${(profile as any)?.role || 'borrower'}`)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        @keyframes orb-drift-1 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(60px,-45px) scale(1.08); }
          66%      { transform: translate(-35px,30px) scale(0.93); }
        }
        @keyframes orb-drift-2 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(-45px,35px) scale(1.12); }
          66%      { transform: translate(30px,-20px) scale(0.9); }
        }
        @keyframes orb-drift-3 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(30px,45px) scale(1.06); }
        }
        @keyframes flow-left {
          0%   { left:-1%; opacity:0; }
          8%   { opacity:1; }
          92%  { opacity:1; }
          100% { left:101%; opacity:0; }
        }
        @keyframes flow-right {
          0%   { right:-1%; opacity:0; }
          8%   { opacity:1; }
          92%  { opacity:1; }
          100% { right:101%; opacity:0; }
        }
        @keyframes pulse-ring {
          0%   { transform:scale(1); opacity:.6; }
          100% { transform:scale(1.7); opacity:0; }
        }
        @keyframes count-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: -400% center; }
          100% { background-position: 400% center; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scan-line {
          0%   { top: 0%; }
          100% { top: 100%; }
        }

        .orb1 { animation: orb-drift-1 26s ease-in-out infinite; }
        .orb2 { animation: orb-drift-2 32s ease-in-out infinite; }
        .orb3 { animation: orb-drift-3 22s ease-in-out infinite; }

        .flow-dot {
          position:absolute; width:8px; height:8px; border-radius:50%;
          top:50%; transform:translateY(-50%);
          animation: flow-left 3.2s linear infinite;
        }
        .flow-dot.d1 { animation-delay:1.1s; }
        .flow-dot.d2 { animation-delay:2.2s; }
        .flow-dot-r {
          position:absolute; width:8px; height:8px; border-radius:50%;
          top:50%; transform:translateY(-50%);
          animation: flow-right 3.2s linear infinite;
        }
        .flow-dot-r.d1 { animation-delay:1.1s; }
        .flow-dot-r.d2 { animation-delay:2.2s; }

        .pulse-ring {
          position:absolute; inset:-6px; border-radius:50%;
          border:1px solid rgba(201,168,76,.5);
          animation: pulse-ring 2.4s ease-out infinite;
        }
        .pulse-ring-2 {
          position:absolute; inset:-6px; border-radius:50%;
          border:1px solid rgba(201,168,76,.25);
          animation: pulse-ring 2.4s ease-out infinite;
          animation-delay:1.2s;
        }

        .grad-gold {
          background: linear-gradient(135deg, #ffffff 0%, #f0dfa8 40%, #c9a84c 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .grad-blue {
          background: linear-gradient(135deg, #ffffff 0%, #a8c8f0 50%, #2d7dd2 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .grad-mixed {
          background: linear-gradient(135deg, #e8d5a0 0%, #c9a84c 40%, #2d7dd2 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .grad-stat {
          background: linear-gradient(135deg, #f0dfa8 0%, #c9a84c 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .grad-stat-blue {
          background: linear-gradient(135deg, #a8c8f0 0%, #2d7dd2 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .grad-stat-teal {
          background: linear-gradient(135deg, #7de8e0 0%, #1ab3a6 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }

        .shimmer-text {
          background: linear-gradient(90deg, #c9a84c 0%, #f5e0a0 40%, #c9a84c 60%, #e8c97a 100%);
          background-size: 300% auto;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          animation: shimmer 4s linear infinite;
        }

        .glass {
          background: linear-gradient(135deg, rgba(255,255,255,.045) 0%, rgba(255,255,255,.01) 100%);
          border: 1px solid rgba(255,255,255,.08);
          backdrop-filter: blur(20px);
        }

        .glass-gold {
          background: linear-gradient(135deg, rgba(201,168,76,.06) 0%, rgba(201,168,76,.02) 100%);
          border: 1px solid rgba(201,168,76,.18);
        }

        .glass-blue {
          background: linear-gradient(135deg, rgba(45,125,210,.06) 0%, rgba(45,125,210,.02) 100%);
          border: 1px solid rgba(45,125,210,.18);
        }

        .grid-bg {
          background-image:
            linear-gradient(rgba(42,63,87,.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(42,63,87,.1) 1px, transparent 1px);
          background-size: 72px 72px;
        }

        .grid-bg-fine {
          background-image:
            linear-gradient(rgba(42,63,87,.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(42,63,87,.06) 1px, transparent 1px);
          background-size: 32px 32px;
        }

        .btn-gold {
          display: inline-flex; align-items: center; gap: 8px;
          background: linear-gradient(135deg, #b8922e 0%, #c9a84c 30%, #e8c97a 70%, #c9a84c 100%);
          background-size: 200% auto;
          color: #080e16; font-weight: 800; font-size: 15px;
          padding: 15px 32px; border-radius: 12px; text-decoration: none;
          letter-spacing: -.2px; transition: all .22s;
          box-shadow: 0 4px 20px rgba(201,168,76,.2);
        }
        .btn-gold:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 36px rgba(201,168,76,.4);
          background-position: right center;
        }

        .btn-ghost {
          display: inline-flex; align-items: center; gap: 8px;
          background: rgba(255,255,255,.05);
          color: #c8d8e8; font-weight: 600; font-size: 15px;
          padding: 15px 28px; border-radius: 12px; text-decoration: none;
          border: 1px solid rgba(255,255,255,.12); transition: all .22s;
        }
        .btn-ghost:hover {
          background: rgba(255,255,255,.09);
          border-color: rgba(255,255,255,.22);
          transform: translateY(-1px);
        }

        .btn-blue {
          display: inline-flex; align-items: center; gap: 8px;
          background: linear-gradient(135deg, #1a5fa8 0%, #2d7dd2 60%, #4a9de0 100%);
          color: #fff; font-weight: 800; font-size: 15px;
          padding: 15px 32px; border-radius: 12px; text-decoration: none;
          letter-spacing: -.2px; transition: all .22s;
          box-shadow: 0 4px 20px rgba(45,125,210,.25);
        }
        .btn-blue:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 36px rgba(45,125,210,.45);
        }

        .audience-card {
          transition: all .25s ease;
          cursor: default;
        }
        .audience-card:hover {
          transform: translateY(-4px);
        }
        .audience-card.gold:hover {
          border-color: rgba(201,168,76,.4) !important;
          box-shadow: 0 20px 60px rgba(201,168,76,.1), 0 0 0 1px rgba(201,168,76,.12) !important;
        }
        .audience-card.blue:hover {
          border-color: rgba(45,125,210,.4) !important;
          box-shadow: 0 20px 60px rgba(45,125,210,.1), 0 0 0 1px rgba(45,125,210,.12) !important;
        }

        .feature-card {
          transition: all .2s ease;
        }
        .feature-card:hover {
          border-color: rgba(201,168,76,.28) !important;
          transform: translateY(-3px);
          box-shadow: 0 16px 48px rgba(0,0,0,.35);
        }

        .trust-badge {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 9px 20px; border-radius: 100px;
          font-size: 12px; font-weight: 700; letter-spacing: .03em;
          white-space: nowrap; transition: all .18s;
        }
        .trust-badge:hover { transform: translateY(-1px); }

        .nav-link { transition: color .15s; }
        .nav-link:hover { color: #e8edf2 !important; }

        .footer-link { color: #2a4a66; text-decoration: none; font-size: 13px; transition: color .15s; }
        .footer-link:hover { color: #8fa8c4; }

        .scan-line {
          position: absolute; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,.4), transparent);
          animation: scan-line 3s linear infinite;
          pointer-events: none;
        }

        .fade-in { animation: fade-in-up .7s ease forwards; }
        .fade-in-delay-1 { animation: fade-in-up .7s .1s ease both; }
        .fade-in-delay-2 { animation: fade-in-up .7s .2s ease both; }
        .fade-in-delay-3 { animation: fade-in-up .7s .3s ease both; }

        @media(max-width:1024px) {
          .two-col { grid-template-columns: 1fr !important; }
          .tech-grid { grid-template-columns: 1fr !important; gap: 48px !important; }
          .audience-grid { grid-template-columns: 1fr !important; }
        }
        @media(max-width:900px) {
          .hide-sm { display: none !important; }
          .three-col { grid-template-columns: 1fr !important; }
          .connector { display: none !important; }
          .hero-h1 { font-size: 52px !important; letter-spacing: -2px !important; }
          .hero-sub { font-size: 18px !important; }
        }
        @media(max-width:640px) {
          .hero-h1 { font-size: 40px !important; letter-spacing: -1.5px !important; }
          .hero-sub { font-size: 16px !important; }
          .nav-cta-text { display: none !important; }
          section { padding-left: 24px !important; padding-right: 24px !important; }
          nav { padding-left: 20px !important; padding-right: 20px !important; }
          .trust-scroll { flex-wrap: wrap !important; justify-content: center !important; }
          .stat-grid { grid-template-columns: 1fr 1fr !important; }
          .step-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{
        background: '#06090f',
        color: '#e8edf2',
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        minHeight: '100vh',
        overflowX: 'hidden',
      }}>

        {/* ── AMBIENT ORBS ── */}
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
          <div className="orb1" style={{
            position: 'absolute', width: 1000, height: 1000, top: -300, left: -250,
            background: 'radial-gradient(circle, rgba(201,168,76,.065) 0%, transparent 65%)',
          }} />
          <div className="orb2" style={{
            position: 'absolute', width: 900, height: 900, top: 100, right: -200,
            background: 'radial-gradient(circle, rgba(45,125,210,.08) 0%, transparent 65%)',
          }} />
          <div className="orb3" style={{
            position: 'absolute', width: 700, height: 700, bottom: -100, left: '40%',
            background: 'radial-gradient(circle, rgba(26,179,166,.06) 0%, transparent 65%)',
          }} />
        </div>

        {/* ── NAV ── */}
        <nav style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
          background: 'rgba(6,9,15,.88)',
          backdropFilter: 'blur(28px)',
          borderBottom: '1px solid rgba(255,255,255,.055)',
          padding: '0 52px', height: 66,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg, #b8922e 0%, #c9a84c 40%, #e8c97a 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 900, color: '#06090f', flexShrink: 0,
                boxShadow: '0 4px 16px rgba(201,168,76,.3)',
              }}>BC</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-.5px', lineHeight: 1.1 }}>
                  Build<span style={{ color: '#c9a84c' }}>Chain</span>
                </div>
                <div style={{ fontSize: 9, color: '#2a4a66', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>Construction Loan Protocol</div>
              </div>
            </div>
            <div className="hide-sm" style={{ display: 'flex', gap: 32 }}>
              {[
                ['For Lenders', '#lenders'],
                ['For Contractors', '#contractors'],
                ['How it Works', '#how-it-works'],
                ['Technology', '#technology'],
              ].map(([label, href]) => (
                <a key={label} href={href} className="nav-link"
                  style={{ fontSize: 13, color: '#3d5c78', textDecoration: 'none', fontWeight: 500 }}>
                  {label}
                </a>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link href="/login" style={{ fontSize: 13, color: '#3d5c78', textDecoration: 'none', fontWeight: 500 }}>
              Log in
            </Link>
            <a href="mailto:jason@buildchain.finance?subject=BuildChain Demo Request"
              style={{
                background: 'linear-gradient(135deg, #c9a84c 0%, #e8c97a 100%)',
                color: '#06090f', fontWeight: 800, fontSize: 13,
                padding: '9px 20px', borderRadius: 9, textDecoration: 'none',
                boxShadow: '0 4px 14px rgba(201,168,76,.25)',
              }}>
              <span className="nav-cta-text">Request </span>Demo
            </a>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section className="grid-bg" style={{
          position: 'relative', zIndex: 1,
          paddingTop: 160, paddingBottom: 120, paddingLeft: 48, paddingRight: 48,
          textAlign: 'center',
          overflow: 'hidden',
        }}>
          {/* Grid fades */}
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 50% at 50% 0%, transparent 60%, #06090f 100%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(6,9,15,.4) 100%)', pointerEvents: 'none' }} />

          <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto' }}>

            {/* Live badge */}
            <div className="fade-in" style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              background: 'rgba(201,168,76,.06)',
              border: '1px solid rgba(201,168,76,.2)',
              borderRadius: 100, padding: '8px 20px', marginBottom: 48,
            }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%', background: '#c9a84c',
                boxShadow: '0 0 10px rgba(201,168,76,.9)',
              }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', letterSpacing: '.05em' }}>
                Patent Pending · BLDCHN-001-P · Powered by XRP Ledger
              </span>
            </div>

            {/* Main headline */}
            <h1 className="hero-h1 fade-in-delay-1" style={{
              fontSize: 88, fontWeight: 900, lineHeight: 1.0,
              letterSpacing: '-4px', margin: '0 0 32px',
            }}>
              <span className="grad-gold">The Protocol That</span><br />
              <span style={{ color: '#e8edf2' }}>Moves Construction</span><br />
              <span className="shimmer-text">Capital.</span>
            </h1>

            <p className="hero-sub fade-in-delay-2" style={{
              fontSize: 21, color: '#4a6a86', lineHeight: 1.75,
              maxWidth: 640, margin: '0 auto 60px', fontWeight: 400,
            }}>
              BuildChain automates every draw request, site inspection, and fund release
              through blockchain-verified smart escrow — reducing a 14-day process to
              under 48 hours, at institutional scale, with zero manual wires.
            </p>

            <div className="fade-in-delay-3" style={{
              display: 'flex', gap: 14, justifyContent: 'center',
              flexWrap: 'wrap', marginBottom: 100,
            }}>
              <a href="mailto:jason@buildchain.finance?subject=BuildChain Lender Pilot Program"
                className="btn-gold" style={{ fontSize: 16, padding: '17px 36px' }}>
                Join Lender Pilot →
              </a>
              <a href="#how-it-works" className="btn-ghost" style={{ fontSize: 16, padding: '17px 30px' }}>
                See how it works
              </a>
            </div>

            {/* ── HERO STATS ROW ── */}
            <div className="stat-grid" style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 1, background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.07)',
              borderRadius: 20, overflow: 'hidden',
              boxShadow: '0 0 0 1px rgba(201,168,76,.04), 0 24px 80px rgba(0,0,0,.5)',
            }}>
              {[
                { val: '89%', label: 'Faster Draw Cycles', note: '14 days → under 48 hrs', color: '#c9a84c', cls: 'grad-stat' },
                { val: '$4.6M+', label: 'Annual Value Unlocked', note: 'per $200M portfolio', color: '#2d7dd2', cls: 'grad-stat-blue' },
                { val: '100%', label: 'Lien Waiver Compliance', note: 'on-chain · immutable', color: '#1ab3a6', cls: 'grad-stat-teal' },
                { val: '3–5s', label: 'XRPL Settlement', note: 'vs. 3–5 days by wire', color: '#c9a84c', cls: 'grad-stat' },
              ].map((s, i) => (
                <div key={i} style={{
                  background: 'rgba(6,9,15,.85)', padding: '32px 24px',
                  borderRight: i < 3 ? '1px solid rgba(255,255,255,.04)' : 'none',
                }}>
                  <div className={s.cls} style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-2px', lineHeight: 1 }}>
                    {s.val}
                  </div>
                  <div style={{ fontSize: 14, color: '#c8d8e8', fontWeight: 700, marginTop: 10, letterSpacing: '-.2px' }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#2a4a66', marginTop: 4 }}>{s.note}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TRUST SIGNALS ── */}
        <section style={{
          position: 'relative', zIndex: 1,
          background: 'rgba(8,12,20,.9)',
          borderTop: '1px solid rgba(255,255,255,.04)',
          borderBottom: '1px solid rgba(255,255,255,.04)',
          padding: '24px 48px',
          overflow: 'hidden',
        }}>
          <div className="trust-scroll" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 16, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, color: '#2a4a66', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', marginRight: 8 }}>
              Trusted Infrastructure
            </span>
            {[
              { icon: '🛡', label: 'Patent BLDCHN-001-P', color: '#c9a84c', bg: 'rgba(201,168,76,.07)', border: 'rgba(201,168,76,.18)' },
              { icon: '⬡', label: 'XRP Ledger Native', color: '#2d7dd2', bg: 'rgba(45,125,210,.07)', border: 'rgba(45,125,210,.18)' },
              { icon: '🏛', label: 'Delaware C-Corp', color: '#e8edf2', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.1)' },
              { icon: '⚖️', label: 'Non-MSB Compliant', color: '#1ab3a6', bg: 'rgba(26,179,166,.07)', border: 'rgba(26,179,166,.18)' },
              { icon: '™', label: 'Class 042 Trademark', color: '#e8edf2', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.1)' },
              { icon: '🔒', label: 'Institutional Grade', color: '#c9a84c', bg: 'rgba(201,168,76,.07)', border: 'rgba(201,168,76,.18)' },
            ].map((b, i) => (
              <div key={i} className="trust-badge" style={{ background: b.bg, border: `1px solid ${b.border}` }}>
                <span style={{ fontSize: 13 }}>{b.icon}</span>
                <span style={{ color: b.color }}>{b.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── THE PROBLEM ── */}
        <section style={{
          position: 'relative', zIndex: 1, padding: '140px 48px',
          textAlign: 'center',
        }}>
          <div style={{ maxWidth: 1160, margin: '0 auto' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '.15em' }}>
              The Market
            </span>
            <h2 style={{
              fontSize: 'clamp(36px,5vw,64px)', fontWeight: 900,
              letterSpacing: '-2px', margin: '18px 0 24px', lineHeight: 1.05,
            }}>
              Construction lending is a
              <br /><span className="grad-gold">$4.6 trillion market</span><br />
              running on fax machines.
            </h2>
            <p style={{
              fontSize: 19, color: '#4a6a86', maxWidth: 600, margin: '0 auto 88px',
              lineHeight: 1.8,
            }}>
              Every draw request still involves phone calls, email chains, physical inspections,
              manual wire transfers, and chasing lien waivers. The result: 14-day delays, fraud exposure,
              and billions in misallocated capital every year.
            </p>

            {/* Problem vs Solution grid */}
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              {/* Pain side */}
              <div style={{
                background: 'rgba(220,50,50,.04)',
                border: '1px solid rgba(220,50,50,.12)',
                borderRadius: 20, padding: '48px 40px', textAlign: 'left',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(220,80,80,.8)', letterSpacing: '.08em', marginBottom: 32, textTransform: 'uppercase' }}>
                  ✕ &nbsp;Legacy Process
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {[
                    { title: '14-day draw cycles', body: 'Paper-based G702 submissions, manual review, phone approvals, and ACH transfers that take days to settle.' },
                    { title: 'Rampant fraud exposure', body: 'Lenders have no real-time visibility into job site progress. Overbilling and draw fraud cost the industry billions annually.' },
                    { title: 'Lien waiver chaos', body: 'Collecting, tracking, and verifying lien waivers from every sub means weeks of administrative work per loan.' },
                    { title: 'No audit trail', body: 'Disputes end up in court because there\'s no immutable record of who approved what, when, and why.' },
                  ].map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 16 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: 'rgba(220,80,80,.1)', border: '1px solid rgba(220,80,80,.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, color: 'rgba(220,80,80,.7)', flexShrink: 0, marginTop: 1,
                      }}>✕</div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#c8d8e8', marginBottom: 4 }}>{p.title}</div>
                        <div style={{ fontSize: 13, color: '#3d5c78', lineHeight: 1.7 }}>{p.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Solution side */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(201,168,76,.05) 0%, rgba(26,179,166,.04) 100%)',
                border: '1px solid rgba(201,168,76,.18)',
                borderRadius: 20, padding: '48px 40px', textAlign: 'left',
                boxShadow: '0 0 80px rgba(201,168,76,.04)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#c9a84c', letterSpacing: '.08em', marginBottom: 32, textTransform: 'uppercase' }}>
                  ✓ &nbsp;BuildChain Protocol
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {[
                    { title: 'Under 48-hour settlement', body: 'Digital G702/G703 submission, real-time inspector portal, and automatic EscrowFinish on condition confirmation.' },
                    { title: 'Tamper-proof site verification', body: 'Licensed inspectors mint XLS-20 NFTs on every site visit — permanent on-chain proof of completion status, forever.' },
                    { title: 'Automated lien waiver NFTs', body: 'Every waiver is minted as a non-transferable on-ledger NFT. No chasing, no disputes, instant verification.' },
                    { title: 'Immutable compliance receipt', body: 'Every auto-release generates a permanent receipt: Inspector NFT ID, Lien Waiver NFT ID, tx hash, and timestamp.' },
                  ].map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 16 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: 'rgba(201,168,76,.1)', border: '1px solid rgba(201,168,76,.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, color: '#c9a84c', flexShrink: 0, marginTop: 1,
                      }}>✓</div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#c8d8e8', marginBottom: 4 }}>{p.title}</div>
                        <div style={{ fontSize: 13, color: '#3d5c78', lineHeight: 1.7 }}>{p.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FOR LENDERS ── */}
        <section id="lenders" style={{
          position: 'relative', zIndex: 1, padding: '140px 48px',
          background: 'rgba(8,12,20,.7)',
          borderTop: '1px solid rgba(255,255,255,.04)',
          borderBottom: '1px solid rgba(255,255,255,.04)',
          overflow: 'hidden',
        }}>
          {/* Blue glow */}
          <div style={{
            position: 'absolute', width: 800, height: 600,
            top: '50%', left: '-10%', transform: 'translateY(-50%)',
            background: 'radial-gradient(ellipse, rgba(45,125,210,.07) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ maxWidth: 1160, margin: '0 auto', position: 'relative' }}>
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>

              <div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'rgba(45,125,210,.08)', border: '1px solid rgba(45,125,210,.2)',
                  borderRadius: 100, padding: '7px 18px', marginBottom: 28,
                }}>
                  <span style={{ fontSize: 16 }}>🏦</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#2d7dd2', letterSpacing: '.05em' }}>FOR LENDERS</span>
                </div>
                <h2 style={{
                  fontSize: 'clamp(32px,4vw,54px)', fontWeight: 900,
                  letterSpacing: '-1.5px', margin: '0 0 24px', lineHeight: 1.08,
                }}>
                  Your portfolio.<br />
                  <span className="grad-blue">Total visibility.</span><br />
                  Zero exposure.
                </h2>
                <p style={{ fontSize: 17, color: '#4a6a86', lineHeight: 1.85, margin: '0 0 48px' }}>
                  Deploy capital with confidence. BuildChain gives you real-time portfolio intelligence,
                  automated compliance, and on-chain proof of every draw — eliminating the fraud risk
                  and operational overhead that comes with legacy construction lending.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 48 }}>
                  {[
                    { icon: '◎', title: 'Portfolio Dashboard', body: 'Live LTV tracking, draw status, budget vs. disbursed, and risk flags across your entire construction loan book.' },
                    { icon: '⬡', title: 'Automated Escrow Disbursement', body: 'Funds release automatically when both NFT conditions are met. No manual wires. No approval bottlenecks.' },
                    { icon: '📋', title: 'On-Chain Compliance Receipts', body: 'Every draw generates an immutable audit trail with Inspector NFT ID, Lien Waiver NFT ID, and XRPL transaction hash.' },
                    { icon: '🔒', title: 'Fraud Elimination', body: 'Inspector credential NFTs are non-transferable and minted only by licensed, token-gated professionals.' },
                  ].map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: 'rgba(45,125,210,.09)', border: '1px solid rgba(45,125,210,.18)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>{f.icon}</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#c8d8e8', marginBottom: 4 }}>{f.title}</div>
                        <div style={{ fontSize: 13, color: '#3d5c78', lineHeight: 1.7 }}>{f.body}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <a href="mailto:jason@buildchain.finance?subject=BuildChain Lender Pilot Program"
                    className="btn-blue" style={{ fontSize: 15 }}>
                    Join Lender Pilot →
                  </a>
                  <a href="mailto:jason@buildchain.finance?subject=BuildChain Enterprise Demo"
                    className="btn-ghost" style={{ fontSize: 15 }}>
                    Request Enterprise Demo
                  </a>
                </div>

                {/* Pilot callout */}
                <div style={{
                  marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 10,
                  background: 'rgba(45,125,210,.05)', border: '1px solid rgba(45,125,210,.15)',
                  borderRadius: 10, padding: '12px 18px',
                }}>
                  <span style={{ fontSize: 13 }}>🏗</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#c8d8e8' }}>90-Day Lender Pilot — Now Open</div>
                    <div style={{ fontSize: 11, color: '#3d5c78' }}>3 lenders · 5 active loans each · No cost · Full ROI analysis at close</div>
                  </div>
                </div>
              </div>

              {/* Right: Lender dashboard preview */}
              <div style={{ position: 'relative' }}>
                <div style={{
                  background: 'linear-gradient(160deg, rgba(20,30,48,.98) 0%, rgba(6,9,15,.99) 100%)',
                  border: '1px solid rgba(45,125,210,.18)',
                  borderRadius: 22, overflow: 'hidden',
                  boxShadow: '0 0 0 1px rgba(45,125,210,.06), 0 40px 100px rgba(0,0,0,.6)',
                }}>
                  {/* Browser chrome */}
                  <div style={{
                    background: 'rgba(6,9,15,.9)', borderBottom: '1px solid rgba(255,255,255,.06)',
                    padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => (
                        <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: .7 }} />
                      ))}
                    </div>
                    <div style={{
                      flex: 1, background: 'rgba(255,255,255,.04)', borderRadius: 7,
                      padding: '5px 14px', fontSize: 11, color: '#2a4a66',
                      textAlign: 'center', maxWidth: 260, margin: '0 auto',
                    }}>buildchain.finance/lender/portfolio</div>
                  </div>

                  <div style={{ padding: '24px' }}>
                    {/* Portfolio header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                      <div>
                        <div style={{ fontSize: 13, color: '#2a4a66', marginBottom: 4 }}>Portfolio Overview</div>
                        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-.5px' }}>$12.4M Active</div>
                      </div>
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: '#1ab3a6',
                        background: 'rgba(26,179,166,.08)', border: '1px solid rgba(26,179,166,.2)',
                        padding: '6px 12px', borderRadius: 8,
                      }}>↑ 3 Active Draws</div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
                      {[
                        { label: 'In Escrow', value: '$8.2M', color: '#c9a84c' },
                        { label: 'Available', value: '$4.1M', color: '#2d7dd2' },
                        { label: 'Released Today', value: '$340K', color: '#1ab3a6' },
                      ].map((s, i) => (
                        <div key={i} style={{
                          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
                          borderRadius: 12, padding: '14px',
                        }}>
                          <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div>
                          <div style={{ fontSize: 10, color: '#2a4a66', marginTop: 3 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Auto-release event */}
                    <div style={{
                      background: 'rgba(26,179,166,.06)', border: '1px solid rgba(26,179,166,.2)',
                      borderRadius: 12, padding: '16px', marginBottom: 14,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#1ab3a6', letterSpacing: '.04em' }}>
                          ⬡ AUTO-RELEASED · Draw #DR-0021
                        </span>
                        <span style={{ fontSize: 10, color: '#2a4a66' }}>3s ago</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: '#1ab3a6' }}>✓ Inspector NFT #0x7f3a…</div>
                        <div style={{ fontSize: 11, color: '#1ab3a6' }}>✓ Lien Waiver NFT #0x9c1b…</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#2a4a66', fontFamily: 'monospace' }}>
                        EscrowFinish · $340,000 released · Patent §V verified
                      </div>
                    </div>

                    {/* Projects */}
                    {[
                      { name: 'Riverside Commons Phase 3', pct: 71, status: 'Approved', color: '#c9a84c' },
                      { name: 'Scottsdale Medical Plaza', pct: 45, status: 'Inspecting', color: '#2d7dd2' },
                      { name: 'Harbor View Condominiums', pct: 28, status: 'Active', color: '#1ab3a6' },
                    ].map((p, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8,
                        padding: '10px 12px',
                        background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)',
                        borderRadius: 9,
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#8fa8c4', fontWeight: 500, marginBottom: 5 }}>{p.name}</div>
                          <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2 }}>
                            <div style={{ width: `${p.pct}%`, height: '100%', background: p.color, borderRadius: 2 }} />
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: p.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.pct}%</div>
                        <div style={{
                          fontSize: 9, fontWeight: 700, color: p.color,
                          background: `rgba(${p.color === '#c9a84c' ? '201,168,76' : p.color === '#2d7dd2' ? '45,125,210' : '26,179,166'},.1)`,
                          padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
                        }}>{p.status}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FOR CONTRACTORS ── */}
        <section id="contractors" style={{
          position: 'relative', zIndex: 1, padding: '140px 48px',
          overflow: 'hidden',
        }}>
          {/* Gold glow */}
          <div style={{
            position: 'absolute', width: 800, height: 600,
            top: '50%', right: '-10%', transform: 'translateY(-50%)',
            background: 'radial-gradient(ellipse, rgba(201,168,76,.07) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ maxWidth: 1160, margin: '0 auto', position: 'relative' }}>
            <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>

              {/* Left: GC portal preview */}
              <div style={{ position: 'relative' }}>
                <div style={{
                  background: 'linear-gradient(160deg, rgba(20,30,48,.98) 0%, rgba(6,9,15,.99) 100%)',
                  border: '1px solid rgba(201,168,76,.18)',
                  borderRadius: 22, overflow: 'hidden',
                  boxShadow: '0 0 0 1px rgba(201,168,76,.06), 0 40px 100px rgba(0,0,0,.6)',
                }}>
                  <div style={{
                    background: 'rgba(6,9,15,.9)', borderBottom: '1px solid rgba(255,255,255,.06)',
                    padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => (
                        <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: .7 }} />
                      ))}
                    </div>
                    <div style={{
                      flex: 1, background: 'rgba(255,255,255,.04)', borderRadius: 7,
                      padding: '5px 14px', fontSize: 11, color: '#2a4a66',
                      textAlign: 'center', maxWidth: 260, margin: '0 auto',
                    }}>buildingblock.app/draws/submit</div>
                  </div>

                  <div style={{ padding: '24px' }}>
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>New Draw Request</div>
                      <div style={{ fontSize: 12, color: '#2a4a66' }}>Riverside Commons Phase 3 · Draw #8</div>
                    </div>

                    {/* G703 Schedule of Values */}
                    <div style={{
                      background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)',
                      borderRadius: 12, padding: '14px', marginBottom: 14,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#c9a84c', letterSpacing: '.08em', marginBottom: 12 }}>
                        G703 SCHEDULE OF VALUES
                      </div>
                      {[
                        { item: 'Structural Steel', scheduled: '$180,000', complete: '100%', thisReq: '$0' },
                        { item: 'Concrete Foundation', scheduled: '$240,000', complete: '85%', thisReq: '$36,000' },
                        { item: 'Framing — Level 3', scheduled: '$95,000', complete: '60%', thisReq: '$38,000' },
                        { item: 'MEP Rough-in', scheduled: '$120,000', complete: '40%', thisReq: '$48,000' },
                      ].map((row, i) => (
                        <div key={i} style={{
                          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                          gap: 8, padding: '7px 0',
                          borderBottom: i < 3 ? '1px solid rgba(255,255,255,.04)' : 'none',
                          fontSize: 10,
                        }}>
                          <div style={{ color: '#8fa8c4' }}>{row.item}</div>
                          <div style={{ color: '#3d5c78', textAlign: 'right' }}>{row.scheduled}</div>
                          <div style={{ color: '#1ab3a6', textAlign: 'center', fontWeight: 700 }}>{row.complete}</div>
                          <div style={{ color: '#c9a84c', textAlign: 'right', fontWeight: 700 }}>{row.thisReq}</div>
                        </div>
                      ))}
                      <div style={{
                        display: 'flex', justifyContent: 'flex-end', marginTop: 10,
                        paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.06)',
                        gap: 8, alignItems: 'center',
                      }}>
                        <span style={{ fontSize: 11, color: '#4a6a86' }}>This Request:</span>
                        <span style={{ fontSize: 18, fontWeight: 900, color: '#c9a84c' }}>$122,000</span>
                      </div>
                    </div>

                    {/* AI assistant */}
                    <div style={{
                      background: 'rgba(201,168,76,.05)', border: '1px solid rgba(201,168,76,.15)',
                      borderRadius: 10, padding: '12px 14px', marginBottom: 12,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#c9a84c', marginBottom: 6 }}>
                        ✦ Building Block AI
                      </div>
                      <div style={{ fontSize: 12, color: '#4a6a86', lineHeight: 1.6 }}>
                        Line 3 (Framing — Level 3) shows 60% complete with 65% of schedule elapsed.
                        Recommend attaching latest framing photos to support the draw request.
                      </div>
                    </div>

                    <div style={{
                      display: 'flex', gap: 10, justifyContent: 'flex-end',
                    }}>
                      <div style={{
                        background: 'linear-gradient(135deg, #c9a84c 0%, #e8c97a 100%)',
                        color: '#06090f', fontWeight: 800, fontSize: 12,
                        padding: '10px 20px', borderRadius: 9,
                      }}>Submit Draw →</div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'rgba(201,168,76,.08)', border: '1px solid rgba(201,168,76,.2)',
                  borderRadius: 100, padding: '7px 18px', marginBottom: 28,
                }}>
                  <span style={{ fontSize: 16 }}>🏗</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#c9a84c', letterSpacing: '.05em' }}>FOR GENERAL CONTRACTORS</span>
                </div>
                <h2 style={{
                  fontSize: 'clamp(32px,4vw,54px)', fontWeight: 900,
                  letterSpacing: '-1.5px', margin: '0 0 24px', lineHeight: 1.08,
                }}>
                  Submit draws.<br />
                  <span className="grad-gold">Get paid faster.</span><br />
                  No chasing.
                </h2>
                <p style={{ fontSize: 17, color: '#4a6a86', lineHeight: 1.85, margin: '0 0 48px' }}>
                  The Building Block platform — powered by BuildChain — gives every GC a single portal
                  for submitting G702/G703 draws, tracking inspection status, and receiving
                  automatic disbursements. No more hunting down lenders for approvals.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 48 }}>
                  {[
                    { icon: '📋', title: 'Digital G702/G703 Submission', body: 'Submit AIA-standard draw requests digitally. AI-powered validation catches errors before you submit, reducing rejection rates to near zero.' },
                    { icon: '🔍', title: 'Real-Time Inspection Tracking', body: 'See inspector status live. Know the moment your inspection is approved and your draw is queued for release.' },
                    { icon: '⚡', title: 'Automatic Draw Disbursement', body: 'When the inspector signs off and your lien waiver is confirmed, funds release automatically — no manual wire required.' },
                    { icon: '✦', title: 'Building Block AI Assistant', body: 'AI analyzes your schedule of values, flags overbilling risk, and recommends supporting documentation for each draw.' },
                  ].map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: 'rgba(201,168,76,.09)', border: '1px solid rgba(201,168,76,.18)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, flexShrink: 0,
                      }}>{f.icon}</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#c8d8e8', marginBottom: 4 }}>{f.title}</div>
                        <div style={{ fontSize: 13, color: '#3d5c78', lineHeight: 1.7 }}>{f.body}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <a href="mailto:jason@buildchain.finance?subject=BuildChain GC Early Access"
                    className="btn-gold" style={{ fontSize: 15 }}>
                    Get GC Early Access →
                  </a>
                  <a href="mailto:jason@buildchain.finance?subject=BuildChain Platform Demo"
                    className="btn-ghost" style={{ fontSize: 15 }}>
                    Request Demo
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" style={{
          position: 'relative', zIndex: 1, padding: '140px 48px',
          background: 'rgba(8,12,20,.75)',
          borderTop: '1px solid rgba(255,255,255,.04)',
          borderBottom: '1px solid rgba(255,255,255,.04)',
        }}>
          <div style={{ maxWidth: 1160, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 88 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: '.15em', display: 'block', marginBottom: 18 }}>
                The Protocol
              </span>
              <h2 style={{
                fontSize: 'clamp(32px,4.5vw,60px)', fontWeight: 900,
                letterSpacing: '-2px', margin: '0 0 22px', lineHeight: 1.05,
              }}>
                Two conditions.<br />
                <span className="grad-gold">One automatic release.</span>
              </h2>
              <p style={{ fontSize: 18, color: '#4a6a86', maxWidth: 540, margin: '0 auto', lineHeight: 1.8 }}>
                No manual wires. No approval queues. Funds move the instant the XRP Ledger
                confirms both conditions — and not a moment before.
              </p>
            </div>

            {/* Steps */}
            <div className="step-grid" style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
            }}>
              {[
                {
                  n: '01', icon: '📋', color: '#4a6a86', hl: false,
                  title: 'Draw Submitted',
                  body: 'Borrower submits digital G702/G703 via Building Block platform. Lender approves — BuildChain creates an XRPL EscrowCreate, locking funds on-chain.',
                  tag: 'EscrowCreate · XRPL',
                },
                {
                  n: '02', icon: '🔍', color: '#c9a84c', hl: true,
                  title: 'Site Inspected',
                  body: 'Licensed inspector submits via token-gated portal. On pass, BuildChain mints an XLS-20 Inspector Credential NFT (taxon 3). Tamper-proof. Permanent.',
                  tag: 'NFT taxon 3 · Condition ①',
                },
                {
                  n: '03', icon: '📝', color: '#c9a84c', hl: true,
                  title: 'Lien Waiver Confirmed',
                  body: 'Lender confirms receipt. BuildChain mints a Lien Waiver NFT (taxon 2). That\'s Condition ② satisfied — both conditions are now on-ledger.',
                  tag: 'NFT taxon 2 · Condition ②',
                },
                {
                  n: '04', icon: '⚡', color: '#1ab3a6', hl: false,
                  title: 'Auto-Released',
                  body: 'The Verification Orchestrator detects both NFTs and fires EscrowFinish — funds released in 3–5 seconds. Zero manual steps. Immutable receipt generated.',
                  tag: 'EscrowFinish · Auto · §V',
                },
              ].map((step, i) => (
                <div key={i} className="feature-card" style={{
                  background: step.hl ? 'rgba(201,168,76,.04)' : 'rgba(16,24,40,.7)',
                  border: `1px solid ${step.hl ? 'rgba(201,168,76,.22)' : 'rgba(255,255,255,.07)'}`,
                  borderRadius: 20, padding: '36px 28px',
                  boxShadow: step.hl ? '0 0 60px rgba(201,168,76,.04)' : 'none',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 900,
                    color: step.hl ? '#c9a84c' : 'rgba(255,255,255,.12)',
                    letterSpacing: '.1em', marginBottom: 20,
                  }}>{step.n}</div>
                  <div style={{ fontSize: 32, marginBottom: 18 }}>{step.icon}</div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 12px', letterSpacing: '-.3px' }}>{step.title}</h3>
                  <p style={{ fontSize: 13, color: '#4a6a86', lineHeight: 1.8, margin: '0 0 22px' }}>{step.body}</p>
                  <div style={{
                    fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                    color: step.color,
                    background: step.hl ? 'rgba(201,168,76,.08)' : 'rgba(45,125,210,.07)',
                    padding: '5px 12px', borderRadius: 7, display: 'inline-block',
                    border: `1px solid ${step.hl ? 'rgba(201,168,76,.15)' : 'rgba(45,125,210,.12)'}`,
                  }}>{step.tag}</div>
                </div>
              ))}
            </div>

            {/* Flow connector visualization */}
            <div style={{
              marginTop: 32, padding: '24px 32px', borderRadius: 16,
              background: 'rgba(45,125,210,.05)', border: '1px solid rgba(45,125,210,.15)',
              display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 28, color: '#2d7dd2', flexShrink: 0 }}>⬡</div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 5, color: '#c8d8e8' }}>
                  Patent BLDCHN-001-P — Auto-Release Verification Receipt
                </div>
                <div style={{ fontSize: 12, color: '#4a6a86', lineHeight: 1.75 }}>
                  Inspector NFT ID · Lien Waiver NFT ID · EscrowFinish tx hash · ISO timestamp · Patent ref BLDCHN-001-P §V —
                  every release generates an immutable JSONB receipt, available to regulators, title companies, and auditors on demand.
                </div>
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
                textAlign: 'right',
              }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#1ab3a6' }}>3–5 sec</div>
                <div style={{ fontSize: 11, color: '#2a4a66' }}>from both conditions → funds released</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── MARKET SCALE ── */}
        <section style={{ position: 'relative', zIndex: 1, padding: '140px 48px' }}>
          <div style={{ maxWidth: 1160, margin: '0 auto', textAlign: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#2d7dd2', textTransform: 'uppercase', letterSpacing: '.15em' }}>
              The Opportunity
            </span>
            <h2 style={{
              fontSize: 'clamp(32px,4.5vw,60px)', fontWeight: 900,
              letterSpacing: '-2px', margin: '18px 0 88px', lineHeight: 1.05,
            }}>
              Every lender.<br />
              <span className="grad-blue">Every project. Every draw.</span>
            </h2>

            {/* Large stat grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 24, marginBottom: 24,
            }}>
              {[
                {
                  val: '$4.6T', label: 'Annual U.S. Construction Activity',
                  body: 'The largest single segment of U.S. private investment. BuildChain targets the lending infrastructure that moves all of it.',
                  color: '#c9a84c', cls: 'grad-stat',
                  bg: 'rgba(201,168,76,.04)', border: 'rgba(201,168,76,.15)',
                },
                {
                  val: '9M+', label: 'Construction Draw Events/Year',
                  body: 'Every one of these is a manual, error-prone process today. BuildChain automates each and every one with protocol-grade reliability.',
                  color: '#2d7dd2', cls: 'grad-stat-blue',
                  bg: 'rgba(45,125,210,.04)', border: 'rgba(45,125,210,.15)',
                },
                {
                  val: '30 bps', label: 'Per-Draw Fee — $0 Marginal Cost',
                  body: '0.30% of every disbursement. At institutional volumes, this creates recurring revenue that scales directly with the market.',
                  color: '#1ab3a6', cls: 'grad-stat-teal',
                  bg: 'rgba(26,179,166,.04)', border: 'rgba(26,179,166,.15)',
                },
              ].map((s, i) => (
                <div key={i} style={{
                  background: s.bg, border: `1px solid ${s.border}`,
                  borderRadius: 20, padding: '44px 36px', textAlign: 'center',
                }}>
                  <div className={s.cls} style={{ fontSize: 60, fontWeight: 900, letterSpacing: '-3px', lineHeight: 1, marginBottom: 16 }}>
                    {s.val}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#c8d8e8', marginBottom: 12 }}>{s.label}</div>
                  <div style={{ fontSize: 13, color: '#3d5c78', lineHeight: 1.75 }}>{s.body}</div>
                </div>
              ))}
            </div>

            {/* Secondary stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 1, background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.07)', borderRadius: 16, overflow: 'hidden',
            }}>
              {[
                { v: '89%', l: 'Draw Cycle Reduction', n: '14 days → under 48 hours' },
                { v: '$4.6M+', l: 'Annual Value / $200M Portfolio', n: 'fraud reduction + admin savings' },
                { v: '100%', l: 'Lien Waiver Compliance', n: 'on-chain, immutable, permanent' },
                { v: '$0.0001', l: 'Per XRPL Transaction', n: 'vs. $25–45 wire transfer fee' },
              ].map((s, i) => (
                <div key={i} style={{
                  background: 'rgba(6,9,15,.85)', padding: '28px 22px',
                  borderRight: i < 3 ? '1px solid rgba(255,255,255,.04)' : 'none',
                  textAlign: 'center',
                }}>
                  <div className="grad-stat" style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-1.5px' }}>{s.v}</div>
                  <div style={{ fontSize: 13, color: '#c8d8e8', fontWeight: 700, marginTop: 8 }}>{s.l}</div>
                  <div style={{ fontSize: 11, color: '#2a4a66', marginTop: 4 }}>{s.n}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TECHNOLOGY ── */}
        <section id="technology" style={{
          position: 'relative', zIndex: 1, padding: '140px 48px',
          background: 'rgba(8,12,20,.75)',
          borderTop: '1px solid rgba(255,255,255,.04)',
        }}>
          <div style={{ maxWidth: 1160, margin: '0 auto' }}>
            <div className="tech-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 96, alignItems: 'start' }}>

              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1ab3a6', textTransform: 'uppercase', letterSpacing: '.15em', display: 'block', marginBottom: 18 }}>
                  Technology
                </span>
                <h2 style={{
                  fontSize: 'clamp(30px,3.5vw,48px)', fontWeight: 900,
                  letterSpacing: '-1.5px', margin: '0 0 24px', lineHeight: 1.12,
                }}>
                  Protocol-level.<br />
                  <span className="grad-blue">Not smart contracts.</span>
                </h2>
                <p style={{ fontSize: 16, color: '#4a6a86', lineHeight: 1.9, margin: '0 0 52px' }}>
                  BuildChain runs on the XRP Ledger&apos;s native escrow and XLS-20 NFT standard —
                  no Solidity, no gas fees, no contract vulnerabilities. Settlement in 3–5 seconds,
                  at $0.0001 per transaction, with institutional-grade finality.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                  {[
                    {
                      color: '#c9a84c',
                      title: 'XLS-20 NFT Standard',
                      body: 'Taxon 0 (loan titles) · Taxon 2 (lien waivers) · Taxon 3 (inspector credentials). All non-transferable, on-ledger, permanent proof of each condition. Cannot be forged, duplicated, or deleted.',
                    },
                    {
                      color: '#2d7dd2',
                      title: 'Native XRPL Escrow',
                      body: 'EscrowCreate locks loan funds at draw approval. EscrowFinish executes automatically the instant both NFTs are detected on-chain by the Verification Orchestrator (Patent BLDCHN-001-P §V).',
                    },
                    {
                      color: '#1ab3a6',
                      title: 'RLUSD Stablecoin Ready',
                      body: 'Stablecoin draw releases via Ripple USD. One environment variable away — ESCROW_CURRENCY=RLUSD — enabling fully stable, dollar-denominated disbursements at XRPL speed.',
                    },
                  ].map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 20 }}>
                      <div style={{ width: 3, borderRadius: 2, background: t.color, flexShrink: 0, alignSelf: 'stretch', minHeight: 60 }} />
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: t.color, marginBottom: 8 }}>{t.title}</div>
                        <div style={{ fontSize: 13, color: '#4a6a86', lineHeight: 1.85 }}>{t.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

                {/* Patent card */}
                <div style={{
                  background: 'linear-gradient(135deg, rgba(201,168,76,.07) 0%, rgba(6,9,15,.9) 100%)',
                  border: '1px solid rgba(201,168,76,.22)',
                  borderRadius: 18, padding: '32px',
                  boxShadow: '0 0 60px rgba(201,168,76,.05)',
                  position: 'relative', overflow: 'hidden',
                }}>
                  <div className="scan-line" />
                  <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', position: 'relative' }}>
                    <div style={{ fontSize: 36, flexShrink: 0 }}>🛡</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#c9a84c', marginBottom: 8 }}>
                        U.S. Provisional Patent BLDCHN-001-P
                      </div>
                      <div style={{ fontSize: 14, color: '#8fa8c4', lineHeight: 1.7, marginBottom: 14 }}>
                        &ldquo;Multi-Condition Verification System and Method for Automated Construction Draw Disbursement Using Distributed Ledger Technology&rdquo;
                      </div>
                      <div style={{ fontSize: 11, color: '#2a4a66', lineHeight: 1.6 }}>
                        Filed April 20, 2026 · Non-provisional due April 20, 2027<br />
                        Claims §I–§VIII cover the dual-condition escrow architecture, NFT taxon assignment,
                        and the Verification Orchestrator execution engine.
                      </div>
                    </div>
                  </div>
                </div>

                {/* NFT Taxon grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { taxon: 'Taxon 0', type: 'Loan NFT', desc: 'Minted at origination, burned at payoff', hl: false },
                    { taxon: 'Taxon 1', type: 'Draw Event', desc: 'Records each disbursement permanently', hl: false },
                    { taxon: 'Taxon 2', type: 'Lien Waiver', desc: '⚡ Condition ② — triggers release', hl: true },
                    { taxon: 'Taxon 3', type: 'Inspector Cred', desc: '⚡ Condition ① — triggers release', hl: true },
                  ].map((n, i) => (
                    <div key={i} style={{
                      background: n.hl ? 'rgba(201,168,76,.06)' : 'rgba(255,255,255,.025)',
                      border: `1px solid ${n.hl ? 'rgba(201,168,76,.22)' : 'rgba(255,255,255,.07)'}`,
                      borderRadius: 13, padding: '18px',
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: n.hl ? '#c9a84c' : '#2a4a66', marginBottom: 5, letterSpacing: '.05em' }}>
                        XLS-20 {n.taxon}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 5 }}>{n.type}</div>
                      <div style={{ fontSize: 11, color: '#2a4a66', lineHeight: 1.6 }}>{n.desc}</div>
                    </div>
                  ))}
                </div>

                {/* XRPL vs wire card */}
                <div style={{
                  background: 'rgba(45,125,210,.05)', border: '1px solid rgba(45,125,210,.16)',
                  borderRadius: 14, padding: '22px 24px',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 20, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: '#2a4a66', marginBottom: 6 }}>Legacy Wire</div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: 'rgba(220,80,80,.6)' }}>3–5 days</div>
                      <div style={{ fontSize: 11, color: '#2a4a66', marginTop: 4 }}>$25–45 per transfer</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,.06)', alignSelf: 'stretch' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: '#2d7dd2', marginBottom: 6 }}>XRPL EscrowFinish</div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: '#2d7dd2' }}>3–5 sec</div>
                      <div style={{ fontSize: 11, color: '#2a4a66', marginTop: 4 }}>$0.0001 per transaction</div>
                    </div>
                  </div>
                </div>

                {/* Regulatory badge */}
                <div style={{
                  background: 'rgba(26,179,166,.04)', border: '1px solid rgba(26,179,166,.15)',
                  borderRadius: 14, padding: '20px 24px',
                  display: 'flex', gap: 16, alignItems: 'center',
                }}>
                  <div style={{ fontSize: 28, flexShrink: 0 }}>⚖️</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1ab3a6', marginBottom: 5 }}>
                      Regulatory Analysis Complete
                    </div>
                    <div style={{ fontSize: 12, color: '#3d5c78', lineHeight: 1.7 }}>
                      Independent counsel determined BuildChain Protocol, Inc. does not qualify as a Money Services Business (non-MSB)
                      under 31 CFR 1010.100(ff). Designed for institutional lender compliance from day one.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── DUAL CTA ── */}
        <section style={{
          position: 'relative', zIndex: 1, padding: '140px 48px',
          textAlign: 'center', overflow: 'hidden',
        }}>
          {/* Background glow */}
          <div style={{
            position: 'absolute', width: 800, height: 500,
            top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: 'radial-gradient(ellipse, rgba(201,168,76,.07) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative', maxWidth: 720, margin: '0 auto' }}>
            <div style={{
              display: 'inline-block',
              background: 'rgba(201,168,76,.07)', border: '1px solid rgba(201,168,76,.2)',
              borderRadius: 100, padding: '9px 22px', marginBottom: 40,
              fontSize: 12, color: '#c9a84c', fontWeight: 700, letterSpacing: '.05em',
            }}>
              Now accepting early-access partners
            </div>

            <h2 style={{
              fontSize: 'clamp(36px,5.5vw,68px)', fontWeight: 900,
              letterSpacing: '-2.5px', margin: '0 0 26px', lineHeight: 1.0,
            }}>
              The future of<br />
              construction lending<br />
              <span className="grad-gold">is on-chain.</span>
            </h2>
            <p style={{ fontSize: 18, color: '#4a6a86', margin: '0 auto 64px', maxWidth: 500, lineHeight: 1.8 }}>
              Whether you fund projects or build them — BuildChain eliminates
              the friction between your world and capital, permanently.
            </p>

            {/* Dual CTA cards */}
            <div className="audience-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 36 }}>
              <div className="audience-card gold glass-gold" style={{ borderRadius: 18, padding: '36px 32px', textAlign: 'left' }}>
                <div style={{ fontSize: 28, marginBottom: 16 }}>🏦</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#c8d8e8' }}>For Lenders</div>
                <div style={{ fontSize: 13, color: '#4a6a86', lineHeight: 1.7, marginBottom: 24 }}>
                  Join our 90-day pilot. Deploy capital across 5 active construction loans — no cost, full ROI analysis delivered at close.
                </div>
                <a href="mailto:jason@buildchain.finance?subject=BuildChain Lender Pilot Program"
                  className="btn-gold" style={{ display: 'inline-flex', fontSize: 14, padding: '13px 24px' }}>
                  Join Lender Pilot →
                </a>
              </div>

              <div className="audience-card blue glass-blue" style={{ borderRadius: 18, padding: '36px 32px', textAlign: 'left' }}>
                <div style={{ fontSize: 28, marginBottom: 16 }}>🏗</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#c8d8e8' }}>For Contractors</div>
                <div style={{ fontSize: 13, color: '#4a6a86', lineHeight: 1.7, marginBottom: 24 }}>
                  Get early access to the Building Block platform. Submit draws, track inspections, and get paid faster — starting now.
                </div>
                <a href="mailto:jason@buildchain.finance?subject=BuildChain GC Early Access"
                  className="btn-blue" style={{ display: 'inline-flex', fontSize: 14, padding: '13px 24px' }}>
                  Get GC Access →
                </a>
              </div>
            </div>

            <p style={{ fontSize: 13, color: '#2a4a66' }}>
              Questions? Email{' '}
              <a href="mailto:jason@buildchain.finance"
                style={{ color: '#c9a84c', textDecoration: 'none', fontWeight: 600 }}>
                jason@buildchain.finance
              </a>
            </p>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{
          position: 'relative', zIndex: 1,
          borderTop: '1px solid rgba(255,255,255,.06)',
          padding: '48px 52px 36px',
        }}>
          <div style={{ maxWidth: 1160, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 32, marginBottom: 40 }}>

              {/* Brand */}
              <div style={{ maxWidth: 280 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'linear-gradient(135deg, #c9a84c 0%, #e8c97a 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 900, color: '#06090f',
                    boxShadow: '0 4px 16px rgba(201,168,76,.25)',
                  }}>BC</div>
                  <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-.5px' }}>
                    Build<span style={{ color: '#c9a84c' }}>Chain</span>
                  </span>
                </div>
                <p style={{ fontSize: 13, color: '#2a4a66', lineHeight: 1.75, margin: 0 }}>
                  The construction loan protocol connecting lenders,
                  developers, and contractors through blockchain-verified escrow.
                </p>
              </div>

              {/* Nav links */}
              <div style={{ display: 'flex', gap: 64, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#4a6a86', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 16 }}>Platform</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      ['For Lenders', '#lenders'],
                      ['For Contractors', '#contractors'],
                      ['How it Works', '#how-it-works'],
                      ['Technology', '#technology'],
                    ].map(([label, href]) => (
                      <a key={label} href={href} className="footer-link">
                        {label}
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#4a6a86', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 16 }}>Company</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <a href="mailto:jason@buildchain.finance"
                      style={{ fontSize: 13, color: '#2a4a66', textDecoration: 'none' }}>
                      Contact
                    </a>
                    <a href="mailto:jason@buildchain.finance?subject=BuildChain Lender Pilot Program"
                      style={{ fontSize: 13, color: '#c9a84c', textDecoration: 'none', fontWeight: 600 }}>
                      Join Pilot →
                    </a>
                    <Link href="/login" style={{ fontSize: 13, color: '#2a4a66', textDecoration: 'none' }}>
                      Platform Login
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom bar */}
            <div style={{
              paddingTop: 24, borderTop: '1px solid rgba(255,255,255,.05)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexWrap: 'wrap', gap: 12,
            }}>
              <div style={{ fontSize: 12, color: '#2a4a66' }}>
                © 2026 BuildChain Protocol, Inc. · Delaware C-Corp
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {[
                  'Patent BLDCHN-001-P · Filed 2026',
                  'Powered by XRP Ledger',
                  'Class 042 Trademark',
                  'Non-MSB Compliant',
                ].map((s, i) => (
                  <span key={i} style={{ fontSize: 12, color: '#2a4a66' }}>{s}</span>
                ))}
              </div>
            </div>
          </div>
        </footer>

      </div>
    </>
  )
}
