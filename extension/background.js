/* NeuroSync background service worker.
 * - pairs with the NeuroSync backend using a one-time code shown in the web app (Dashboard → Browser Extension)
 * - keeps the user's settings in sync (chrome.storage.local)
 * - relays AI requests to the NeuroSync backend (the extension never holds a Gemini key or JWT secret)
 */
importScripts('content/neurosync-engine.js');

const DEFAULT_API = 'http://localhost:4000';
const ENDPOINTS = {
  simplify: '/api/simplify',
  summarize: '/api/summarize',
  word: '/api/word-assistance',
  comprehension: '/api/reading/comprehension',
  quizSubmit: '/api/reading/quiz/submit',
};
const KEYS = Object.keys(self.NeuroSyncEngine.DEFAULT_SETTINGS);
let vocabPromise = null;

const store = {
  get: (k) => chrome.storage.local.get(k),
  set: (o) => chrome.storage.local.set(o),
  remove: (k) => chrome.storage.local.remove(k),
};

function sanitizeSettings(obj) {
  const defaults = self.NeuroSyncEngine.DEFAULT_SETTINGS;
  const clean = {};
  KEYS.forEach((k) => {
    if (obj && k in obj && typeof obj[k] === typeof defaults[k]) clean[k] = obj[k];
  });
  return clean;
}

async function api(path, { method = 'GET', body, token, timeoutMs = 20000 } = {}) {
  const { ns_api } = await store.get('ns_api');
  const apiBase = ns_api || DEFAULT_API;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(apiBase + path, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!data) {
      return {
        ok: false,
        status: res.status,
        data: { error: { code: 'INVALID_RESPONSE', message: `NeuroSync returned an unreadable response (HTTP ${res.status}). Please check the backend logs.` } },
      };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    const message = timedOut
      ? 'The NeuroSync backend request timed out. Check that the backend is running and try again.'
      : `Could not connect to the NeuroSync backend at ${apiBase}. Start the backend and try again.`;
    return { ok: false, status: 0, data: { error: { code: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_UNREACHABLE', message } } };
  } finally {
    clearTimeout(timer);
  }
}

async function syncNow() {
  const { ns_token } = await store.get('ns_token');
  if (!ns_token) return { ok: false, reason: 'not-connected' };
  const r = await api('/api/extension/sync', { token: ns_token });
  if (r.status === 401) {
    await store.remove(['ns_token', 'ns_user', 'ns_settings', 'ns_level']); // disconnected or revoked in NeuroSync
    return { ok: false, reason: 'disconnected' };
  }
  if (!r.ok) return { ok: false, reason: 'offline' };
  await store.set({
    ns_settings: sanitizeSettings(r.data.settings),
    ns_level: r.data.assistanceLevel || null,
    ns_user: r.data.user || null,
    ns_has_profile: !!r.data.hasProfile,
    ns_synced_at: Date.now(),
  });
  return { ok: true };
}

async function connect(code, apiBase) {
  if (apiBase && /^https?:\/\//.test(apiBase)) await store.set({ ns_api: apiBase.replace(/\/$/, '') });
  const r = await api('/api/extension/connect', { method: 'POST', body: { code, label: 'Chrome extension' } });
  if (!r.ok) return { ok: false, message: (r.data.error && r.data.error.message) || "Couldn't reach NeuroSync. Is the backend running?" };
  await store.set({ ns_token: r.data.token, ns_user: r.data.user });
  await syncNow();
  return { ok: true };
}

async function callAi(kind, body) {
  const path = ENDPOINTS[kind];
  if (!path) return { ok: false, message: 'This NeuroSync action is not supported.' };
  const { ns_token } = await store.get('ns_token');
  if (!ns_token) return { ok: false, message: 'Connect the extension to your NeuroSync account from the dashboard, then try again.' };
  const r = await api(path, { method: 'POST', body, token: ns_token, timeoutMs: 30000 });
  if (r.ok) return { ok: true, data: r.data };
  if (r.status === 401) return { ok: false, message: 'The extension connection expired or was revoked. Pair it again from the NeuroSync dashboard.' };
  return { ok: false, message: r.data.error && r.data.error.message ? r.data.error.message : 'The comprehension request failed. Please try again.' };
}

function loadVocabulary() {
  if (!vocabPromise) vocabPromise = fetch(chrome.runtime.getURL('data/vocabulary.json')).then((r) => r.json()).catch(() => ({}));
  return vocabPromise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (sender.id !== chrome.runtime.id) return sendResponse({ ok: false });
      switch (msg && msg.type) {
        case 'NS_CONNECT': return sendResponse(await connect(String(msg.code || ''), msg.api));
        case 'NS_SYNC': return sendResponse(await syncNow());
        case 'NS_DISCONNECT':
          await store.remove(['ns_token', 'ns_user', 'ns_settings', 'ns_level', 'ns_overrides', 'ns_has_profile']);
          return sendResponse({ ok: true });
        case 'NS_AI': return sendResponse(await callAi(msg.kind, msg.body || {}));
        case 'NS_VOCAB': return sendResponse(await loadVocabulary());
        default: return sendResponse({ ok: false });
      }
    } catch (error) {
      console.error('[neurosync-extension]', JSON.stringify({ stage: 'message_failed', messageType: msg && msg.type, errorName: error && error.name ? error.name : 'Error' }));
      sendResponse({ ok: false, message: 'The extension could not complete this request. Check the backend connection and try again.' });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('ns-sync', { periodInMinutes: 15 }));
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('ns-sync', { periodInMinutes: 15 }); syncNow(); });
chrome.alarms.onAlarm.addListener((a) => a.name === 'ns-sync' && syncNow());
