import { AppError } from '../utils/AppError.js';
import { verifyPassword } from '../services/passwords.js';
import { MODES } from '../data/assessmentConfig.js';

export function profileView(u, config) {
  return {
    user: { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt },
    preferences: { assessmentMode: u.preferences.assessmentMode },
    assistanceLevel: u.accessibility.recommended ? u.accessibility.recommended.assistanceLevel : null,
    research: { consent: u.research.consent, consentAt: u.research.consentAt },
    extension: { connected: u.extension.connected, connectedAt: u.extension.connectedAt, lastSeenAt: u.extension.lastSeenAt },
    isResearchAdmin: config.researchAdmins.includes(u.email),
  };
}

export function createProfileController({ storage, config }) {
  return {
    get: (req, res) => res.json(profileView(req.user, config)),
    update(req, res) {
      const body = req.body || {};
      const allowed = ['name', 'assessmentMode'];
      for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new AppError(400, `"${k}" cannot be changed here.`, 'VALIDATION');
      if ('name' in body && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 60)) throw new AppError(400, 'Name must be 1–60 characters.', 'VALIDATION');
      if ('assessmentMode' in body && !MODES.includes(body.assessmentMode)) throw new AppError(400, `assessmentMode must be one of: ${MODES.join(', ')}.`, 'VALIDATION');
      const user = storage.users.update(req.user.id, (u) => {
        if ('name' in body) u.name = body.name.trim();
        if ('assessmentMode' in body) u.preferences.assessmentMode = body.assessmentMode;
      });
      res.json(profileView(user, config));
    },
    /** Deletes the account and everything stored for it (anonymous research records are unlinked and stay). */
    remove(req, res) {
      const pw = req.body && req.body.password;
      if (typeof pw !== 'string' || !verifyPassword(pw, req.user.passwordHash)) throw new AppError(401, 'Password is incorrect.', 'BAD_CREDENTIALS');
      storage.users.remove(req.user.id);
      res.json({ ok: true });
    },
  };
}
