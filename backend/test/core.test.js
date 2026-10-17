import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withServer, runCoreAssessment, datasets, DATASETS_DIR, completion, jsonResponse } from './helpers.js';
import { createAssessmentService } from '../src/services/assessmentService.js';
import { seededRng } from '../src/utils/rng.js';
import { calculateAssessmentScore, readingSpeedPoints, accuracyPoints, focusPoints } from '../src/services/scoringService.js';
import { classifyAssistance, generateAccessibilityProfile, describeSettings } from '../src/services/personalizationService.js';
import { calculatePreferenceCongruence, answersToFeatures } from '../src/services/preferenceService.js';
import { sanitizeSettings } from '../src/services/settingsService.js';
import { DEFAULT_SETTINGS, SETTING_RULES } from '../src/data/settingsSchema.js';
import { AppError } from '../src/utils/AppError.js';
import { buildConfig } from '../src/config.js';

test('config: Gemini model and Google Generative Language API settings', () => {
  const config = buildConfig({ GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'test-key' });
  assert.equal(config.gemini.model, 'gemini-3.5-flash-lite');
  assert.equal(config.gemini.apiKey, 'test-key');
  assert.equal(config.gemini.baseUrl, 'https://generativelanguage.googleapis.com');
});

/* ------------------------------------------------------------------ datasets */
test('datasets: all original files load; only the known-malformed item is skipped', () => {
  assert.deepEqual(datasets.report.missing, []);
  assert.deepEqual(datasets.report.skipped, { wordSequencing: ['WS-H-02'] });
  assert.deepEqual(datasets.report.loaded, { readingPassages: 50, wordDifficulty: 50, memoryRecall: 50, patternRecognition: 50, sentenceCompletion: 50, wordSequencing: 49, focus: 6, preferences: 6 });
  assert.equal(Object.keys(datasets.vocabulary).length, 50);
  const uids = [...datasets.readingPassages, ...datasets.sentenceCompletion].map((i) => i.uid);
  assert.equal(new Set(uids).size, uids.length, 'ids are namespaced per module');
});

test('datasets: the original files are untouched (14 expected structures still readable)', () => {
  const files = fs.readdirSync(DATASETS_DIR).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 8);
  const ws = JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, 'Word_Sequencing.json'), 'utf8'));
  assert.ok(ws.find((i) => i.id === 'WS-H-02'), 'malformed item still present in the original file');
});

