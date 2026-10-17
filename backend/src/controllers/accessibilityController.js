import { AppError } from '../utils/AppError.js';
import { DEFAULT_SETTINGS } from '../data/settingsSchema.js';
import { sanitizeSettings } from '../services/settingsService.js';
import { accessibilityView, effectiveSettings } from '../services/accessibilityService.js';

export function createAccessibilityController({ storage }) {
  const write = (userId, settings) =>
    storage.users.update(userId, (u) => {
      u.accessibility.settings = settings;
      u.accessibility.updatedAt = new Date().toISOString();
    });
  return {
    get: (req, res) => res.json(accessibilityView(req.user)),

    /** Partial update: only the fields you send change. Manual settings always win over the recommendation. */
    update(req, res) {
      const body = req.body && req.body.settings !== undefined ? req.body.settings : req.body;
      const { settings, errors } = sanitizeSettings(body, { partial: true });
      if (errors.length) throw new AppError(400, 'Some settings are not valid.', 'VALIDATION', errors);
      if (!Object.keys(settings).length) throw new AppError(400, 'Send at least one setting to change.', 'VALIDATION');
      res.json(accessibilityView(write(req.user.id, { ...effectiveSettings(req.user), ...settings })));
    },

    /** {to:"recommended"} = "Reset to Recommended" / "Apply Recommended Settings"; {to:"default"} = "Reset to Default". */
    reset(req, res) {
      const to = (req.body && req.body.to) || 'recommended';
      if (!['recommended', 'default'].includes(to)) throw new AppError(400, 'to must be "recommended" or "default".', 'VALIDATION');
      if (to === 'recommended') {
        const rec = req.user.accessibility.recommended;
        if (!rec) throw new AppError(409, 'There is no recommendation yet. Take the assessment first.', 'NO_RECOMMENDATION');
        return res.json(accessibilityView(write(req.user.id, { ...DEFAULT_SETTINGS, ...rec.settings })));
      }
      res.json(accessibilityView(write(req.user.id, { ...DEFAULT_SETTINGS })));
    },
  };
}
