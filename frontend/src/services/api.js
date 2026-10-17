/**
 * Frontend API service – the only place that talks to the NeuroSync backend.
 * No secrets live here: the Gemini key and JWT secret exist only in backend/.env.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
export const AI_DOWN_MESSAGE = 'AI assistance is temporarily unavailable. Your local accessibility tools are still available.';
const NETWORK_MESSAGE = "We couldn't reach the NeuroSync server. Please check that the backend is running and try again.";
const TOKEN_KEY = 'neurosync.token';

export const tokenStore = {
  get() {
    try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(t) {
    try { window.localStorage.setItem(TOKEN_KEY, t); } catch { /* storage blocked: session lasts for this tab only */ }
  },
  clear() {
    try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, auth = true, ai = false, timeoutMs = 35000 } = {}) {
  const token = tokenStore.get();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(ai ? AI_DOWN_MESSAGE : NETWORK_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && auth && token) window.dispatchEvent(new Event('neurosync:unauthorized'));
    throw new ApiError((data && data.error && data.error.message) || (ai ? AI_DOWN_MESSAGE : 'Something went wrong. Please try again.'), res.status, data && data.error && data.error.code, data && data.error && data.error.details);
  }
  return data;
}

export const api = {
  health: () => request('/health', { auth: false, timeoutMs: 6000 }),
  signup: (name, email, password) => request('/auth/signup', { method: 'POST', body: { name, email, password }, auth: false }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  logout: () => request('/auth/logout', { method: 'POST', body: {} }).catch(() => null),

  profile: {
    get: () => request('/profile'),
    update: (patch) => request('/profile', { method: 'PUT', body: patch }),
    remove: (password) => request('/profile', { method: 'DELETE', body: { password } }),
  },
  dashboard: () => request('/dashboard'),

  assessment: {
    questions: (part = 'core', cursor) => request(`/assessment/questions?part=${part}${cursor !== undefined ? `&cursor=${cursor}` : ''}`),
    start: (part = 'core', mode) => request('/assessment/start', { method: 'POST', body: { part, ...(mode ? { mode } : {}) } }),
    answer: (part, payload) => request('/assessment/answer', { method: 'POST', body: { part, ...payload } }),
    submit: (part = 'core') => request('/assessment/submit', { method: 'POST', body: { part } }),
    results: (part = 'core') => request(`/assessment/results?part=${part}`),
  },

  accessibility: {
    get: () => request('/accessibility/profile'),
    update: (settings) => request('/accessibility/profile', { method: 'PUT', body: { settings } }),
    reset: (to) => request('/accessibility/reset', { method: 'POST', body: { to } }),
  },

  ai: {
    simplify: (text) => request('/simplify', { method: 'POST', body: { text }, ai: true }),
    summarize: (text) => request('/summarize', { method: 'POST', body: { text }, ai: true }),
    word: (word, context) => request('/word-assistance', { method: 'POST', body: { word, ...(context ? { context } : {}) }, ai: true }),
  },

  evaluation: {
    consent: (consent) => request('/evaluation/consent', { method: 'PUT', body: { consent } }),
    submit: (payload) => request('/evaluation', { method: 'POST', body: payload }),
    list: () => request('/evaluation'),
    exportCsv: async () => {
      const res = await fetch(`${API_BASE}/api/evaluation/export`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } }).catch(() => null);
      if (!res || !res.ok) throw new ApiError('The research export is not available for your account.', res ? res.status : 0, 'FORBIDDEN');
      return res.text();
    },
  },

  extension: {
    status: () => request('/extension/status'),
    pairingCode: () => request('/extension/pairing-code', { method: 'POST', body: {} }),
    disconnect: () => request('/extension/disconnect', { method: 'POST', body: {} }),
  },
};
