import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, runCoreAssessment, completion, jsonResponse, datasets } from './helpers.js';
import { createTokenService } from '../src/services/tokenService.js';
import { extractJson, parseBullets } from '../src/utils/parse.js';
import { compareReadAloudAccuracy, validateGeneratedQuestions } from '../src/services/readingService.js';

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

test('AI: Gemini failures identify the category safely without leaking credentials', async () => {
  const failures = [
    { fetch: async () => jsonResponse({ error: 'bad key sk-secret-xyz' }, 401), status: 503, code: 'AI_AUTH', message: /GEMINI_API_KEY/ },
    { fetch: async () => jsonResponse({}, 403), status: 503, code: 'AI_PERMISSION', message: /denied access/ },
    { fetch: async () => jsonResponse({}, 404), status: 503, code: 'AI_MODEL_NOT_FOUND', message: /GEMINI_MODEL/ },
    { fetch: async () => jsonResponse({}, 429), status: 429, code: 'AI_RATE_LIMIT', message: /quota/ },
    { fetch: async () => jsonResponse({}, 500), status: 503, code: 'AI_UPSTREAM_UNAVAILABLE', message: /temporarily unavailable/ },
    { fetch: async () => { throw new Error('socket hang up sk-secret-xyz'); }, status: 503, code: 'AI_NETWORK', message: /could not connect to Google Gemini/ },
    { fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }), status: 504, code: 'AI_TIMEOUT', message: /timed out/ },
    { fetch: async (_url, init) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    }), status: 504, code: 'AI_TIMEOUT', message: /timed out/ },
    { fetch: async () => completion('   '), status: 502, code: 'AI_EMPTY_RESPONSE', message: /did not return generated text/ },
    { fetch: async () => jsonResponse({ candidates: [] }), status: 502, code: 'AI_EMPTY_RESPONSE', message: /did not return generated text/ },
  ];
  for (const failure of failures) {
    await withServer(async ({ api }) => {
      const r = await api.post('/simplify', { text: 'Some text to simplify please.' });
      assert.equal(r.status, failure.status);
      assert.equal(r.data.error.code, failure.code);
      assert.match(r.data.error.message, failure.message);
      assert.ok(!r.text.includes('sk-secret') && !r.text.includes('test-key') && !/stack| at /.test(r.text));
    }, {
      fetchImpl: failure.fetch,
      ...(failure.code === 'AI_TIMEOUT'
        ? { config: { gemini: { apiKey: 'test-key-123', model: 'gemini-3.5-flash-lite', baseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 10 } } }
        : {}),
    });
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
    assert.equal(r.data.error.code, 'AI_NOT_CONFIGURED');
    assert.match(r.data.error.message, /GEMINI_API_KEY.*backend\/\.env/);
    assert.equal((await api.post('/word-assistance', { word: 'glad' })).data.source, 'local', 'local vocabulary works without a key');
    assert.equal((await api.get('/health')).data.ai.configured, false);
  }, { config: { gemini: { apiKey: '', model: 'gemini-3.5-flash-lite', baseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 1000 } } });
});

