import { effectiveSettings } from '../services/accessibilityService.js';

export function createExtensionController({ extension }) {
  return {
    pairingCode: (req, res) => res.status(201).json(extension.createPairingCode(req.user)),
    connect: (req, res) => res.status(201).json(extension.connect(req.valid.code, req.valid.label)),
    status: (req, res) => res.json(extension.status(req.user)),
    disconnect(req, res) {
      extension.disconnect(req.user.id);
      res.json({ ok: true });
    },
    /** What the extension needs: who, the settings in force, and the assistance level. No secrets. */
    sync(req, res) {
      if (req.authType === 'ext') extension.touch(req.user.id);
      const rec = req.user.accessibility.recommended;
      res.json({
        user: { name: req.user.name },
        assistanceLevel: rec ? rec.assistanceLevel : null,
        hasProfile: !!(req.user.accessibility.settings || rec),
        settings: effectiveSettings(req.user),
        updatedAt: req.user.accessibility.updatedAt || (rec && rec.generatedAt) || null,
      });
    },
  };
}