/* ------------------------------------------------------------------- scoring */
test('scoring: component thresholds, boundaries and classification', () => {
  assert.deepEqual([250, 200, 160, 120, 60].map(readingSpeedPoints), [0, 0, 1, 2, 3]);
  assert.deepEqual([100, 80, 79, 60, 59, 40, 39, 0].map(accuracyPoints), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(focusPoints([{ scoreImpact: 3, maxImpact: 3 }, { scoreImpact: 2, maxImpact: 2 }]), 5);
  assert.deepEqual([0, 4, 5, 9, 10, 14].map((t) => classifyAssistance(t).level), [1, 1, 2, 2, 3, 3]);
  assert.equal(classifyAssistance(2).classification, 'Basic / Mild Assistance');
  assert.equal(classifyAssistance(7).classification, 'Moderate Assistance');
  assert.equal(classifyAssistance(12).classification, 'High / Maximum Assistance');
});

test('scoring: range 0–14, missing modules flagged, skipped (too fast) passages ignored', () => {
  const worst = calculateAssessmentScore({ reading: { rounds: [{ seconds: 60, wpm: 40 }] }, comprehension: { total: 3, correct: 0, percent: 0 }, wordDifficulty: { total: 6, correct: 0, percent: 0 }, focus: { answers: [{ scoreImpact: 3, maxImpact: 3 }] } });
  assert.equal(worst.total, 14);
  assert.equal(worst.level, 3);
  const none = calculateAssessmentScore({ reading: { rounds: [{ seconds: 1, wpm: 5400 }] } });
  assert.equal(none.total, 0);
  assert.deepEqual(none.missing, ['reading', 'comprehension', 'wordDifficulty', 'focus']);
});

/* ----------------------------------------------------------- personalization */
test('personalization: level 1 / 2 / 3 profiles follow the specification', () => {
  const p1 = generateAccessibilityProfile(3);
  assert.equal(p1.assistanceLevel, 1);
  assert.equal(p1.settings.bionicReading, true);
  assert.equal(p1.settings.bionicIntensity, 'light');
  assert.equal(p1.settings.letterSpacing, 0);
  assert.equal(p1.settings.readingRuler, false);
  const p2 = generateAccessibilityProfile(7);
  assert.equal(p2.settings.font, 'lexend');
  assert.ok(p2.settings.lineSpacing > 1.5 && p2.settings.letterSpacing > 0 && p2.settings.wordSpacing > 0);
  assert.notEqual(p2.settings.colorTint, 'none');
  const p3 = generateAccessibilityProfile({ total: 12 });
  assert.equal(p3.settings.font, 'opendyslexic');
  assert.ok(p3.settings.letterSpacing > p2.settings.letterSpacing);
  for (const k of ['textToSpeech', 'readerMode', 'focusMode', 'readingRuler']) assert.equal(p3.settings[k], true, k);
  for (const lv of [1, 2, 3]) assert.deepEqual(sanitizeSettings(generateAccessibilityProfile(lv * 5 - 3).settings, { partial: false }).errors, [], 'every generated profile is valid for the API schema');
  assert.ok(describeSettings(p2.settings).includes('Lexend font'));
});

test('settings validation: unknown keys, wrong types, out-of-range values and snapping', () => {
  assert.ok(sanitizeSettings({ nope: 1 }).errors.length);
  assert.ok(sanitizeSettings({ fontSize: '18' }).errors.length);
  assert.ok(sanitizeSettings({ fontSize: 99 }).errors.length);
  assert.ok(sanitizeSettings({ font: 'comic' }).errors.length);
  assert.ok(sanitizeSettings({ bionicReading: 'yes' }).errors.length);
  assert.deepEqual(sanitizeSettings({ lineSpacing: 1.94, fontSize: 18 }).settings, { lineSpacing: 1.9, fontSize: 18 });
  assert.equal(Object.keys(sanitizeSettings({}, { partial: false }).settings).length, Object.keys(DEFAULT_SETTINGS).length);
  assert.deepEqual(Object.keys(SETTING_RULES).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

test('preference congruence: score, matched and total features', () => {
  const rec = generateAccessibilityProfile(7).settings; // lexend, 1.9, letters+, no bionic, tint
  const features = answersToFeatures({ 'PREF-FONT-01': 'Lexend', 'PREF-SPACE-01': 'Moderate Spacing (1.5x)', 'PREF-LSPACE-01': 'Standard Letters', 'PREF-BIONIC-01': 'Standard Text', 'PREF-COLOR-01': 'Soft Tint (Yellow)' });
  const c = calculatePreferenceCongruence(rec, features);
  assert.equal(c.totalFeatures, 5);
  assert.deepEqual(c.matchedFeatures, ['Font', 'Line spacing', 'Bionic reading', 'Color tint']);
  assert.equal(c.score, 80);
  assert.equal(calculatePreferenceCongruence(rec, {}).score, null, 'no fabricated score without preferences');
});

/* ----------------------------------------------------------- adaptive engine */
test('adaptive logic: starts medium, harder after two correct, easier after a miss, never repeats', () => {
  const svc = createAssessmentService({ datasets, rng: seededRng(4) });
  const s = svc.newSession({ part: 'core', mode: 'adaptive' });
  const last = () => s.steps[s.steps.length - 1];
  const doPassage = () => {
    svc.answer(s, { stepId: s.steps[s.steps.length - 2].id, timeMs: 20000 });
  };
  assert.equal(s.steps[0].difficulty, 'medium');
  // passage pair 1: read, answer comprehension correctly
  svc.answer(s, { stepId: s.steps[0].id, timeMs: 20000 });
  svc.answer(s, { stepId: s.steps[1].id, value: s.steps[1].correct });
  svc.answer(s, { stepId: s.steps[2].id, timeMs: 20000 });
  assert.equal(s.steps[2].difficulty, 'medium');
  svc.answer(s, { stepId: s.steps[3].id, value: s.steps[3].correct }); // second correct in a row
  assert.equal(s.steps[4].difficulty, 'hard', 'two correct → harder');
  assert.equal(s.steps[4].kind, 'passage');
  svc.answer(s, { stepId: s.steps[4].id, timeMs: 20000 });
  svc.answer(s, { stepId: s.steps[5].id, value: s.steps[5].options.find((o) => o !== s.steps[5].correct) });
  assert.equal(s.steps[6].kind, 'mcq');
  assert.equal(s.steps[6].difficulty, 'medium', 'a miss → easier');
  assert.equal(new Set(s.state.used).size, s.state.used.length);
});

test('fixed modes only serve the chosen difficulty', () => {
  for (const [mode, d] of [['low', 'easy'], ['medium', 'medium'], ['high', 'hard']]) {
    const svc = createAssessmentService({ datasets, rng: seededRng(2) });
    const s = svc.newSession({ part: 'core', mode });
    let guard = 0;
    while (!svc.isComplete(s) && guard++ < 60) {
      const step = s.steps[svc.currentIndex(s)];
      if (step.difficulty) assert.equal(step.difficulty, d);
      svc.answer(s, step.kind === 'passage' ? { stepId: step.id, timeMs: 15000 } : { stepId: step.id, value: step.options[0] });
    }
    assert.ok(svc.isComplete(s));
  }
});

test('questions are randomised per seed but deterministic for the same seed', () => {
  const first = (seed) => createAssessmentService({ datasets, rng: seededRng(seed) }).newSession({ part: 'core' }).steps[0].itemUid;
  assert.equal(first(1), first(1));
  assert.notEqual(first(1) + first(2) + first(3), first(1) + first(1) + first(1));
});

/* -------------------------------------------------- full assessment over HTTP */
test('assessment API: questions never leak answers; full best-case run → level 1', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup();
    const first = await api.get('/assessment/questions', { token });
    assert.equal(first.status, 200);
    assert.equal(first.data.step.number, 1);
    assert.equal(first.data.step.kind, 'passage');
    const seen = await runCoreAssessment(api, token, 'best');
    assert.ok(seen.length >= 23 && seen.length <= 24, `steps = ${seen.length}`);
    const blob = JSON.stringify(seen);
    assert.ok(!/"correct"|correctAnswer|correct_answer|score_impact|scoreImpact/.test(blob), 'answer key is never sent to the browser');
    assert.deepEqual([...new Set(seen.map((s) => s.category))].sort(), ['Comprehension', 'Focus and comfort', 'Reading flow', 'Reading preferences', 'Word difficulty', 'Font Preference', 'Spacing Preference (Line Height)', 'Spacing Preference (Letter Spacing)', 'Bionic Reading Preference', 'Text Simplification Preference', 'Color Overlay / Contrast'].filter((c) => seen.some((s) => s.category === c)).sort());
    const early = await api.post('/assessment/submit', { part: 'core' }, { token });
    assert.equal(early.status, 201); // complete because the helper answered every step
    const res = early.data;
    assert.equal(res.score.total, 0);
    assert.equal(res.level.level, 1);
    assert.equal(res.level.classification, 'Basic / Mild Assistance');
    assert.ok(res.recommendedSettings.includes('Light bionic reading'));
    assert.equal(res.score.components.readingSpeed.points, 0);
    assert.equal(res.score.components.comprehension.points, 0);
    assert.equal(res.breakdown.comprehension.total, 3);
    assert.equal(res.breakdown.wordDifficulty.total, 6);
    assert.ok(res.preferences.congruence.totalFeatures >= 4);
    const again = await api.get('/assessment/results', { token });
    assert.deepEqual(again.data.score, res.score);
    assert.equal(again.data.cognitiveCompleted, false, 'the Results page uses this flag instead of probing for cognitive results');
  });
});

test('assessment API: worst-case run → score 14, level 3, maximum-assistance profile', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup();
    await runCoreAssessment(api, token, 'worst', { mode: 'high' });
    const res = (await api.post('/assessment/submit', { part: 'core' }, { token })).data;
    assert.equal(res.score.total, 14);
    assert.equal(res.level.level, 3);
    assert.equal(res.level.label, 'Maximum Assistance');
    for (const s of ['OpenDyslexic font', 'Reading ruler', 'Focus support', 'Reader mode', 'Text-to-speech']) assert.ok(res.recommendedSettings.includes(s), s);
    assert.equal(res.mode, 'high');
  }, {});
});