test('reading quiz: passage-driven Gemini request, private answer key, scoring and one-time submission', async () => {
  const fixtures = [
    {
      passage: 'Python loops let a program repeat instructions. A for loop visits each item in a sequence, such as numbers in a range or names in a list. A while loop repeats as long as its condition remains true. Programmers should update the condition to avoid an endless loop. The break statement can stop a loop early, and continue skips to the next iteration.',
      questions: [
        { question: 'What does a for loop visit?', options: ['Each item in a sequence', 'Only errors', 'A single file', 'The computer clock'], correctAnswer: 'Each item in a sequence', explanation: 'A for loop visits items in a sequence.', evidence: 'A for loop visits each item in a sequence' },
        { question: 'When does a while loop repeat?', options: ['While its condition remains true', 'Exactly once', 'Only after a break', 'When the program closes'], correctAnswer: 'While its condition remains true', explanation: 'The condition controls repetition.', evidence: 'A while loop repeats as long as its condition remains true' },
        { question: 'What can stop a loop early?', options: ['The break statement', 'The range function', 'A list name', 'The continue statement'], correctAnswer: 'The break statement', explanation: 'The passage says break can stop a loop early.', evidence: 'The break statement can stop a loop early' },
      ],
    },
    {
      passage: 'Photosynthesis is the process plants use to make sugar from sunlight. In the leaves, chlorophyll captures light energy. Roots absorb water from soil, and carbon dioxide enters through tiny openings called stomata. The plant uses light energy to combine water and carbon dioxide into glucose and releases oxygen. The glucose stores chemical energy that supports growth.',
      questions: [
        { question: 'What captures light energy in leaves?', options: ['Chlorophyll', 'Glucose', 'Oxygen', 'Soil'], correctAnswer: 'Chlorophyll', explanation: 'Chlorophyll captures light energy.', evidence: 'chlorophyll captures light energy' },
        { question: 'How does carbon dioxide enter the plant?', options: ['Through stomata', 'Through the roots', 'Inside glucose', 'From sunlight'], correctAnswer: 'Through stomata', explanation: 'Carbon dioxide enters through tiny openings called stomata.', evidence: 'carbon dioxide enters through tiny openings called stomata' },
        { question: 'What does the plant release when making glucose?', options: ['Oxygen', 'Soil', 'Chlorophyll', 'Water vapor only'], correctAnswer: 'Oxygen', explanation: 'The process releases oxygen.', evidence: 'releases oxygen' },
      ],
    },
    {
      passage: 'Python code is readable. A for loop visits each item in a sequence, such as values in a list.',
      questions: [
        { question: 'How is Python code described?', options: ['Readable', 'Invisible', 'Unchanging', 'Circular'], correctAnswer: 'Readable', explanation: 'The passage says Python code is readable.', evidence: 'Python code is readable' },
        { question: 'What does a for loop visit?', options: ['Each item in a sequence', 'Only one file', 'The computer clock', 'A website'], correctAnswer: 'Each item in a sequence', explanation: 'A for loop visits each item in a sequence.', evidence: 'A for loop visits each item in a sequence' },
        { question: 'Where might the values be stored?', options: ['In a list', 'In the clock', 'In a website', 'In a file only'], correctAnswer: 'In a list', explanation: 'The passage gives values in a list as an example.', evidence: 'values in a list' },
      ],
    },
  ];
  assert.ok(fixtures[2].passage.length >= 80 && fixtures[2].passage.length < 120, 'short passage covers the lowered minimum');
  const requests = [];
  let upstreamCalls = 0;
  await withServer(async ({ api, signup }) => {
    const user = await signup();
    const other = await signup();
    assert.equal((await api.post('/reading/comprehension', { text: fixtures[0].passage })).status, 401);
    assert.equal((await api.post('/reading/quiz', { text: fixtures[0].passage }, { token: user.token })).status, 404, 'comprehension has one canonical generation endpoint');
    assert.equal((await api.get('/reading/recommendations')).status, 401);
    assert.equal((await api.post('/reading/comprehension', { text: '' }, { token: user.token })).status, 400);
    assert.equal((await api.post('/reading/comprehension', { text: 'Too short.' }, { token: user.token })).status, 400);
    assert.equal((await api.post('/reading/comprehension', { text: 'x'.repeat(79) }, { token: user.token })).status, 400);
    assert.equal(upstreamCalls, 0, 'short passages fail before Gemini is called');
    for (const fixture of fixtures) {
      const generated = await api.post('/reading/comprehension', { text: fixture.passage, source: fixture.source || 'original' }, { token: user.token });
      assert.equal(generated.status, 200);
      assert.equal(generated.data.totalQuestions, 3);
      assert.equal(generated.data.source, fixture.source || 'original');
      assert.deepEqual(
        generated.data.questions,
        fixture.questions.map(({ question, options }) => ({ question, options }))
      );
      assert.ok(generated.data.questions.every((question) => !('correctAnswer' in question) && !('evidence' in question) && !('explanation' in question)));
      const request = requests.at(-1);
      assert.match(request.url, /\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
      assert.ok(request.prompt.includes(fixture.passage), 'the supplied passage is sent to Gemini');

      const answers = {
        0: fixture.questions[0].correctAnswer,
        1: fixture.questions[1].correctAnswer,
        2: fixture.questions[2].options.find((option) => option !== fixture.questions[2].correctAnswer),
      };
      assert.equal((await api.post('/reading/quiz/submit', { quizId: generated.data.quizId, answers }, { token: other.token })).status, 404, 'another account cannot submit this quiz');
      const submitted = await api.post('/reading/quiz/submit', { quizId: generated.data.quizId, answers }, { token: user.token });
      assert.equal(submitted.status, 200);
      assert.equal(submitted.data.total, 3);
      assert.equal(submitted.data.correct, 2);
      assert.equal(submitted.data.percentage, 67);
      assert.match(submitted.data.message, /2 out of 3/);
      assert.equal(submitted.data.progress.quizzes, fixtures.indexOf(fixture) + 1);
      assert.equal(submitted.data.progress.averageComprehension, 67);
      assert.ok(!/"correctAnswer":/.test(JSON.stringify(submitted.data.progress)), 'progress omits the private answer key');
      assert.equal((await api.post('/reading/quiz/submit', { quizId: generated.data.quizId, answers }, { token: user.token })).status, 404, 'submission is one-time');
    }
    assert.equal((await api.get('/reading/progress', { token: other.token })).data.progress.quizzes, 0, 'progress is private to each account');
  }, {
    fetchImpl: async (url, init) => {
      upstreamCalls += 1;
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      const fixture = fixtures.find((item) => prompt.includes(item.passage));
      assert.ok(fixture, 'Gemini prompt includes one of the known passages');
      requests.push({ url, prompt });
      return completion(JSON.stringify({ questions: fixture.questions }));
    },
  });
  assert.equal(requests.length, fixtures.length);
});

test('reading quiz: missing Gemini configuration returns a clear error', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup();
    const r = await api.post('/reading/comprehension', { text: 'A long enough reading passage. '.repeat(5) }, { token });
    assert.equal(r.status, 503);
    assert.equal(r.data.error.code, 'AI_NOT_CONFIGURED');
    assert.match(r.data.error.message, /GEMINI_API_KEY.*backend\/\.env/);
  }, { config: { gemini: { apiKey: '', model: 'gemini-3.5-flash-lite', baseUrl: 'https://generativelanguage.googleapis.com', timeoutMs: 1000 } } });
});

