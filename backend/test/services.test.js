import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, runCoreAssessment, completion, jsonResponse, datasets } from './helpers.js';
import { createTokenService } from '../src/services/tokenService.js';
import { extractJson, parseBullets } from '../src/utils/parse.js';

const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

/* ---------------------------------------------------------------- health/errors */
test('health works and never leaks the API key', async () => {
  await withServer(async ({ api }) => {
    const r = await api.get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual({ status: r.data.status, configured: r.data.ai.configured, model: r.data.ai.model }, { status: 'ok', configured: true, model: 'gemini-3.5-flash-lite' });
    assert.ok(!r.text.includes('test-key-123'));
  });
});

test('unknown routes and malformed JSON give clean JSON errors', async () => {
  await withServer(async ({ api, base }) => {
    const r = await api.get('/nope');
    assert.equal(r.status, 404);
    assert.equal(r.data.error.code, 'NOT_FOUND');
    const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(bad.status, 400);
    assert.ok(!(await bad.text()).includes('at '), 'no stack trace');
  });
});

/* -------------------------------------------------------------------------- auth */
test('auth: signup, login, logout, profile, validation and duplicate email', async () => {
  await withServer(async ({ api }) => {
    const email = 'dahi@example.com';
    assert.equal((await api.post('/auth/signup', { name: 'Dahi', email: 'bad', password: 'password123' })).status, 400);
    assert.equal((await api.post('/auth/signup', { name: 'Dahi', email, password: 'short' })).status, 400);
    const su = await api.post('/auth/signup', { name: 'Dahi', email, password: 'password123' });
    assert.equal(su.status, 201);
    assert.equal(su.data.token.split('.').length, 3, 'JWT format');
    assert.ok(!JSON.stringify(su.data).includes('passwordHash'));
    assert.equal((await api.post('/auth/signup', { name: 'X', email: email.toUpperCase(), password: 'password123' })).status, 409);
    assert.equal((await api.post('/auth/login', { email, password: 'wrongpass1' })).status, 401);
    const li = await api.post('/auth/login', { email, password: 'password123' });
    assert.equal(li.status, 200);
    const token = li.data.token;
    const prof = await api.get('/profile', { token });
    assert.equal(prof.data.user.name, 'Dahi');
    assert.equal(prof.data.user.email, email);
    assert.ok(!prof.text.includes('passwordHash'));
    assert.equal((await api.put('/profile', { name: 'Dahi K', assessmentMode: 'low' }, { token })).data.user.name, 'Dahi K');
    assert.equal((await api.get('/profile', { token })).data.preferences.assessmentMode, 'low');
    assert.equal((await api.put('/profile', { assessmentMode: 'extreme' }, { token })).status, 400);
    assert.equal((await api.put('/profile', { email: 'x@y.z' }, { token })).status, 400, 'email cannot be changed here');
    await api.post('/auth/logout', {}, { token });
    assert.equal((await api.get('/profile', { token })).status, 401, 'token revoked');
    assert.equal((await api.get('/profile', { token: 'garbage.token.here' })).status, 401);
  });
});

test('auth: tampered or expired tokens are rejected', () => {
  const svc = createTokenService('secret-a');
  const t = svc.issue({ typ: 'user', sub: 'u1' }, 60);
  assert.equal(svc.verify(t).sub, 'u1');
  assert.equal(createTokenService('secret-b').verify(t), null, 'wrong secret');
  const [h, p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ typ: 'user', sub: 'admin', exp: 9999999999 })).toString('base64url');
  assert.equal(svc.verify(`${h}.${forged}.${s}`), null, 'forged payload');
  assert.equal(svc.verify(svc.issue({ sub: 'u' }, -10)), null, 'expired');
});

test('profile: account deletion needs the password and removes the account', async () => {
  await withServer(async ({ api, signup }) => {
    const { token, email } = await signup();
    assert.equal((await api.del('/profile', { password: 'nope-nope' }, { token })).status, 401);
    assert.equal((await api.del('/profile', { password: 'password123' }, { token })).status, 200);
    assert.equal((await api.get('/profile', { token })).status, 401);
    assert.equal((await api.post('/auth/login', { email, password: 'password123' })).status, 401);
  });
});

