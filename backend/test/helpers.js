import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { buildConfig } from '../src/config.js';
import { createStorage } from '../src/services/storage.js';
import { createGeminiService } from '../src/services/geminiService.js';
import { loadDatasets } from '../src/data/datasets.js';

export const DATASETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../datasets');
export const datasets = loadDatasets(DATASETS_DIR);

export const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
export const completion = (content) => jsonResponse({ candidates: [{ content: { parts: [{ text: content }] } }] });

export async function withServer(fn, { fetchImpl = async () => completion('ok'), config = {}, rng } = {}) {
  const cfg = {
    ...buildConfig({ GEMINI_API_KEY: 'test-key-123', JWT_SECRET: 'unit-test-secret', DATASETS_DIR }),
    rateLimit: { windowMs: 60000, ai: 10000, auth: 10000 },
    ...config,
  };
  const ai = createGeminiService(cfg.gemini, fetchImpl);
  const storage = createStorage(null); // in-memory
  const server = createApp({ config: cfg, ai, storage, datasets, rng }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, { token, body, raw } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  };
  const api = { get: (p, o) => call('GET', p, o), post: (p, body, o) => call('POST', p, { ...o, body: body ?? {} }), put: (p, body, o) => call('PUT', p, { ...o, body }), del: (p, body, o) => call('DELETE', p, { ...o, body }) };
  let n = 0;
  const signup = async (email = `u${Date.now()}${n++}@example.com`, name = 'Tester') => {
    const r = await api.post('/auth/signup', { name, email, password: 'password123' });
    return { token: r.data.token, user: r.data.user, email };
  };
  try {
    await fn({ api, signup, base, storage, config: cfg });
  } finally {
    server.close();
  }
}

const findQuestion = (id) => Object.values(datasets.categories).flat().find((item) => item.id === id);

/**
 * Answers every question of a core assessment through the real API.
 * "best" selects the correct option; "worst" selects a different option.
 */
export async function runCoreAssessment(api, token, strategy = 'best', { mode } = {}) {
  let r = mode ? await api.post('/assessment/start', { part: 'core', mode }, { token }) : await api.get('/assessment/questions', { token });
  const seen = [];
  let guard = 0;
  while (guard++ < 60) {
    const step = r.data.step;
    seen.push(step);
    const item = findQuestion(step.questionId);
    const wrong = step.options.find((option) => option.id !== item.correctAnswer);
    const body = {
      stepId: step.id,
      part: 'core',
      value: strategy === 'best' ? item.correctAnswer : wrong.id,
      timeMs: 1500,
    };
    const a = await api.post('/assessment/answer', body, { token });
    if (a.status !== 200) throw new Error(`answer failed ${a.status} ${a.text}`);
    if (a.data.complete) break;
    r = { data: { step: a.data.step } };
  }
  return seen;
}