test('reading progress stores completed timer sessions once and recommendations need consent to apply', async () => {
  await withServer(async ({ api, signup }) => {
    const user = await signup();
    const other = await signup();
    assert.equal((await api.get('/reading/progress')).status, 401);
    assert.equal((await api.get('/reading/progress', { token: user.token })).data.progress.sessions, 0);
    assert.equal((await api.post('/reading/progress', { minutes: 10, sessions: 1 }, { token: user.token })).status, 400, 'client totals are not accepted');
    const started = await api.post('/reading/progress/start', { source: 'simplified' }, { token: user.token });
    assert.equal(started.status, 201);
    assert.equal(started.data.progress.activeSession.source, 'simplified');
    const repeatedStart = await api.post('/reading/progress/start', { source: 'original' }, { token: user.token });
    assert.equal(repeatedStart.data.session.id, started.data.session.id, 'a repeated start cannot create extra sessions');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const input = { sessionId: started.data.session.id, supportNeed: 'line-tracking' };
    const saved = await api.post('/reading/progress', input, { token: user.token });
    assert.equal(saved.status, 201);
    assert.equal(saved.data.progress.totalSeconds, 1);
    assert.equal(saved.data.progress.minutes, 0);
    assert.equal(saved.data.progress.sessions, 1);
    assert.equal(saved.data.progress.recentSessions[0].durationSeconds, 1);
    assert.equal(saved.data.progress.recentSessions[0].simplified, true);
    assert.equal(saved.data.progress.recentSessions[0].settingsUsed.font, 'system');
    const duplicate = await api.post('/reading/progress', input, { token: user.token });
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.progress.sessions, 1);
    assert.equal((await api.get('/reading/progress', { token: other.token })).data.progress.sessions, 0);

    let recs = (await api.get('/reading/recommendations', { token: user.token })).data;
    assert.ok(recs.recommendations.some((item) => item.id === 'reading-ruler'));
    assert.equal((await api.post('/reading/recommendations', { id: 'reading-ruler', action: 'apply' }, { token: user.token })).status, 200);
    assert.equal((await api.get('/accessibility/profile', { token: user.token })).data.settings.readingRuler, true);
    assert.ok((await api.get('/reading/recommendations', { token: user.token })).data.applied.some((item) => item.id === 'reading-ruler'));
    await api.post('/reading/recommendations', { id: 'reading-ruler', action: 'undo' }, { token: user.token });
    assert.equal((await api.get('/accessibility/profile', { token: user.token })).data.settings.readingRuler, false);

    recs = (await api.get('/reading/recommendations', { token: user.token })).data;
    const font = recs.recommendations.find((item) => item.id === 'font-lexend');
    assert.ok(font);
    await api.post('/reading/recommendations', { id: font.id, action: 'dismiss' }, { token: user.token });
    assert.ok(!(await api.get('/reading/recommendations', { token: user.token })).data.recommendations.some((item) => item.id === font.id));
  });
});

