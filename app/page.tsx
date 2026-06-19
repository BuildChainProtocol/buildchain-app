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
        @keyframes orb-drift-1 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(40px,-30px) scale(1.06); }
          66%      { transform: translate(-25px,20px) scale(0.94); }
        }
        @keyframes orb-drift-2 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(-30px,25px) scale(1.1); }
          66%      { transform: translate(20px,-15px) scale(0.9); }
        }
        @keyframes orb-drift-3 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(20px,30px) scale(1.04); }
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
          0%   { transform:scale(1); opacity:.5; }
          100% { transform:scale(1.55); opacity:0; }
        }
        @keyframes shimmer-badge {
          0%   { background-position:-200% center; }
          100% { background-position:200% center; }
        }

        .orb1 { animation: orb-drift-1 22s ease-in-out infinite; }
        .orb2 { animation: orb-drift-2 28s ease-in-out infinite; }
        .orb3 { animation: orb-drift-3 19s ease-in-out infinite; }

        .flow-dot {
          position:absolute; width:7px; height:7px; border-radius:50%;
          top:50%; transform:translateY(-50%);
          animation: flow-left 2.8s linear infinite;
        }
        .flow-dot.d1 { animation-delay:.9s; }
        .flow-dot.d2 { animation-delay:1.9s; }
        .flow-dot-r {
          position:absolute; width:7px; height:7px; border-radius:50%;
          top:50%; transform:translateY(-50%);
          animation: flow-right 2.8s linear infinite;
        }
        .flow-dot-r.d1 { animation-delay:.9s; }
        .flow-dot-r.d2 { animation-delay:1.9s; }

        .pulse-ring {
          position:absolute; inset:-5px; border-radius:50%;
          border:1px solid rgba(201,168,76,.45);
          animation: pulse-ring 2.2s ease-out infinite;
        }
        .pulse-ring-2 {
          position:absolute; inset:-5px; border-radius:50%;
          border:1px solid rgba(201,168,76,.25);
          animation: pulse-ring 2.2s ease-out infinite;
          animation-delay:1.1s;
        }

        .grad-gold {
          background:linear-gradient(135deg,#ffffff 0%,#e8d5a0 50%,#c9a84c 100%);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
        }
        .grad-blue {
          background:linear-gradient(135deg,#ffffff 0%,#a8c8f0 50%,#2d7dd2 100%);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
        }
        .grad-stat {
          background:linear-gradient(135deg,#e8d5a0 0%,#c9a84c 100%);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
        }

        .glass {
          background:linear-gradient(135deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.01) 100%);
          border:1px solid rgba(255,255,255,.08);
          backdrop-filter:blur(16px);
        }

        .grid-bg {
          background-image:
            linear-gradient(rgba(42,63,87,.12) 1px,transparent 1px),
            linear-gradient(90deg,rgba(42,63,87,.12) 1px,transparent 1px);
          background-size:64px 64px;
        }

        .btn-gold {
          display:inline-block;
          background:linear-gradient(135deg,#c9a84c 0%,#e8c97a 100%);
          color:#080e16; font-weight:800; font-size:15px;
          padding:14px 30px; border-radius:11px; text-decoration:none;
          letter-spacing:-.2px; transition:all .18s;
        }
        .btn-gold:hover { transform:translateY(-2px); box-shadow:0 10px 30px rgba(201,168,76,.35); }

        .btn-ghost {
          display:inline-block;
          background:rgba(255,255,255,.05);
          color:#e8edf2; font-weight:600; font-size:15px;
          padding:14px 28px; border-radius:11px; text-decoration:none;
          border:1px solid rgba(255,255,255,.12); transition:all .18s;
        }
        .btn-ghost:hover { background:rgba(255,255,255,.09); border-color:rgba(255,255,255,.22); }

        .feature-card { transition:all .2s ease; }
        .feature-card:hover {
          border-color:rgba(201,168,76,.3) !important;
          transform:translateY(-3px);
          box-shadow:0 12px 40px rgba(0,0,0,.3);
        }

        .nav-link { transition:color .15s; }
        .nav-link:hover { color:#e8edf2 !important; }

        @media(max-width:900px){
          .hide-sm { display:none !important; }
          .three-col { grid-template-columns:1fr !important; }
          .tech-grid { grid-template-columns:1fr !important; }
          .hero-h1 { font-size:48px !important; letter-spacing:-1.5px !important; }
          .connector { display:none !important; }
        }
        @media(max-width:600px){
          .hero-h1 { font-size:38px !important; }
          .nav-cta-text { display:none !important; }
          section { padding-left:20px !important; padding-right:20px !important; }
          nav { padding-left:20px !important; padding-right:20px !important; }
        }
      `}</style>

      <div style={{ background:'#080e16', color:'#e8edf2', fontFamily:"Inter,system-ui,-apple-system,sans-serif", minHeight:'100vh', overflowX:'hidden' }}>

        {/* ── AMBIENT ORBS ── */}
        <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:0, overflow:'hidden' }}>
          <div className="orb1" style={{ position:'absolute', width:800, height:800, top:-250, left:-200,
            background:'radial-gradient(circle,rgba(201,168,76,.07) 0%,transparent 68%)' }} />
          <div className="orb2" style={{ position:'absolute', width:700, height:700, top:80, right:-150,
            background:'radial-gradient(circle,rgba(45,125,210,.09) 0%,transparent 68%)' }} />
          <div className="orb3" style={{ position:'absolute', width:600, height:600, bottom:-100, left:'35%',
            background:'radial-gradient(circle,rgba(26,179,166,.07) 0%,transparent 68%)' }} />
        </div>

        {/* ── NAV ── */}
        <nav style={{
          position:'fixed', top:0, left:0, right:0, zIndex:200,
          background:'rgba(8,14,22,.82)', backdropFilter:'blur(24px)',
          borderBottom:'1px solid rgba(255,255,255,.06)',
          padding:'0 48px', height:64,
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          {/* Logo + links */}
          <div style={{ display:'flex', alignItems:'center', gap:36 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{
                width:34, height:34, borderRadius:9,
                background:'linear-gradient(135deg,#c9a84c 0%,#e8c97a 100%)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:12, fontWeight:900, color:'#080e16', flexShrink:0,
              }}>BC</div>
              <span style={{ fontSize:16, fontWeight:900, letterSpacing:'-.4px', whiteSpace:'nowrap' }}>
                Build<span style={{ color:'#c9a84c' }}>Chain</span>
              </span>
            </div>
            <div className="hide-sm" style={{ display:'flex', gap:28 }}>
              {[['Platform','#platform'],['How it Works','#how-it-works'],['Technology','#technology']].map(([label,href]) => (
                <a key={label} href={href} className="nav-link"
                  style={{ fontSize:13, color:'#4a6a86', textDecoration:'none', fontWeight:500 }}>{label}</a>
              ))}
            </div>
          </div>
          {/* Right */}
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <Link href="/login" style={{ fontSize:13, color:'#4a6a86', textDecoration:'none', fontWeight:500 }}>Log in</Link>
            <a href="mailto:jcaruso27@yahoo.com?subject=BuildChain Demo Request"
              style={{
                background:'linear-gradient(135deg,#c9a84c 0%,#e8c97a 100%)',
                color:'#080e16', fontWeight:800, fontSize:13,
                padding:'8px 18px', borderRadius:8, textDecoration:'none',
              }}>
              <span className="nav-cta-text">Request </span>Demo
            </a>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section className="grid-bg" style={{ position:'relative', zIndex:1, paddingTop:152, paddingBottom:100, paddingLeft:48, paddingRight:48, textAlign:'center' }}>
          {/* Fade grid at edges */}
          <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse 90% 55% at 50% 0%, transparent 55%, #080e16 100%)', pointerEvents:'none' }} />

          <div style={{ position:'relative', maxWidth:900, margin:'0 auto' }}>

            {/* Live badge */}
            <div style={{
              display:'inline-flex', alignItems:'center', gap:8,
              background:'rgba(201,168,76,.07)', border:'1px solid rgba(201,168,76,.22)',
              borderRadius:100, padding:'7px 18px', marginBottom:44,
            }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:'#c9a84c',
                boxShadow:'0 0 8px rgba(201,168,76,.8)' }} />
              <span style={{ fontSize:12, fontWeight:700, color:'#c9a84c', letterSpacing:'.04em' }}>
                Patent-Protected · BLDCHN-001-P · Powered by XRP Ledger
              </span>
            </div>

            <h1 className="hero-h1" style={{
              fontSize:76, fontWeight:900, lineHeight:1.02,
              letterSpacing:'-3px', margin:'0 0 28px',
            }}>
              <span className="grad-gold">Where Construction</span><br />
              <span style={{ color:'#e8edf2' }}>Meets Capital.</span>
            </h1>

            <p style={{ fontSize:19, color:'#4a6a86', lineHeight:1.75, maxWidth:600, margin:'0 auto 52px', fontWeight:400 }}>
              BuildChain is the single platform connecting lenders, developers, and contractors — automating every draw request, site inspection, and fund release through blockchain-verified smart escrow.
            </p>

            <div style={{ display:'flex', gap:14, justifyContent:'center', flexWrap:'wrap', marginBottom:88 }}>
              <a href="mailto:jcaruso27@yahoo.com?subject=BuildChain Demo Request" className="btn-gold">
                Get Early Access →
              </a>
              <a href="#how-it-works" className="btn-ghost">See how it works</a>
            </div>

            {/* ── PLATFORM PREVIEW MOCKUP ── */}
            <div style={{
              background:'linear-gradient(160deg,rgba(22,32,50,.95) 0%,rgba(8,14,22,.98) 100%)',
              border:'1px solid rgba(255,255,255,.07)',
              borderRadius:22,
              overflow:'hidden',
              boxShadow:'0 0 0 1px rgba(201,168,76,.04), 0 48px 120px rgba(0,0,0,.7)',
            }}>
              {/* Browser chrome */}
              <div style={{
                background:'rgba(8,14,22,.85)', borderBottom:'1px solid rgba(255,255,255,.06)',
                padding:'12px 20px', display:'flex', alignItems:'center', gap:10,
              }}>
                <div style={{ display:'flex', gap:6 }}>
                  {['#ff5f57','#febc2e','#28c840'].map((c,i) => (
                    <div key={i} style={{ width:10, height:10, borderRadius:'50%', background:c, opacity:.7 }} />
                  ))}
                </div>
                <div style={{
                  flex:1, background:'rgba(255,255,255,.04)', borderRadius:7,
                  padding:'5px 14px', fontSize:11, color:'#2a4a66',
                  textAlign:'center', maxWidth:280, margin:'0 auto',
                }}>app.buildchain.io/lender</div>
              </div>

              {/* Dashboard content */}
              <div style={{ display:'grid', gridTemplateColumns:'200px 1fr', gap:0 }}>

                {/* Sidebar */}
                <div style={{ borderRight:'1px solid rgba(255,255,255,.05)', padding:'20px 12px' }}>
                  {[
                    { icon:'◎', label:'Portfolio', active:false },
                    { icon:'↑', label:'Draw Requests', active:true },
                    { icon:'✓', label:'Inspections', active:false },
                    { icon:'📋', label:'Documents', active:false },
                    { icon:'∿', label:'Reports', active:false },
                  ].map((item,i) => (
                    <div key={i} style={{
                      padding:'9px 12px', borderRadius:9, fontSize:12, fontWeight:500,
                      display:'flex', alignItems:'center', gap:8, marginBottom:2,
                      background:item.active ? 'rgba(201,168,76,.1)' : 'transparent',
                      color:item.active ? '#c9a84c' : '#2a4a66',
                      borderLeft:item.active ? '2px solid #c9a84c' : '2px solid transparent',
                    }}>
                      <span style={{ fontSize:10 }}>{item.icon}</span>{item.label}
                    </div>
                  ))}
                </div>

                {/* Main panel */}
                <div style={{ padding:'20px' }}>
                  {/* Stat row */}
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                    {[
                      { label:'In Escrow', value:'$1.24M', color:'#c9a84c' },
                      { label:'Active Draws', value:'4', color:'#2d7dd2' },
                      { label:'Released Today', value:'$285K', color:'#1ab3a6' },
                    ].map((s,i) => (
                      <div key={i} style={{
                        background:'rgba(255,255,255,.03)',
                        border:'1px solid rgba(255,255,255,.06)',
                        borderRadius:10, padding:'12px 14px',
                      }}>
                        <div style={{ fontSize:20, fontWeight:900, color:s.color, letterSpacing:'-0.5px' }}>{s.value}</div>
                        <div style={{ fontSize:10, color:'#2a4a66', marginTop:3 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Auto-release success card */}
                  <div style={{
                    background:'rgba(26,179,166,.06)', border:'1px solid rgba(26,179,166,.2)',
                    borderRadius:10, padding:'14px 16px', marginBottom:12,
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:9 }}>
                      <span style={{ fontSize:11, fontWeight:800, color:'#1ab3a6', letterSpacing:'.04em' }}>
                        ⬡ DUAL-CONDITION AUTO-RELEASE · Draw #DR-0014
                      </span>
                      <span style={{ fontSize:10, color:'#2a4a66' }}>just now</span>
                    </div>
                    <div style={{ display:'flex', gap:20, marginBottom:8 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#1ab3a6' }}>
                        <span>✓</span><span>Inspector credential NFT</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#1ab3a6' }}>
                        <span>✓</span><span>Lien waiver NFT on-ledger</span>
                      </div>
                    </div>
                    <div style={{ fontSize:10, color:'#2a4a66', fontFamily:'monospace' }}>
                      EscrowFinish · $285,000 released · Patent BLDCHN-001-P §V
                    </div>
                  </div>

                  {/* Project draw bars */}
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {[
                      { name:'Riverside Commons · Phase 3', pct:68, status:'approved', color:'#c9a84c' },
                      { name:'Harbor View Plaza · Foundation', pct:34, status:'pending inspection', color:'#2d7dd2' },
                    ].map((p,i) => (
                      <div key={i} style={{
                        background:'rgba(255,255,255,.02)', border:'1px solid rgba(255,255,255,.05)',
                        borderRadius:9, padding:'10px 14px',
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                          <span style={{ fontSize:11, color:'#8fa8c4', fontWeight:500 }}>{p.name}</span>
                          <span style={{ fontSize:10, color:p.color, fontWeight:700 }}>{p.pct}%</span>
                        </div>
                        <div style={{ height:3, background:'rgba(255,255,255,.06)', borderRadius:2 }}>
                          <div style={{ width:`${p.pct}%`, height:'100%', background:p.color, borderRadius:2 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── THREE WORLDS ── */}
        <section id="platform" style={{ position:'relative', zIndex:1, padding:'120px 48px', textAlign:'center' }}>
          <div style={{ maxWidth:1160, margin:'0 auto' }}>

            <span style={{ fontSize:11, fontWeight:700, color:'#c9a84c', textTransform:'uppercase', letterSpacing:'.15em' }}>
              The Platform
            </span>
            <h2 style={{ fontSize:'clamp(32px,4vw,54px)', fontWeight:900, letterSpacing:'-1.5px', margin:'16px 0 20px', lineHeight:1.1 }}>
              Three industries.<br />
              <span className="grad-blue">One seamless connection.</span>
            </h2>
            <p style={{ fontSize:17, color:'#4a6a86', maxWidth:520, margin:'0 auto 88px', lineHeight:1.75 }}>
              For the first time, everyone in the construction loan chain operates from the same verified data — no handoffs, no phone calls, no disputes.
            </p>

            {/* Three-pillar layout */}
            <div className="three-col" style={{
              display:'grid', gridTemplateColumns:'1fr 100px 1fr 100px 1fr',
              alignItems:'center', gap:0,
            }}>

              {/* LEFT: CONSTRUCTION */}
              <div className="glass feature-card" style={{ borderRadius:20, padding:'40px 32px', textAlign:'left', borderTop:'1px solid rgba(201,168,76,.18)' }}>
                <div style={{
                  width:54, height:54, borderRadius:14,
                  background:'rgba(201,168,76,.09)', border:'1px solid rgba(201,168,76,.18)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:26, marginBottom:24,
                }}>🏗</div>
                <div style={{ fontSize:10, fontWeight:800, color:'#c9a84c', textTransform:'uppercase', letterSpacing:'.12em', marginBottom:8 }}>Construction</div>
                <h3 style={{ fontSize:22, fontWeight:900, margin:'0 0 16px', letterSpacing:'-.4px', lineHeight:1.25 }}>
                  Built for<br />the job site.
                </h3>
                <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
                  {['G702/G703 draw requests','Inspector portal (token-gated)','Phase-based disbursements','Building Block AI for GCs'].map((f,i) => (
                    <div key={i} style={{ display:'flex', gap:9, alignItems:'center', fontSize:13, color:'#4a6a86' }}>
                      <div style={{ width:4, height:4, borderRadius:'50%', background:'#c9a84c', flexShrink:0 }} />{f}
                    </div>
                  ))}
                </div>
              </div>

              {/* CONNECTOR LEFT */}
              <div className="connector" style={{ position:'relative', height:2, background:'linear-gradient(90deg,rgba(201,168,76,.35),rgba(45,125,210,.35))' }}>
                <div className="flow-dot" style={{ background:'#c9a84c' }} />
                <div className="flow-dot d1" style={{ background:'#c9a84c' }} />
              </div>

              {/* CENTER: BUILDCHAIN */}
              <div style={{
                background:'linear-gradient(135deg,rgba(201,168,76,.07) 0%,rgba(45,125,210,.05) 100%)',
                border:'1px solid rgba(201,168,76,.22)',
                borderRadius:24, padding:'52px 32px', textAlign:'center',
                boxShadow:'0 0 80px rgba(201,168,76,.05), 0 0 0 1px rgba(201,168,76,.04)',
                position:'relative',
              }}>
                {/* Pulse rings */}
                <div style={{ position:'relative', display:'inline-block', marginBottom:24 }}>
                  <div className="pulse-ring" />
                  <div className="pulse-ring-2" />
                  <div style={{
                    width:76, height:76, borderRadius:'50%',
                    background:'linear-gradient(135deg,#c9a84c 0%,#e8c97a 100%)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:26, fontWeight:900, color:'#080e16', position:'relative', zIndex:1,
                  }}>⬡</div>
                </div>
                <div style={{ fontSize:22, fontWeight:900, letterSpacing:'-.5px', marginBottom:8 }}>BuildChain</div>
                <div style={{ fontSize:12, color:'#4a6a86', lineHeight:1.7 }}>Patent-protected<br />dual-condition engine</div>
                <div style={{
                  marginTop:20, display:'inline-block',
                  background:'rgba(201,168,76,.08)', border:'1px solid rgba(201,168,76,.2)',
                  borderRadius:100, padding:'5px 14px',
                  fontSize:10, fontWeight:800, color:'#c9a84c', letterSpacing:'.06em',
                }}>BLDCHN-001-P</div>
              </div>

              {/* CONNECTOR RIGHT */}
              <div className="connector" style={{ position:'relative', height:2, background:'linear-gradient(90deg,rgba(45,125,210,.35),rgba(45,125,210,.35))' }}>
                <div className="flow-dot-r" style={{ background:'#2d7dd2' }} />
                <div className="flow-dot-r d2" style={{ background:'#2d7dd2' }} />
              </div>

              {/* RIGHT: CAPITAL */}
              <div className="glass feature-card" style={{ borderRadius:20, padding:'40px 32px', textAlign:'left', borderTop:'1px solid rgba(45,125,210,.18)' }}>
                <div style={{
                  width:54, height:54, borderRadius:14,
                  background:'rgba(45,125,210,.09)', border:'1px solid rgba(45,125,210,.18)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:26, marginBottom:24,
                }}>🏦</div>
                <div style={{ fontSize:10, fontWeight:800, color:'#2d7dd2', textTransform:'uppercase', letterSpacing:'.12em', marginBottom:8 }}>Capital</div>
                <h3 style={{ fontSize:22, fontWeight:900, margin:'0 0 16px', letterSpacing:'-.4px', lineHeight:1.25 }}>
                  Built for<br />the lending desk.
                </h3>
                <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
                  {['Portfolio dashboard & LTV tracking','Automated escrow disbursement','On-chain compliance receipts','Lien waiver NFT management'].map((f,i) => (
                    <div key={i} style={{ display:'flex', gap:9, alignItems:'center', fontSize:13, color:'#4a6a86' }}>
                      <div style={{ width:4, height:4, borderRadius:'50%', background:'#2d7dd2', flexShrink:0 }} />{f}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom value strip */}
            <div style={{
              marginTop:48, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',
              gap:1, background:'rgba(255,255,255,.04)',
              border:'1px solid rgba(255,255,255,.06)', borderRadius:16, overflow:'hidden',
            }}>
              {[
                { v:'$0', l:'Manual intervention required', note:'for each draw release' },
                { v:'3–5s', l:'XRPL settlement speed', note:'vs. 3–5 days legacy wire' },
                { v:'2', l:'On-chain conditions required', note:'simultaneously — both, always' },
                { v:'100%', l:'Immutable audit trail', note:'every draw, every release' },
              ].map((s,i) => (
                <div key={i} style={{ background:'rgba(8,14,22,.8)', padding:'28px 22px' }}>
                  <div className="grad-stat" style={{ fontSize:36, fontWeight:900, letterSpacing:'-1.5px' }}>{s.v}</div>
                  <div style={{ fontSize:13, color:'#e8edf2', fontWeight:700, marginTop:6 }}>{s.l}</div>
                  <div style={{ fontSize:11, color:'#2a4a66', marginTop:3 }}>{s.note}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" style={{
          position:'relative', zIndex:1, padding:'120px 48px',
          background:'rgba(10,16,24,.7)',
          borderTop:'1px solid rgba(255,255,255,.04)',
          borderBottom:'1px solid rgba(255,255,255,.04)',
        }}>
          <div style={{ maxWidth:1160, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:80 }}>
              <span style={{ fontSize:11, fontWeight:700, color:'#c9a84c', textTransform:'uppercase', letterSpacing:'.15em', display:'block', marginBottom:16 }}>
                How it works
              </span>
              <h2 style={{ fontSize:'clamp(30px,4vw,52px)', fontWeight:900, letterSpacing:'-1.5px', margin:'0 0 20px', lineHeight:1.1 }}>
                Two conditions.<br />
                <span className="grad-gold">One automatic release.</span>
              </h2>
              <p style={{ fontSize:17, color:'#4a6a86', maxWidth:500, margin:'0 auto', lineHeight:1.75 }}>
                No manual wires. No approval delays. Funds move the instant the ledger confirms both conditions — and not a moment before.
              </p>
            </div>

            {/* Steps */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:16, position:'relative' }}>
              {[
                {
                  n:'01', icon:'📋', color:'#4a6a86', hl:false,
                  title:'Draw Submitted',
                  body:'Borrower submits draw with G703 schedule of values. Lender approves — BuildChain creates an XRPL EscrowCreate, locking funds on-chain.',
                  tag:'EscrowCreate · XRPL',
                },
                {
                  n:'02', icon:'🔍', color:'#c9a84c', hl:true,
                  title:'Site Inspected',
                  body:'Licensed inspector submits report via token-gated portal. On pass, BuildChain mints an XLS-20 Inspector Credential NFT (taxon 3) — tamper-proof, permanent.',
                  tag:'NFT taxon 3 · Condition ①',
                },
                {
                  n:'03', icon:'📝', color:'#c9a84c', hl:true,
                  title:'Lien Waiver Confirmed',
                  body:"Lender confirms lien waiver receipt. BuildChain mints a Lien Waiver NFT (taxon 2). That's Condition ② satisfied.",
                  tag:'NFT taxon 2 · Condition ②',
                },
                {
                  n:'04', icon:'⚡', color:'#1ab3a6', hl:false,
                  title:'Auto-Released',
                  body:'The Verification Orchestrator detects both NFTs simultaneously and fires EscrowFinish — funds released in 3–5 seconds. Zero manual steps.',
                  tag:'EscrowFinish · Auto · §V',
                },
              ].map((step,i) => (
                <div key={i} className={step.hl ? '' : 'feature-card'} style={{
                  background: step.hl ? 'rgba(201,168,76,.04)' : 'rgba(18,28,42,.7)',
                  border:`1px solid ${step.hl ? 'rgba(201,168,76,.2)' : 'rgba(255,255,255,.06)'}`,
                  borderRadius:18, padding:'32px 28px',
                }}>
                  <div style={{ fontSize:10, fontWeight:900, color:step.hl ? '#c9a84c' : 'rgba(255,255,255,.12)', letterSpacing:'.1em', marginBottom:18 }}>{step.n}</div>
                  <div style={{ fontSize:28, marginBottom:16 }}>{step.icon}</div>
                  <h3 style={{ fontSize:17, fontWeight:800, margin:'0 0 12px', letterSpacing:'-.3px' }}>{step.title}</h3>
                  <p style={{ fontSize:13, color:'#4a6a86', lineHeight:1.75, margin:'0 0 20px' }}>{step.body}</p>
                  <div style={{
                    fontSize:10, fontWeight:700, fontFamily:'monospace',
                    color:step.color,
                    background:step.hl ? 'rgba(201,168,76,.08)' : 'rgba(45,125,210,.08)',
                    padding:'4px 10px', borderRadius:6, display:'inline-block',
                  }}>{step.tag}</div>
                </div>
              ))}
            </div>

            {/* Verification receipt */}
            <div style={{
              marginTop:28, padding:'22px 28px', borderRadius:14,
              background:'rgba(45,125,210,.05)', border:'1px solid rgba(45,125,210,.15)',
              display:'flex', alignItems:'center', gap:18, flexWrap:'wrap',
            }}>
              <div style={{ fontSize:26, color:'#2d7dd2' }}>⬡</div>
              <div style={{ flex:1, minWidth:240 }}>
                <div style={{ fontSize:13, fontWeight:800, marginBottom:4 }}>Verification Receipt — generated on every auto-release</div>
                <div style={{ fontSize:12, color:'#4a6a86', lineHeight:1.7 }}>
                  Inspector NFT ID · Lien Waiver NFT ID · EscrowFinish tx hash · ISO timestamp · Patent ref BLDCHN-001-P §V — stored as an immutable JSONB receipt, always available for regulators, title companies, and auditors.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── TECHNOLOGY ── */}
        <section id="technology" style={{ position:'relative', zIndex:1, padding:'120px 48px' }}>
          <div className="tech-grid" style={{ maxWidth:1160, margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:80, alignItems:'start' }}>

            <div>
              <span style={{ fontSize:11, fontWeight:700, color:'#1ab3a6', textTransform:'uppercase', letterSpacing:'.15em', display:'block', marginBottom:16 }}>Technology</span>
              <h2 style={{ fontSize:'clamp(28px,3.5vw,46px)', fontWeight:900, letterSpacing:'-1px', margin:'0 0 22px', lineHeight:1.15 }}>
                Protocol-level.<br />
                <span className="grad-blue">Not smart contracts.</span>
              </h2>
              <p style={{ fontSize:16, color:'#4a6a86', lineHeight:1.85, margin:'0 0 44px' }}>
                BuildChain runs on the XRP Ledger&apos;s native escrow and XLS-20 NFT standard — no Solidity, no gas fees, no contract vulnerabilities. Settlement in 3–5 seconds, at $0.0001 per transaction.
              </p>

              <div style={{ display:'flex', flexDirection:'column', gap:28 }}>
                {[
                  { color:'#c9a84c', title:'XLS-20 NFT Standard', body:'Taxon 0 (loan titles) · Taxon 2 (lien waivers) · Taxon 3 (inspector credentials). All non-transferable, on-ledger, permanent proof of each condition.' },
                  { color:'#2d7dd2', title:'Native XRPL Escrow', body:'EscrowCreate locks loan funds at draw approval. EscrowFinish executes automatically the instant both NFTs are detected on-chain.' },
                  { color:'#1ab3a6', title:'RLUSD Disbursements', body:'Stablecoin draw releases via Ripple USD. One environment variable away — ESCROW_CURRENCY=RLUSD — when XRPL Hooks go live.' },
                ].map((t,i) => (
                  <div key={i} style={{ display:'flex', gap:18 }}>
                    <div style={{ width:3, borderRadius:2, background:t.color, flexShrink:0, alignSelf:'stretch', minHeight:60 }} />
                    <div>
                      <div style={{ fontSize:14, fontWeight:800, color:t.color, marginBottom:5 }}>{t.title}</div>
                      <div style={{ fontSize:13, color:'#4a6a86', lineHeight:1.8 }}>{t.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* Patent */}
              <div style={{
                background:'linear-gradient(135deg,rgba(201,168,76,.06) 0%,rgba(8,14,22,.8) 100%)',
                border:'1px solid rgba(201,168,76,.2)',
                borderRadius:16, padding:'28px',
                boxShadow:'0 0 50px rgba(201,168,76,.04)',
              }}>
                <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
                  <div style={{ fontSize:32, flexShrink:0 }}>🛡</div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:800, color:'#c9a84c', marginBottom:6 }}>Provisional Patent BLDCHN-001-P</div>
                    <div style={{ fontSize:13, color:'#4a6a86', lineHeight:1.7 }}>
                      &ldquo;Multi-Condition Verification System and Method for Automated Construction Draw Disbursement Using Distributed Ledger Technology&rdquo;
                    </div>
                    <div style={{ marginTop:12, fontSize:11, color:'#2a4a66' }}>
                      Filed April 20, 2026 · Non-provisional due April 20, 2027
                    </div>
                  </div>
                </div>
              </div>

              {/* NFT Taxon grid */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {[
                  { taxon:'Taxon 0', type:'Loan NFT', desc:'Minted at origination, burned at payoff', hl:false },
                  { taxon:'Taxon 1', type:'Draw Event', desc:'Records each disbursement event', hl:false },
                  { taxon:'Taxon 2', type:'Lien Waiver', desc:'⚡ Condition ② — triggers release', hl:true },
                  { taxon:'Taxon 3', type:'Inspector Cred', desc:'⚡ Condition ① — triggers release', hl:true },
                ].map((n,i) => (
                  <div key={i} style={{
                    background:n.hl ? 'rgba(201,168,76,.05)' : 'rgba(255,255,255,.02)',
                    border:`1px solid ${n.hl ? 'rgba(201,168,76,.2)' : 'rgba(255,255,255,.06)'}`,
                    borderRadius:11, padding:'16px',
                  }}>
                    <div style={{ fontSize:10, fontWeight:800, color:n.hl ? '#c9a84c' : '#2a4a66', marginBottom:4, letterSpacing:'.05em' }}>XLS-20 {n.taxon}</div>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>{n.type}</div>
                    <div style={{ fontSize:11, color:'#2a4a66', lineHeight:1.55 }}>{n.desc}</div>
                  </div>
                ))}
              </div>

              {/* XRPL speed card */}
              <div style={{
                background:'rgba(45,125,210,.05)', border:'1px solid rgba(45,125,210,.15)',
                borderRadius:14, padding:'20px 22px',
                display:'flex', gap:20, alignItems:'center',
              }}>
                <div style={{ fontSize:32 }}>⚡</div>
                <div>
                  <div style={{ fontSize:22, fontWeight:900, color:'#2d7dd2', letterSpacing:'-.5px' }}>3–5 sec</div>
                  <div style={{ fontSize:12, color:'#4a6a86', marginTop:3 }}>XRPL settlement · $0.0001 per tx · No gas wars</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section style={{
          position:'relative', zIndex:1,
          padding:'130px 48px', textAlign:'center',
          background:'linear-gradient(180deg,transparent 0%,rgba(10,16,24,.9) 100%)',
          borderTop:'1px solid rgba(255,255,255,.04)',
          overflow:'hidden',
        }}>
          {/* Gold glow */}
          <div style={{
            position:'absolute', width:600, height:400, top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            background:'radial-gradient(ellipse,rgba(201,168,76,.06) 0%,transparent 70%)',
            pointerEvents:'none',
          }} />

          <div style={{ position:'relative', maxWidth:660, margin:'0 auto' }}>
            <div style={{
              display:'inline-block',
              background:'rgba(201,168,76,.07)', border:'1px solid rgba(201,168,76,.2)',
              borderRadius:100, padding:'8px 20px', marginBottom:36,
              fontSize:12, color:'#c9a84c', fontWeight:700, letterSpacing:'.04em',
            }}>Currently accepting early-access partners</div>

            <h2 style={{ fontSize:'clamp(32px,5vw,58px)', fontWeight:900, letterSpacing:'-2px', margin:'0 0 24px', lineHeight:1.05 }}>
              The future of construction<br />
              <span className="grad-gold">lending is on-chain.</span>
            </h2>
            <p style={{ fontSize:17, color:'#4a6a86', margin:'0 auto 52px', maxWidth:480, lineHeight:1.75 }}>
              Whether you fund projects, develop them, or build them — BuildChain eliminates the friction between your world and capital.
            </p>
            <div style={{ display:'flex', gap:14, justifyContent:'center', flexWrap:'wrap' }}>
              <a href="mailto:jcaruso27@yahoo.com?subject=BuildChain Early Access" className="btn-gold" style={{ fontSize:16, padding:'16px 36px' }}>
                Request Early Access →
              </a>
              <Link href="/login" className="btn-ghost" style={{ padding:'16px 28px' }}>
                Log in to platform
              </Link>
            </div>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{
          position:'relative', zIndex:1,
          borderTop:'1px solid rgba(255,255,255,.06)',
          padding:'36px 48px',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:20,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{
              width:30, height:30, borderRadius:8,
              background:'linear-gradient(135deg,#c9a84c 0%,#e8c97a 100%)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:10, fontWeight:900, color:'#080e16',
            }}>BC</div>
            <span style={{ fontSize:15, fontWeight:900 }}>Build<span style={{ color:'#c9a84c' }}>Chain</span></span>
            <span style={{ fontSize:12, color:'#2a4a66' }}>Construction Loan Protocol</span>
          </div>
          <div style={{ display:'flex', gap:28, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontSize:12, color:'#2a4a66' }}>Patent BLDCHN-001-P · Filed 2026</span>
            <span style={{ fontSize:12, color:'#2a4a66' }}>Powered by XRP Ledger</span>
            <Link href="/login" style={{ fontSize:12, color:'#c9a84c', textDecoration:'none', fontWeight:700 }}>
              Platform login →
            </Link>
          </div>
        </footer>

      </div>
    </>
  )
}
