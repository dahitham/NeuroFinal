import { Link } from 'react-router-dom';
import { s } from '../utils/css.js';
import { useAuth } from '../context/AuthContext.jsx';

/** Landing page – the markup and inline styles come straight from the design (Main.dc.html). Only navigation is wired. */
export default function Landing() {
  const { isAuthenticated: authed } = useAuth();
  const start = authed ? '/dashboard' : '/signup';
  return (
<div className="ns pg-landing" style={s("min-height:900px")}>
<header className="nav" style={s("display:flex;align-items:center;justify-content:space-between;max-width:1160px;margin:0 auto;padding:20px 24px")}>
<Link to="/" style={s("display:flex;align-items:center;gap:10px;font-weight:700;font-size:22px;color:var(--neurosync-dark)")}><span style={s("width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--neurosync-dark) 50%,var(--neurosync-teal) 50%);display:inline-block")}></span>NeuroSync</Link>
<nav aria-label="Primary" style={s("display:flex;gap:28px;font-size:15px;font-weight:500;color:#374151")}><Link to="/">Home</Link><a href="#how">How It Works</a><a href="#features">Features</a><a href="#about">About</a></nav>
<div style={s("display:flex;gap:12px;align-items:center")}><Link to={authed ? "/dashboard" : "/login"} style={s("font-weight:600;padding:12px")}>{authed ? "Dashboard" : "Login"}</Link><Link className="btn p" to={start}>Get Started</Link></div>
</header>

<main>
<section className="hero" style={s("display:grid;grid-template-columns:1.05fr 1fr;gap:56px;align-items:center;max-width:1160px;margin:0 auto;padding:56px 24px 72px")}>
<div>
<p style={s("margin:0 0 16px;display:inline-block;background:var(--ns-teal-tint);color:var(--ns-teal-text);font-weight:600;font-size:14px;padding:6px 14px;border-radius:999px")}>Accessible reading, tailored to you</p>
<h1 style={s("margin:0 0 20px;font-size:56px;line-height:1.1;letter-spacing:-0.01em")}>Personalize the way <span style={s("color:var(--neurosync-teal)")}>you read.</span></h1>
<p style={s("margin:0 0 32px;font-size:19px;color:var(--ns-muted);max-width:520px")}>NeuroSync adapts digital reading experiences to individual accessibility needs, from typography and spacing to focus tools and AI-assisted simplification.</p>
<div style={s("display:flex;gap:14px;flex-wrap:wrap")}><Link className="btn p" to={start}>Get Started</Link><a className="btn s" href="#how">Learn More</a></div>
</div>
<div className="card" style={s("padding:20px")} aria-label="Illustration: the same paragraph shown in default and personalized form">
<div style={s("display:grid;grid-template-columns:1fr 1fr;gap:14px")}>
<div style={s("border:1px solid var(--ns-border);border-radius:14px;padding:16px;background:#fff")}><p style={s("margin:0 0 8px;font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.06em")}>Default</p><p style={s("margin:0;font:14px/1.3 Georgia,serif;color:var(--ns-text)")}>Reading can feel crowded when text is dense, tightly spaced and set in a font that was not chosen for you.</p></div>
<div style={s("border:2px solid var(--ns-teal-strong);border-radius:14px;padding:16px;background:var(--ns-yellow-tint)")}><p style={s("margin:0 0 8px;font-size:12px;font-weight:600;color:var(--ns-teal-text);text-transform:uppercase;letter-spacing:.06em")}>Personalized</p><p style={s("margin:0;font-size:15px;line-height:1.9;letter-spacing:.04em;word-spacing:.12em;color:var(--ns-text)")}>Reading can feel <span style={s("background:var(--neurosync-yellow)")}>calmer</span> when text has room to breathe and the font fits you.</p></div>
</div>
<svg viewBox="0 0 400 90" width="100%" aria-hidden="true" style={s("margin-top:14px")}><path d="M20 60C90 10 150 80 210 40S330 70 380 30" fill="none" style={s("stroke:var(--neurosync-teal)")} strokeWidth="2.5"></path><path d="M20 30C100 70 160 10 230 55S320 20 380 60" fill="none" style={s("stroke:var(--neurosync-dark)")} strokeWidth="2" opacity=".5"></path><circle cx="20" cy="60" r="7" style={s("fill:var(--neurosync-dark)")}></circle><circle cx="110" cy="38" r="6" style={s("fill:var(--neurosync-teal)")}></circle><circle cx="210" cy="40" r="8" style={s("fill:var(--neurosync-yellow)")}></circle><circle cx="300" cy="55" r="6" style={s("fill:var(--neurosync-orange)")}></circle><circle cx="380" cy="30" r="7" style={s("fill:var(--neurosync-coral)")}></circle></svg><div style={s("display:flex;gap:8px;flex-wrap:wrap;margin-top:14px")}><span style={s("background:var(--ns-teal-tint);color:var(--neurosync-dark);font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px")}>Lexend font</span><span style={s("background:var(--ns-teal-tint);color:var(--neurosync-dark);font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px")}>Line spacing</span><span style={s("background:var(--ns-teal-tint);color:var(--neurosync-dark);font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px")}>Soft tint</span><span style={s("background:var(--ns-teal-tint);color:var(--neurosync-dark);font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px")}>Focus support</span></div>
</div>
</section>

<section id="how" style={s("max-width:1160px;margin:0 auto;padding:0 24px 72px")}>
<h2 style={s("margin:0 0 8px;font-size:32px")}>How NeuroSync works</h2>
<p style={s("margin:0 0 28px;color:var(--ns-muted);max-width:620px")}>Three steps from a short questionnaire to a reading experience that fits you.</p>
<div className="grid" style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:20px")}>
<div className="card"><div className="ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 11l3 3 8-8M4 12v7h14"></path></svg></div><h3>1. Take the assessment</h3><p>A calm, short questionnaire about how you read. It is a guide for personalization, not a diagnosis.</p></div>
<div className="card"><div className="ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h10M4 17h14"></path></svg></div><h3>2. Get your settings</h3><p>Receive a recommended assistance level with matching font, spacing, tint and focus options.</p></div>
<div className="card"><div className="ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 2"></path></svg></div><h3>3. Read your way</h3><p>Use it in the app or the browser extension, with AI tools to simplify, summarize and explain words.</p></div>
</div>
</section>

<section id="features" style={s("background:#fff;padding:64px 24px")}>
<div style={s("max-width:1160px;margin:0 auto")} className="grid">
<h2 style={s("margin:0 0 8px;font-size:32px")}>Privacy comes first</h2>
<p style={s("margin:0 0 28px;color:var(--ns-muted);max-width:620px")}>You choose what is stored and whether your data supports research. Settings can be changed or removed at any time.</p>
<Link className="btn p" to={start}>{authed ? "Open your dashboard" : "Create your free account"}</Link>
</div>
</section>
</main>
<footer id="about" style={s("max-width:1160px;margin:0 auto;padding:28px 24px;color:var(--ns-muted);font-size:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px")}><span>NeuroSync · A college research project</span><span><a href="#">About</a> · <a href="#">Privacy</a> · <a href="#">Contact</a></span></footer>
</div>
  );
}