test('reading question validation rejects duplicate options and unsupported evidence', () => {
  const passage = 'Plants use sunlight to make sugar through photosynthesis. Chlorophyll in leaves captures light energy. Roots absorb water from soil. Carbon dioxide enters through small openings called stomata. Plants combine water and carbon dioxide to make glucose and release oxygen.';
  const valid = { question: 'What captures light energy?', options: ['Chlorophyll', 'Water', 'Soil', 'Oxygen'], correctAnswer: 'Chlorophyll', explanation: 'Leaves capture light energy with chlorophyll.', evidence: 'Chlorophyll in leaves captures light energy' };
  const second = { ...valid, question: 'What do roots absorb?', options: ['Water', 'Sugar', 'Light', 'Oxygen'], correctAnswer: 'Water', explanation: 'Roots absorb water.', evidence: 'Roots absorb water from soil' };
  const third = { ...valid, question: 'What does the plant release?', options: ['Oxygen', 'Soil', 'Chlorophyll', 'Sugar'], correctAnswer: 'Oxygen', explanation: 'The process releases oxygen.', evidence: 'release oxygen' };
  const invalidDuplicate = { ...valid, question: 'Duplicate options?', options: ['Same', 'Same', 'Different', 'Other'] };
  const invalidEvidence = { ...valid, question: 'Unsupported question?', evidence: 'The plant grows under moonlight every night' };
  assert.equal(validateGeneratedQuestions([valid, second, third, invalidDuplicate, invalidEvidence], passage).length, 3);
});

test('read-aloud comparison reports repeated and reordered words as differences', () => {
  const repeated = compareReadAloudAccuracy('the the cat', 'the cat');
  assert.equal(repeated.accuracy, 67);
  assert.ok(repeated.differences.some((difference) => difference.type === 'missing' && difference.expected === 'the'));

  const reordered = compareReadAloudAccuracy('red blue green', 'blue red green');
  assert.equal(reordered.accuracy, 67);
  assert.ok(reordered.differences.some((difference) => difference.type === 'missing' && difference.expected === 'red'));
  assert.ok(reordered.differences.some((difference) => difference.type === 'extra' && difference.heard === 'red'));
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
    assert.equal((await api.get('/reading/progress', { token: ext })).status, 401);
    assert.equal((await api.post('/reading/comprehension', {}, { token: ext })).status, 400, 'paired extensions may create account-scoped quizzes');
    assert.equal((await api.post('/simplify', { text: 'Simplify this please.' }, { token: ext })).status, 200);

    await api.post('/extension/disconnect', {}, { token });
    assert.equal((await api.get('/extension/sync', { token: ext })).status, 401, 'revoked');
    assert.equal((await api.get('/extension/status', { token })).data.connected, false);
  });
});

