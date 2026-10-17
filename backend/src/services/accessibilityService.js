import { DEFAULT_SETTINGS } from '../data/settingsSchema.js';
import { pickSettings } from './settingsService.js';

/** Settings in force for a user: saved settings, else the recommendation, else neutral defaults. */
export function effectiveSettings(user) {
  const a = user.accessibility || {};
  return { ...DEFAULT_SETTINGS, ...(a.settings || (a.recommended && a.recommended.settings) || {}) };
}

export function accessibilityView(user) {
  const a = user.accessibility || {};
  return {
    settings: effectiveSettings(user),
    saved: !!a.settings,
    assistanceLevel: a.recommended ? a.recommended.assistanceLevel : null,
    recommended: a.recommended ? { assistanceLevel: a.recommended.assistanceLevel, assistanceLabel: a.recommended.assistanceLabel, settings: { ...DEFAULT_SETTINGS, ...a.recommended.settings } } : null,
    defaults: { ...DEFAULT_SETTINGS },
    updatedAt: a.updatedAt || null,
  };
}

export { pickSettings };
