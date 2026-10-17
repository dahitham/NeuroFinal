import { AppError } from '../utils/AppError.js';
import { aggregate, buildRecord, recordsToCsv, validateEvaluationInput } from '../services/evaluationService.js';

export function createEvaluationController({ storage, config }) {
  const isAdmin = (u) => config.researchAdmins.includes(u.email);
  const requireAdmin = (u) => {
    if (!isAdmin(u)) throw new AppError(403, 'Research data is only available to the research team.', 'FORBIDDEN');
  };
  return {
    /** Consent can be changed at any time. Declining stops all research collection. */
    consent(req, res) {
      const c = req.body && req.body.consent;
      if (typeof c !== 'boolean') throw new AppError(400, '"consent" must be true or false.', 'VALIDATION');
      const u = storage.users.update(req.user.id, (x) => {
        x.research = { consent: c, consentAt: new Date().toISOString() };
      });
      res.json({ consent: u.research.consent, consentAt: u.research.consentAt });
    },

    submit(req, res) {
      if (req.user.research.consent !== true) throw new AppError(403, 'Research data is only collected if you agree. You can change this in Settings.', 'NO_CONSENT');
      if (!(req.user.assessment.core.result)) throw new AppError(409, 'Please complete the assessment before sharing feedback.', 'NO_RESULT');
      const input = validateEvaluationInput(req.body);
      const record = storage.evaluations.add((participantId) => buildRecord({ user: req.user, participantId, ...input }));
      res.status(201).json({ ok: true, participantId: record.Participant_ID });
    },

    list(req, res) {
      requireAdmin(req.user);
      const rows = storage.evaluations.list();
      res.json({ count: rows.length, statistics: aggregate(rows), records: rows });
    },

    export(req, res) {
      requireAdmin(req.user);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="neurosync_evaluation.csv"' });
      res.send(recordsToCsv(storage.evaluations.list()));
    },
  };
}