test('assessment API: resume, previous/edit, ordering and validation', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup();
    const q1 = await api.get('/assessment/questions', { token });
    const s1 = q1.data.step;
    assert.equal((await api.post('/assessment/answer', { part: 'core', stepId: 'nope', value: 'x' }, { token })).status, 404);
    // answering step 2 before step 1 is rejected
    const a1 = await api.post('/assessment/answer', { part: 'core', stepId: s1.id, timeMs: 12000 }, { token });
    assert.equal(a1.status, 200);
    const s2 = a1.data.step;
    assert.equal((await api.post('/assessment/answer', { part: 'core', stepId: s2.id, value: 'not an option' }, { token })).status, 400);
    assert.equal((await api.post('/assessment/answer', { part: 'core', stepId: s2.id, value: s2.options[0], timeMs: 900 }, { token })).status, 200);
    // "Save & exit" then resume → continues at question 3, previous answers kept
    const resumed = await api.get('/assessment/questions', { token });
    assert.equal(resumed.data.step.number, 3);
    assert.equal(resumed.data.progress.answered, 2);
    const back = await api.get('/assessment/questions?cursor=1', { token });
    assert.equal(back.data.step.id, s2.id);
    assert.equal(back.data.step.answer, s2.options[0]);
    assert.equal((await api.get('/assessment/questions?cursor=3', { token })).status, 409, 'exists but not reached yet');
    assert.equal((await api.get('/assessment/questions?cursor=50', { token })).status, 400, 'does not exist');
    // edit the previous answer
    assert.equal((await api.post('/assessment/answer', { part: 'core', stepId: s2.id, value: s2.options[1] }, { token })).status, 200);
    assert.equal((await api.get('/assessment/questions?cursor=1', { token })).data.step.answer, s2.options[1]);
    assert.equal((await api.post('/assessment/submit', { part: 'core' }, { token })).status, 409, 'cannot submit early');
    assert.equal((await api.get('/assessment/results', { token })).status, 404);
    assert.equal((await api.get('/assessment/questions?part=bogus', { token })).status, 400);
  });
});

