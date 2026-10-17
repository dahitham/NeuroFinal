import { effectiveSettings } from '../services/accessibilityService.js';
import { describeSettings, levelInfo } from '../services/personalizationService.js';
import { CORE } from '../data/assessmentConfig.js';

/** Aggregates exactly what the Dashboard page shows. Nothing here is invented – missing data stays null. */
export function createDashboardController({ assessment, datasets }) {
  const prefLabel = new Map(datasets.preferences.items.map((p) => [p.id, p.category])); // 'PREF-FONT-01' → 'Font Preference'
  return {
    get(req, res) {
      const u = req.user;
      const core = u.assessment.core;
      const result = core.result;
      let status = 'none';
      let progress = null;
      if (core.session && core.session.status === 'in_progress') {
        status = 'in_progress';
        const p = assessment.progress(core.session);
        progress = { answered: p.answered, total: p.total };
      }
      if (result) status = status === 'in_progress' ? 'retaking' : 'complete';
      const rec = u.accessibility.recommended;
      const settings = effectiveSettings(u);
      const saved = !!u.accessibility.settings;
      const cog = u.assessment.cognitive.result;
      res.json({
        user: { name: u.name },
        assessment: {
          status,
          progress,
          summary: result
            ? { score: result.score.total, max: result.score.max, level: result.score.level, label: result.score.label, classification: result.score.classification, submittedAt: result.submittedAt, components: result.score.components, description: levelInfo(result.score.level).description }
            : null,
        },
        recommendedLevel: rec ? rec.assistanceLevel : null,
        accessibility: { saved, summary: saved ? describeSettings(settings) : null, settings },
        quickControls: { focusMode: settings.focusMode, readingRuler: settings.readingRuler },
        extension: { connected: u.extension.connected, connectedAt: u.extension.connectedAt, lastSeenAt: u.extension.lastSeenAt },
        preferences: result
          ? { items: Object.entries(result.preferences.answers).map(([id, choice]) => ({ category: prefLabel.get(id) || id, choice })), congruence: result.preferences.congruence.score }
          : null,
        cognitive: cog ? { completed: true, overallPercent: cog.overallPercent } : { completed: false },
        estimatedMinutes: Math.ceil(((CORE.readingPassages * 2 + CORE.wordDifficultyCount + 12) * CORE.secondsPerStep) / 60),
      });
    },
  };
}
