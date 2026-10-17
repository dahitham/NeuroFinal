// The accessibility engine lives in /extension/content so the Chrome extension and the Reading Studio preview
// run EXACTLY the same code. It attaches itself to globalThis.
import '@ext/neurosync-engine.js';

export const Engine = globalThis.NeuroSyncEngine;
export const DEFAULT_SETTINGS = Engine.DEFAULT_SETTINGS;
