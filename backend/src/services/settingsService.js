import { DEFAULT_SETTINGS, SETTING_RULES } from '../data/settingsSchema.js';

/**
 * Validates (partial) accessibility settings coming from the client.
 * Unknown keys are rejected; numbers must be in range and are snapped to the control's step.
 */
export function sanitizeSettings(input, { partial = true } = {}) {
  const errors = [];
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { settings: null, errors: ['Settings must be an object.'] };
  for (const [key, value] of Object.entries(input)) {
    const rule = SETTING_RULES[key];
    if (!rule) {
      errors.push(`"${key}" is not a known setting.`);
      continue;
    }
    if (rule.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`"${key}" must be true or false.`);
      else out[key] = value;
    } else if (rule.type === 'enum') {
      if (!rule.values.includes(value)) errors.push(`"${key}" must be one of: ${rule.values.join(', ')}.`);
      else out[key] = value;
    } else if (rule.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`"${key}" must be a number.`);
      else if (value < rule.min - 1e-9 || value > rule.max + 1e-9) errors.push(`"${key}" must be between ${rule.min} and ${rule.max}.`);
      else out[key] = Math.round(value / rule.step) * rule.step === value ? value : Number((Math.round(value / rule.step) * rule.step).toFixed(2));
    }
  }
  if (!partial) for (const k of Object.keys(DEFAULT_SETTINGS)) if (!(k in out)) out[k] = DEFAULT_SETTINGS[k];
  return { settings: errors.length ? null : out, errors };
}

export const withDefaults = (settings) => ({ ...DEFAULT_SETTINGS, ...(settings || {}) });

export const pickSettings = (obj) =>
  Object.fromEntries(Object.keys(DEFAULT_SETTINGS).filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