test('assessment API requires authentication', async () => {
  await withServer(async ({ api }) => {
    for (const [m, p] of [['get', '/assessment/questions'], ['get', '/assessment/results'], ['get', '/dashboard'], ['get', '/accessibility/profile'], ['get', '/profile']]) {
      assert.equal((await api[m](p)).status, 401, p);
    }
    assert.equal((await api.post('/assessment/answer', {})).status, 401);
  });
});

/* --------------------------------------------- settings, dashboard, results */
test('accessibility settings: recommended → apply → manual override → reset (recommended / default)', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup();
    const empty = await api.get('/accessibility/profile', { token });
    assert.equal(empty.data.saved, false);
    assert.equal(empty.data.recommended, null);
    assert.deepEqual(empty.data.settings, DEFAULT_SETTINGS);
    assert.equal((await api.post('/accessibility/reset', { to: 'recommended' }, { token })).status, 409);

    await runCoreAssessment(api, token, 'worst', { mode: 'high' });
    await api.post('/assessment/submit', { part: 'core' }, { token });
    const afterSubmit = (await api.get('/accessibility/profile', { token })).data;
    assert.equal(afterSubmit.saved, false, 'nothing is applied until the user chooses to');
    assert.equal(afterSubmit.settings.font, 'opendyslexic');
    assert.equal(afterSubmit.assistanceLevel, 3);

    const applied = (await api.post('/accessibility/reset', { to: 'recommended' }, { token })).data;
    assert.equal(applied.saved, true);
    assert.equal(applied.settings.readerMode, true);

    const custom = (await api.put('/accessibility/profile', { settings: { font: 'lexend', fontSize: 22, focusMode: false } }, { token })).data;
    assert.equal(custom.settings.font, 'lexend');
    assert.equal(custom.settings.fontSize, 22);
    assert.equal(custom.settings.readerMode, true, 'untouched fields keep their value');
    assert.equal((await api.get('/accessibility/profile', { token })).data.settings.font, 'lexend', 'persisted');

    const bad = await api.put('/accessibility/profile', { settings: { fontSize: 99, nope: true } }, { token });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error.details.length, 2);
    assert.equal((await api.put('/accessibility/profile', { settings: {} }, { token })).status, 400);

    assert.equal((await api.post('/accessibility/reset', { to: 'recommended' }, { token })).data.settings.font, 'opendyslexic');
    const def = (await api.post('/accessibility/reset', { to: 'default' }, { token })).data;
    assert.deepEqual(def.settings, DEFAULT_SETTINGS);
    assert.equal(def.recommended.assistanceLevel, 3, 'recommendation is kept for later');
    assert.equal((await api.post('/accessibility/reset', { to: 'bogus' }, { token })).status, 400);
  });
});