/* ---------------------------------------------------------------------- AI tools */
test('AI: simplify sends a Gemini generateContent request with the configured model and key', async () => {
  let call;
  await withServer(async ({ api }) => {
    const r = await api.post('/simplify', { text: 'The precipitate dissemination of information.' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { simplified: 'Easy words.' });
    assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(call.body.contents.length, 1);
    assert.equal(call.body.contents[0].role, 'user');
    assert.match(call.body.contents[0].parts[0].text, /Do NOT add information/);
    assert.equal(call.body.generationConfig.maxOutputTokens, 900);
    assert.equal(call.headers['x-goog-api-key'], 'test-key-123');
  }, { fetchImpl: async (url, init) => ((call = { url, headers: init.headers, body: JSON.parse(init.body) }), completion('Easy words.')) });
});

test('AI: summarize returns 3–5 bullets', async () => {
  await withServer(async ({ api }) => {
    const r = await api.post('/summarize', { text: 'A reasonably long passage that needs summarising for the reader to understand.' });
    assert.deepEqual(r.data.bullets, ['One', 'Two', 'Three']);
    assert.equal(r.data.summary, 'One Two Three');
  }, { fetchImpl: async () => completion('- One\n- Two\n- Three') });
});

test('word assistance is LOCAL FIRST: dataset words never call Gemini', async () => {
  let calls = 0;
  await withServer(async ({ api }) => {
    const r = await api.post('/word-assistance', { word: 'Ephemeral!' });
    assert.equal(r.status, 200);
    assert.equal(r.data.source, 'local');
    assert.equal(r.data.synonym, 'Short-lived');
    assert.match(r.data.visualHint, /sunset/);
    assert.equal(calls, 0);
    const rate = await api.post('/word-assistance', { word: 'abundant' });
    assert.equal(rate.data.synonym, 'Plentiful');
    assert.equal(calls, 0);
  }, { fetchImpl: async () => (calls++, completion('{}')) });
});

test('word assistance: unknown words fall back to AI, are cached, and return the structured shape', async () => {
  let calls = 0;
  await withServer(async ({ api }) => {
    const a = await api.post('/word-assistance', { word: 'zephyr', context: 'A soft zephyr blew.' });
    assert.equal(a.data.source, 'ai');
    assert.deepEqual(Object.keys(a.data).sort(), ['pronunciation', 'simpleMeaning', 'source', 'synonym', 'visualHint', 'word']);
    assert.equal(a.data.synonym, 'breeze');
    await api.post('/word-assistance', { word: 'Zephyr' });
    assert.equal(calls, 1, 'second request is cached');
  }, { fetchImpl: async () => (calls++, completion('```json\n{"simpleMeaning":"a gentle wind","synonym":"breeze","pronunciation":"ZEF-er","visualHint":"A zephyr moved the curtains."}\n```')) });
});

test('AI: validation rejects empty / oversized / multi-word input', async () => {
  await withServer(async ({ api }) => {
    assert.equal((await api.post('/simplify', {})).status, 400);
    assert.equal((await api.post('/simplify', { text: 'a'.repeat(4001) })).status, 400);
    assert.equal((await api.post('/summarize', { text: 'too short' })).status, 400);
    assert.equal((await api.post('/word-assistance', { word: 'two words' })).status, 400);
    assert.equal((await api.post('/word-assistance', { word: 'foo<bar>baz' })).status, 400);
    assert.equal((await api.post('/word-assistance', { word: '1234' })).status, 400);
  });
});

test('AI: Gemini failures return the friendly message and leak nothing', async () => {
  const failures = [
    async () => jsonResponse({ error: 'bad key sk-secret-xyz' }, 401),
    async () => jsonResponse({}, 429),
    async () => jsonResponse({}, 500),
    async () => { throw new Error('socket hang up sk-secret-xyz'); },
    async () => completion('   '),
    async () => jsonResponse({ candidates: [] }),
  ];
  for (const f of failures) {
    await withServer(async ({ api }) => {
      const r = await api.post('/simplify', { text: 'Some text to simplify please.' });
      assert.ok([429, 502, 503].includes(r.status), String(r.status));
      assert.equal(r.data.error.message, 'AI assistance is temporarily unavailable. Your local accessibility tools are still available.');
      assert.ok(!r.text.includes('sk-secret') && !r.text.includes('test-key') && !/stack| at /.test(r.text));
    }, { fetchImpl: f });
  }
  await withServer(async ({ api }) => {
    const r = await api.post('/word-assistance', { word: 'zephyr' });
    assert.equal(r.status, 502);
    assert.match(r.data.error.message, /temporarily unavailable/);
  }, { fetchImpl: async () => completion('not json at all') });
});

test('AI: missing API key still answers gracefully (local tools unaffected)', async () => {
  await withServer(async ({ api }) => {
    const r = await api.post('/simplify', { text: 'Some text to simplify.' });
    assert.equal(r.status, 503);
    assert.match(r.data.error.message, /temporarily unavailable/);
    assert.equal((await api.post('/word-assistance', { word: 'glad' })).data.source, 'local', 'local vocabulary works without a key');
    assert.equal((await api.get('/health')).data.ai.configured, false);
  }, { config: { gemini: { apiKey: '', model: 'gemini-3.5-flash-lite', baseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 1000 } } });
});

test('AI endpoints are rate limited', async () => {
  await withServer(async ({ api }) => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await api.post('/simplify', { text: `Text number ${i} for limits.` })).status);
    assert.deepEqual(codes, [200, 200, 429, 429]);
  }, { config: { rateLimit: { windowMs: 60000, ai: 2, auth: 100 } } });
});

