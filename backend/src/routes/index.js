import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { asyncHandler as h } from '../utils/asyncHandler.js';

/** Single place that lists every endpoint (mounted under /api). */
export function createRoutes({ config, ai, c, auth }) {
  const r = Router();
  const aiLimit = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.ai, message: 'Too many AI requests. Please wait a moment.' });
  const authLimit = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.auth, message: 'Too many attempts. Please wait a moment.' });

  // health
  r.get('/health', (_req, res) => res.json({ status: 'ok', ai: { configured: ai.isConfigured(), model: ai.model }, time: new Date().toISOString() }));

  // authentication
  r.post('/auth/signup', authLimit, validateBody({
    name: { required: true, min: 1, max: 60 },
    email: { required: true, max: 120, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Please enter a valid email address.' },
    password: { required: true, min: 8, max: 100 },
  }), h(c.auth.signup));
  r.post('/auth/login', authLimit, validateBody({ email: { required: true, max: 120 }, password: { required: true, max: 100 } }), h(c.auth.login));
  r.post('/auth/logout', c.auth.logout);

  // profile + dashboard
  r.get('/profile', auth.required, c.profile.get);
  r.put('/profile', auth.required, c.profile.update);
  r.delete('/profile', auth.required, h(c.profile.remove));
  r.get('/dashboard', auth.required, c.dashboard.get);

  // assessment
  r.get('/assessment/questions', auth.required, h(c.assessment.questions));
  r.post('/assessment/start', auth.required, h(c.assessment.start));
  r.post('/assessment/answer', auth.required, h(c.assessment.answer));
  r.post('/assessment/submit', auth.required, h(c.assessment.submit));
  r.get('/assessment/results', auth.required, h(c.assessment.results));

  // accessibility settings / personalization
  r.get('/accessibility/profile', auth.required, c.accessibility.get);
  r.put('/accessibility/profile', auth.required, c.accessibility.update);
  r.post('/accessibility/reset', auth.required, c.accessibility.reset);

  // AI tools call Gemini only from the backend.
  r.post('/simplify', aiLimit, auth.optional, validateBody({ text: { required: true, min: 2, max: 4000 } }), h(c.ai.simplify));
  r.post('/summarize', aiLimit, auth.optional, validateBody({ text: { required: true, min: 20, max: 8000 } }), h(c.ai.summarize));
  r.post('/word-assistance', aiLimit, auth.optional, validateBody({
    word: { required: true, min: 1, max: 60 }, // trimmed + validated as a single word by the word service
    context: { max: 300 },
  }), h(c.ai.wordAssistance));

  // reading support tools
  r.post('/reading/comprehension', aiLimit, auth.requiredAny, validateBody({
    text: { required: true, min: 80, max: 12000 },
    source: { pattern: /^(original|simplified)$/ },
  }), h(c.ai.readingComprehension));
  r.post('/reading/quiz/submit', aiLimit, auth.requiredAny, validateBody({
    quizId: { required: true, min: 20, max: 80 },
    answers: { required: true, type: 'object' },
  }), h(c.ai.submitReadingComprehension));
  r.post('/reading/read-aloud', aiLimit, auth.optional, validateBody({ passage: { required: true, min: 10, max: 12000 }, transcript: { required: true, min: 5, max: 12000 } }), h(c.ai.readAloudAccuracy));
  r.get('/reading/progress', auth.required, h(c.ai.readingProgress));
  r.post('/reading/progress/start', auth.required, validateBody({
    source: { pattern: /^(original|simplified)$/ },
  }), h(c.ai.startReadingSession));
  r.post('/reading/progress', auth.required, validateBody({
    sessionId: { required: true, min: 8, max: 80 },
    supportNeed: { pattern: /^(line-tracking|crowded-text|complex-text|prefer-listening)$/ },
  }), h(c.ai.readingProgress));
  r.get('/reading/recommendations', auth.required, h(c.ai.readingRecommendations));
  r.post('/reading/recommendations', auth.required, validateBody({
    id: { required: true, min: 1, max: 60 },
    action: { required: true, pattern: /^(apply|dismiss|undo)$/ },
  }), h(c.ai.updateReadingRecommendation));

  // evaluation (anonymous research data)
  r.put('/evaluation/consent', auth.required, c.evaluation.consent);
  r.post('/evaluation', auth.required, c.evaluation.submit);
  r.get('/evaluation', auth.required, c.evaluation.list);
  r.get('/evaluation/export', auth.required, c.evaluation.export);

  // browser extension
  r.post('/extension/pairing-code', auth.required, c.extension.pairingCode);
  r.post('/extension/connect', authLimit, validateBody({ code: { required: true, min: 6, max: 20 }, label: { max: 60 } }), c.extension.connect);
  r.get('/extension/status', auth.required, c.extension.status);
  r.get('/extension/sync', auth.requiredAny, c.extension.sync);
  r.post('/extension/disconnect', auth.required, c.extension.disconnect);
  return r;
}