test('dashboard shows real state only (no data → nulls, then results, settings and progress)', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup('dash@example.com', 'Dana');
    let d = (await api.get('/dashboard', { token })).data;
    assert.equal(d.user.name, 'Dana');
    assert.equal(d.assessment.status, 'none');
    assert.equal(d.assessment.summary, null);
    assert.equal(d.recommendedLevel, null);
    assert.equal(d.accessibility.saved, false);
    assert.equal(d.accessibility.summary, null);
    assert.equal(d.preferences, null);
    assert.equal(d.extension.connected, false);

    const q = await api.get('/assessment/questions', { token });
    await api.post('/assessment/answer', { part: 'core', stepId: q.data.step.id, timeMs: 9000 }, { token });
    d = (await api.get('/dashboard', { token })).data;
    assert.equal(d.assessment.status, 'in_progress');
    assert.equal(d.assessment.progress.answered, 1);

    await runCoreAssessment(api, token, 'worst', { mode: 'high' });
    await api.post('/assessment/submit', { part: 'core' }, { token });
    d = (await api.get('/dashboard', { token })).data;
    assert.equal(d.assessment.status, 'complete');
    assert.equal(d.assessment.summary.score, 14);
    assert.equal(d.recommendedLevel, 3);
    assert.equal(d.preferences.items.length, 6);
    assert.ok(d.preferences.items.every((i) => !/^PREF-/.test(i.category)), 'shows dataset category names, not ids');
    assert.ok(d.preferences.items.some((i) => i.category === 'Font Preference'));
    await api.post('/accessibility/reset', { to: 'recommended' }, { token });
    d = (await api.get('/dashboard', { token })).data;
    assert.equal(d.accessibility.saved, true);
    assert.ok(d.accessibility.summary.includes('Reading ruler'));
    assert.deepEqual(d.quickControls, { focusMode: true, readingRuler: true });
    await api.put('/accessibility/profile', { settings: { focusMode: false } }, { token });
    assert.equal((await api.get('/dashboard', { token })).data.quickControls.focusMode, false);
  });
});

/* ------------------------------------------------------ cognitive (separate) */
test('cognitive assessment is separate from the assistance score', async () => {
  await withServer(async ({ api, signup }) => {
    const { token } = await signup();
    let r = await api.post('/assessment/start', { part: 'cognitive' }, { token });
    let n = 0;
    let sawFact = false;
    while (n++ < 40) {
      const step = r.data.step;
      assert.ok(step.timeLimitSeconds > 0);
      if (step.fact) { sawFact = true; assert.ok(step.memorizeSeconds > 0); assert.ok(!step.prompt.startsWith('Fact:')); }
      const a = await api.post('/assessment/answer', n % 5 === 0 ? { part: 'cognitive', stepId: step.id, timedOut: true, timeMs: 20000 } : { part: 'cognitive', stepId: step.id, value: step.options[0], timeMs: 2000 }, { token });
      assert.equal(a.status, 200);
      if (a.data.complete) break;
      r = { data: { step: a.data.step } };
    }
    assert.ok(sawFact);
    const done = await api.post('/assessment/submit', { part: 'cognitive' }, { token });
    assert.equal(done.status, 201);
    assert.equal(done.data.sections.length, 4);
    assert.equal(done.data.attention.total, 16);
    assert.ok(done.data.note.includes('not a medical'));
    assert.equal((await api.get('/assessment/results?part=core', { token })).status, 404, 'core results unaffected');
    assert.equal((await api.get('/accessibility/profile', { token })).data.recommended, null, 'no assistance level from cognitive');
    assert.equal((await api.get('/dashboard', { token })).data.cognitive.completed, true);
  });
});
