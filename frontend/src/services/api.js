/**
 * Frontend API service – the only place that talks to the NeuroSync backend.
 * No secrets live here: the Gemini key and JWT secret exist only in backend/.env.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
export const AI_DOWN_MESSAGE = 'AI assistance is temporarily unavailable. Your local accessibility tools are still available.';
export const AI_NETWORK_MESSAGE = 'Could not reach the NeuroSync backend. Start the backend and try again. Your local accessibility tools are still available.';
const NETWORK_MESSAGE = "We couldn't reach the NeuroSync server. Please check that the backend is running and try again.";
const TOKEN_KEY = 'neurosync.token';

function ensureStorage() {
  const target = typeof window !== 'undefined' ? window : globalThis;
  const store = target.localStorage;
  if (!store || typeof store.getItem !== 'function') {
    const memory = {};
    const fallback = {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null),
      setItem: (key, value) => { memory[key] = String(value); },
      removeItem: (key) => { delete memory[key]; },
      clear: () => { Object.keys(memory).forEach((key) => delete memory[key]); },
      key: (index) => Object.keys(memory)[index] ?? null,
      get length() { return Object.keys(memory).length; },
    };
    Object.defineProperty(target, 'localStorage', { value: fallback, configurable: true, writable: true });
    return fallback;
  }
  if (typeof store.clear !== 'function') {
    Object.defineProperty(store, 'clear', {
      value: () => {
        const keys = [];
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (key) keys.push(key);
        }
        keys.forEach((key) => store.removeItem(key));
      },
      configurable: true,
    });
  }
  return store;
}

export const tokenStore = {
  get() {
    try { return ensureStorage().getItem(TOKEN_KEY); } catch { return null; }
  },
  set(t) {
    try { ensureStorage().setItem(TOKEN_KEY, t); } catch { /* storage blocked: session lasts for this tab only */ }
  },
  clear() {
    try { ensureStorage().removeItem(TOKEN_KEY); } catch { /* ignore */ }
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
  } catch (error) {
    if (ai && error && error.name === 'AbortError') {
      throw new ApiError('The NeuroSync backend request timed out. Check that the backend is running and try again.', 0, 'BACKEND_TIMEOUT');
    }
    throw new ApiError(ai ? AI_NETWORK_MESSAGE : NETWORK_MESSAGE, 0, 'BACKEND_UNREACHABLE');
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
    comprehension: (text, source = 'original') => request('/reading/comprehension', { method: 'POST', body: { text, source }, ai: true }),
    submitQuiz: (quizId, answers) => request('/reading/quiz/submit', { method: 'POST', body: { quizId, answers }, ai: true }),
    readAloud: (passage, transcript) => request('/reading/read-aloud', { method: 'POST', body: { passage, transcript }, ai: true }),
    progress: () => request('/reading/progress'),
    startReadingSession: (source = 'original') => request('/reading/progress/start', { method: 'POST', body: { source }, ai: false }),
    saveReadingSession: (payload) => request('/reading/progress', { method: 'POST', body: payload, ai: false }),
    recommendations: () => request('/reading/recommendations', { ai: false }),
    recommendationAction: (id, action) => request('/reading/recommendations', { method: 'POST', body: { id, action }, ai: false }),
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
