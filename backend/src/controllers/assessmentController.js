import { AppError } from '../utils/AppError.js';

const partOf = (v) => {
  const part = v || 'core';
  if (!['core', 'cognitive'].includes(part)) throw new AppError(400, 'part must be "core" or "cognitive".', 'VALIDATION');
  return part;
};

export function createAssessmentController({ storage, assessment }) {
  const save = (userId, part, mutate) =>
    storage.users.update(userId, (u) => {
      mutate(u.assessment[part]);
    });

  const stepView = (session, idx) => ({
    sessionId: session.id,
    part: session.part,
    mode: session.mode,
    progress: assessment.progress(session),
    step: assessment.publicStep(session, idx),
    canGoBack: idx > 0,
  });

  function startFresh(user, part, mode) {
    const session = assessment.newSession({ part, mode: mode || user.preferences.assessmentMode || 'adaptive' });
    save(user.id, part, (slot) => {
      slot.session = session;
    });
    return session;
  }

  return {
    /** Returns the current (or requested) question. Creates a session on first use; resumes after "Save & exit". */
    questions(req, res) {
      const part = partOf(req.query.part);
      let session = req.user.assessment[part].session;
      if (!session || session.status === 'submitted') {
        if (session && req.user.assessment[part].result) return res.json({ status: 'submitted', part, hasResult: true });
        session = startFresh(req.user, part);
      }
      let idx = assessment.currentIndex(session);
      if (req.query.cursor !== undefined) {
        const c = Number(req.query.cursor);
        if (!Number.isInteger(c) || c < 0 || c >= session.steps.length) throw new AppError(400, 'That question does not exist.', 'VALIDATION');
        if (c > idx) throw new AppError(409, 'You have not reached that question yet.', 'OUT_OF_ORDER');
        idx = c;
      }
      res.json({ status: 'in_progress', complete: assessment.isComplete(session), ...stepView(session, idx) });
    },

    /** Begins a brand-new assessment (retake). Previous results stay until the new one is submitted. */
    start(req, res) {
      const part = partOf(req.body && req.body.part);
      const session = startFresh(req.user, part, req.body && req.body.mode);
      res.status(201).json({ status: 'in_progress', complete: false, ...stepView(session, 0) });
    },

    answer(req, res) {
      const part = partOf(req.body && req.body.part);
      const session = req.user.assessment[part].session;
      if (!session || session.status !== 'in_progress') throw new AppError(409, 'There is no assessment in progress. Please start one.', 'NO_SESSION');
      const { stepId, value, timeMs, timedOut } = req.body || {};
      if (typeof stepId !== 'string') throw new AppError(400, '"stepId" is required.', 'VALIDATION');
      assessment.answer(session, { stepId, value, timeMs, timedOut });
      save(req.user.id, part, (slot) => {
        slot.session = session;
      });
      const idx = session.steps.findIndex((s) => s.id === stepId) + 1;
      const complete = assessment.isComplete(session);
      res.json({ ok: true, complete, progress: assessment.progress(session), step: idx < session.steps.length ? assessment.publicStep(session, idx) : null });
    },

    submit(req, res) {
      const part = partOf(req.body && req.body.part);
      const slot = req.user.assessment[part];
      if (!slot.session || slot.session.status !== 'in_progress') throw new AppError(409, 'There is no assessment in progress.', 'NO_SESSION');
      const result = part === 'core' ? assessment.buildCoreResult(slot.session) : assessment.buildCognitiveResult(slot.session);
      storage.users.update(req.user.id, (u) => {
        u.assessment[part].result = result;
        u.assessment[part].session.status = 'submitted';
        if (part === 'core') u.accessibility.recommended = { ...result.recommended, generatedAt: result.submittedAt };
      });
      res.status(201).json(part === 'core' ? assessment.presentCoreResult(result) : result);
    },

    results(req, res) {
      const part = partOf(req.query.part);
      const result = req.user.assessment[part].result;
      if (!result) throw new AppError(404, 'No assessment results yet. Take the assessment first.', 'NO_RESULT');
      if (part !== 'core') return res.json(result);
      res.json({ ...assessment.presentCoreResult(result), cognitiveCompleted: !!req.user.assessment.cognitive.result });
    },
  };
}