/* ------------------------------------------------------------------- evaluation */
test('evaluation: consent required, anonymous records, admin-only stats and CSV', async () => {
  await withServer(async ({ api, signup }) => {
    const alice = await signup('alice@example.com', 'Alice Wonderland');
    const ratings = { easeOfReading: 4, navigationEase: 5, usefulness: 3, satisfaction: 4 };
    assert.equal((await api.post('/evaluation', { ratings, taskCompleted: true }, { token: alice.token })).status, 403, 'no consent yet');
    assert.equal((await api.put('/evaluation/consent', { consent: 'yes' }, { token: alice.token })).status, 400);
    assert.equal((await api.put('/evaluation/consent', { consent: true }, { token: alice.token })).data.consent, true);
    assert.equal((await api.post('/evaluation', { ratings, taskCompleted: true }, { token: alice.token })).status, 409, 'needs a completed assessment');

    await runCoreAssessment(api, alice.token, 'worst', { mode: 'high' });
    await api.post('/assessment/submit', { part: 'core' }, { token: alice.token });
    await api.post('/accessibility/reset', { to: 'recommended' }, { token: alice.token });
    assert.equal((await api.post('/evaluation', { ratings: { ...ratings, usefulness: 9 }, taskCompleted: true }, { token: alice.token })).status, 400);
    const sub = await api.post('/evaluation', { ratings, taskCompleted: true }, { token: alice.token });
    assert.equal(sub.status, 201);
    assert.equal(sub.data.participantId, 'P001');

    const bob = await signup('bob@example.com', 'Bob Builder');
    await api.put('/evaluation/consent', { consent: true }, { token: bob.token });
    await runCoreAssessment(api, bob.token, 'best');
    await api.post('/assessment/submit', { part: 'core' }, { token: bob.token });
    assert.equal((await api.post('/evaluation', { ratings: { easeOfReading: 2, navigationEase: 2, usefulness: 2, satisfaction: 2 }, taskCompleted: false }, { token: bob.token })).data.participantId, 'P002');

    await api.put('/evaluation/consent', { consent: false }, { token: bob.token });
    assert.equal((await api.post('/evaluation', { ratings, taskCompleted: true }, { token: bob.token })).status, 403, 'declined → nothing collected');

    assert.equal((await api.get('/evaluation', { token: alice.token })).status, 403, 'not a research admin');
    assert.equal((await api.get('/evaluation/export', { token: alice.token })).status, 403);
  }, { config: { researchAdmins: ['admin@example.com'] } });
});

