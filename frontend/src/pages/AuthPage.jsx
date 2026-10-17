import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Login / signup. The design files do not include these screens, so they are built ONLY from the design's own
 * tokens (.ns-card, .ns-field, .ns-btn, .ns-logo, .ns-link from tokens.css) – no new colours or styles.
 */
export default function AuthPage({ mode }) {
  const signup = mode === 'signup';
  const { login, signup: doSignup } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (signup && !form.name.trim()) return setError('Please tell us your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError('Please enter a valid email address.');
    if (signup && form.password.length < 8) return setError('Your password needs at least 8 characters.');
    if (!form.password) return setError('Please enter your password.');
    setBusy(true);
    try {
      if (signup) await doSignup(form.name.trim(), form.email.trim(), form.password);
      else await login(form.email.trim(), form.password);
      nav(signup ? '/assessment' : loc.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ns" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '20px 40px' }}>
        <Link className="ns-logo" to="/"><i />NeuroSync</Link>
      </header>
      <main style={{ flex: 1, width: '100%', maxWidth: 480, margin: '0 auto', padding: '16px 24px 48px', boxSizing: 'border-box' }}>
        <form className="ns-card" style={{ padding: 36 }} onSubmit={submit} noValidate>
          <h1 style={{ fontSize: 28, lineHeight: 1.3, marginBottom: 6 }}>{signup ? 'Create your free account' : 'Welcome back'}</h1>
          <p className="ns-muted" style={{ margin: '0 0 24px' }}>{signup ? 'Save your settings and use them anywhere.' : 'Log in to continue where you left off.'}</p>
          {signup && (
            <div className="ns-field"><label htmlFor="name">Name</label><input id="name" value={form.name} onChange={set('name')} autoComplete="name" /></div>
          )}
          <div className="ns-field"><label htmlFor="email">Email</label><input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" /></div>
          <div className="ns-field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={form.password} onChange={set('password')} autoComplete={signup ? 'new-password' : 'current-password'} aria-describedby={signup ? 'pw-hint' : undefined} />
            {signup && <span id="pw-hint" className="ns-hint">At least 8 characters.</span>}
          </div>
          {error && <p role="alert" className="ns-error" style={{ margin: '0 0 16px' }}>{error}</p>}
          <button className="ns-btn ns-btn-p" style={{ width: '100%' }} disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>
          <p className="ns-hint" style={{ textAlign: 'center', marginTop: 20 }}>
            {signup ? <>Already have an account? <Link className="ns-link" to="/login">Log in</Link></> : <>New to NeuroSync? <Link className="ns-link" to="/signup">Create an account</Link></>}
          </p>
        </form>
        {signup && <p className="ns-hint" style={{ textAlign: 'center', marginTop: 20 }}>NeuroSync stores only your name, email and reading settings. It is not a diagnosis tool.</p>}
      </main>
    </div>
  );
}