test('reading quiz: dashboard and extension use the same generation and scoring endpoints', async () => {
  const passage = 'The water cycle moves water through the environment. Heat from the sun causes water in lakes and oceans to evaporate. The vapor cools and forms clouds through condensation. When droplets become heavy, precipitation returns water to the ground.';
  const questions = [
    { question: 'What causes water to evaporate?', options: ['Heat from the sun', 'Cold air', 'Heavy droplets', 'Clouds'], correctAnswer: 'Heat from the sun', explanation: 'The sun heats water and causes evaporation.', evidence: 'Heat from the sun causes water in lakes and oceans to evaporate' },
    { question: 'What forms through condensation?', options: ['Clouds', 'Oceans', 'The sun', 'Ground'], correctAnswer: 'Clouds', explanation: 'Cooling vapor forms clouds.', evidence: 'The vapor cools and forms clouds through condensation' },
    { question: 'What returns water to the ground?', options: ['Precipitation', 'Evaporation', 'Sunlight', 'Vapor'], correctAnswer: 'Precipitation', explanation: 'Precipitation returns water to the ground.', evidence: 'precipitation returns water to the ground' },
    { question: 'Where does evaporation happen?', options: ['Lakes and oceans', 'Only clouds', 'The ground only', 'Inside droplets'], correctAnswer: 'Lakes and oceans', explanation: 'The passage names lakes and oceans as sources of evaporation.', evidence: 'water in lakes and oceans to evaporate' },
  ];
  let upstreamCalls = 0;
  await withServer(async ({ api, signup }) => {
    const user = await signup();
    const code = (await api.post('/extension/pairing-code', {}, { token: user.token })).data.code;
    const extensionToken = (await api.post('/extension/connect', { code })).data.token;

    const results = [];
    for (const token of [user.token, extensionToken]) {
      assert.equal((await api.post('/reading/comprehension', { text: '' }, { token })).status, 400);
      const generated = await api.post('/reading/comprehension', { text: passage, source: 'original' }, { token });
      assert.equal(generated.status, 200);
      assert.equal(generated.data.totalQuestions, 4);
      assert.deepEqual(generated.data.questions, questions.map(({ question, options }) => ({ question, options })));
      assert.ok(generated.data.questions.every((item) => !('correctAnswer' in item)));

      const answers = {
        0: questions[0].correctAnswer,
        1: questions[1].correctAnswer,
        2: questions[2].options.find((option) => option !== questions[2].correctAnswer),
        3: questions[3].correctAnswer,
      };
      assert.equal((await api.post('/reading/quiz/submit', {
        quizId: generated.data.quizId,
        answers: { ...answers, 0: 'not an answer option' },
      }, { token })).status, 400);
      const submitted = await api.post('/reading/quiz/submit', { quizId: generated.data.quizId, answers }, { token });
      assert.equal(submitted.status, 200);
      results.push(submitted.data);
    }

    assert.equal(upstreamCalls, 2);
    for (const result of results) {
      assert.equal(result.total, 4);
      assert.equal(result.correct, 3);
      assert.equal(result.percentage, 75);
      assert.equal(result.feedback, results[0].feedback);
      assert.equal(result.message, results[0].message);
    }
  }, {
    fetchImpl: async (_url, init) => {
      upstreamCalls += 1;
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      assert.ok(prompt.includes(passage));
      return completion(JSON.stringify({ questions }));
    },
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