test('evaluation: admin sees real statistics and an anonymous CSV (P001, P002 – no names/emails)', async () => {
  await withServer(async ({ api, signup }) => {
    const admin = await signup('admin@example.com', 'Admin Person');
    assert.equal((await api.get('/evaluation', { token: admin.token })).data.statistics, null, 'no data → null, nothing fabricated');
    assert.equal((await api.get('/evaluation/export', { token: admin.token, raw: false })).text.trim().split('\r\n').length, 1, 'header only');
    for (const [name, email, r, strat] of [['Alice Wonderland', 'alice@example.com', 4, 'worst'], ['Bob Builder', 'bob@example.com', 2, 'best']]) {
      const u = await signup(email, name);
      await api.put('/evaluation/consent', { consent: true }, { token: u.token });
      await runCoreAssessment(api, u.token, strat, { mode: strat === 'worst' ? 'high' : 'low' });
      await api.post('/assessment/submit', { part: 'core' }, { token: u.token });
      await api.post('/accessibility/reset', { to: 'recommended' }, { token: u.token });
      await api.post('/evaluation', { ratings: { easeOfReading: r, navigationEase: r, usefulness: r, satisfaction: r }, taskCompleted: strat === 'worst' }, { token: u.token });
    }
    const list = (await api.get('/evaluation', { token: admin.token })).data;
    assert.equal(list.count, 2);
    assert.equal(list.statistics.taskCompletion.ratePercent, 50);
    assert.deepEqual(list.statistics.usability.satisfaction, { n: 2, mean: 3, median: 3, sd: 1.41 });
    assert.deepEqual(list.statistics.assistanceLevels, { 3: 1, 1: 1 });
    assert.ok(list.statistics.assessmentScore.mean != null);
    const csv = (await api.get('/evaluation/export', { token: admin.token })).text;
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0].split(',').length, 22);
    assert.match(lines[1], /^P001,S-[0-9a-f]{8},/);
    assert.match(lines[2], /^P002,/);
    assert.ok(!/alice|bob|wonderland|builder|@example|admin/i.test(csv), 'no names or emails anywhere in the research CSV');
    assert.ok(!/"?userId|passwordHash/.test(JSON.stringify(list)));
  }, { config: { researchAdmins: ['admin@example.com'] } });
});

/* -------------------------------------------------------------------- extension */
test('extension: pairing code → token → sync; limited scope; revocable; one-time codes', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup('ext@example.com', 'Extie');
    assert.equal((await api.post('/extension/pairing-code', {})).status, 401);
    assert.equal((await api.get('/extension/status', { token })).data.connected, false);

    await runCoreAssessment(api, token, 'worst', { mode: 'high' });
    await api.post('/assessment/submit', { part: 'core' }, { token });
    await api.post('/accessibility/reset', { to: 'recommended' }, { token });

    const code = (await api.post('/extension/pairing-code', {}, { token })).data.code;
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal((await api.post('/extension/connect', { code: 'WRNG-CODE' })).status, 400);
    const conn = await api.post('/extension/connect', { code: code.toLowerCase().replace('-', ''), label: 'Chrome on laptop' });
    assert.equal(conn.status, 201);
    assert.equal(conn.data.user.name, 'Extie');
    const ext = conn.data.token;
    assert.equal((await api.post('/extension/connect', { code })).status, 400, 'code is single use');

    const sync = await api.get('/extension/sync', { token: ext });
    assert.equal(sync.status, 200);
    assert.equal(sync.data.settings.font, 'opendyslexic');
    assert.equal(sync.data.assistanceLevel, 3);
    assert.ok(!/passwordHash|email|jwt/i.test(sync.text));
    const st = (await api.get('/extension/status', { token })).data;
    assert.equal(st.connected, true);
    assert.ok(st.lastSeenAt);
    assert.equal((await api.get('/dashboard', { token })).data.extension.connected, true);

    // an extension token can read settings and use AI – nothing else
    assert.equal((await api.get('/profile', { token: ext })).status, 401);
    assert.equal((await api.get('/assessment/results', { token: ext })).status, 401);
    assert.equal((await api.put('/accessibility/profile', { settings: { fontSize: 20 } }, { token: ext })).status, 401);
    assert.equal((await api.post('/simplify', { text: 'Simplify this please.' }, { token: ext })).status, 200);

    await api.post('/extension/disconnect', {}, { token });
    assert.equal((await api.get('/extension/sync', { token: ext })).status, 401, 'revoked');
    assert.equal((await api.get('/extension/status', { token })).data.connected, false);
  });
});

test('extension: settings changed in Reading Studio are what the extension receives', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup();
    const code = (await api.post('/extension/pairing-code', {}, { token })).data.code;
    const ext = (await api.post('/extension/connect', { code })).data.token;
    assert.equal((await api.get('/extension/sync', { token: ext })).data.hasProfile, false);
    await api.put('/accessibility/profile', { settings: { font: 'atkinson', letterSpacing: 7 } }, { token });
    const s = (await api.get('/extension/sync', { token: ext })).data;
    assert.equal(s.hasProfile, true);
    assert.equal(s.settings.font, 'atkinson');
    assert.equal(s.settings.letterSpacing, 7);
  });
});

/* ------------------------------------------------------------------------ utils */
test('parse helpers', () => {
  assert.deepEqual(extractJson('Sure! {"a":1} done'), { a: 1 });
  assert.equal(extractJson('no json'), null);
  assert.deepEqual(parseBullets('1. a\n* b\n\n- c'), ['a', 'b', 'c']);
});
