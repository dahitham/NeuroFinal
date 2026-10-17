/* NeuroSync popup: pairs with the account, then edits LOCAL overrides on top of the synced settings. */
const SPACING = {
  default: { lineSpacing: 1.5, letterSpacing: 0, wordSpacing: 0 },
  comfortable: { lineSpacing: 1.9, letterSpacing: 4, wordSpacing: 3 },
  wide: { lineSpacing: 2.0, letterSpacing: 6, wordSpacing: 6 },
};
const LEVEL = { 1: 'Mild Assistance', 2: 'Moderate Assistance', 3: 'Maximum Assistance' };
const $ = (id) => document.getElementById(id);
let state = {};

const effective = () => Object.assign({ font: 'system', bionicReading: false, focusMode: false, readingRuler: false, lineSpacing: 1.5, letterSpacing: 0, wordSpacing: 0 }, state.ns_settings || {}, state.ns_overrides || {});
const spacingKey = (s) => (s.lineSpacing >= 2 || s.letterSpacing >= 6 ? 'wide' : s.lineSpacing > 1.5 || s.letterSpacing > 0 || s.wordSpacing > 0 ? 'comfortable' : 'default');
const notice = (msg) => { $('notice').textContent = msg || ''; $('notice').hidden = !msg; };
const load = async () => (state = await chrome.storage.local.get(['ns_token', 'ns_settings', 'ns_overrides', 'ns_enabled', 'ns_level', 'ns_user', 'ns_synced_at', 'ns_has_profile', 'ns_api']));

function render() {
  const connected = !!state.ns_token;
  $('connect').hidden = connected;
  $('controls').hidden = !connected;
  $('footer').hidden = !connected;
  $('enabled').checked = state.ns_enabled !== false;
  if (!connected) {
    $('level').textContent = 'Not connected';
    return;
  }
  const s = effective();
  $('bionicReading').checked = !!s.bionicReading;
  $('font').value = s.font;
  $('spacing').value = spacingKey(s);
  $('focusMode').checked = !!s.focusMode;
  $('readingRuler').checked = !!s.readingRuler;
  $('level').textContent = state.ns_level ? 'Recommended: ' + LEVEL[state.ns_level] : (state.ns_user && state.ns_user.name ? 'Hi, ' + state.ns_user.name : 'Connected');
  notice(state.ns_has_profile ? '' : 'Take the assessment in NeuroSync (or open Reading Studio) to create your settings.');
  $('sync').hidden = !state.ns_synced_at;
  $('sync').textContent = state.ns_synced_at ? 'Last synced ' + new Date(state.ns_synced_at).toLocaleTimeString() : '';
}

function setOverride(patch) {
  state.ns_overrides = Object.assign({}, state.ns_overrides, patch);
  chrome.storage.local.set({ ns_overrides: state.ns_overrides });
}

async function tab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; }
async function toTab(msg) {
  const t = await tab();
  if (!t || !t.id) return;
  try { await chrome.tabs.sendMessage(t.id, msg); } catch (e) { notice('NeuroSync cannot run on this page (for example browser pages or the Web Store). Try a normal website.'); }
}

document.addEventListener('DOMContentLoaded', async () => {
  await load();
  render();
  if (state.ns_token) chrome.runtime.sendMessage({ type: 'NS_SYNC' }, async (r) => { await load(); render(); if (r && r.reason === 'disconnected') notice('This extension was disconnected in NeuroSync. Enter a new pairing code.'); });

  $('connectBtn').addEventListener('click', () => {
    const code = $('code').value.trim();
    if (!code) { $('connectMsg').textContent = 'Enter the pairing code from NeuroSync.'; $('connectMsg').hidden = false; return; }
    $('connectBtn').disabled = true;
    chrome.runtime.sendMessage({ type: 'NS_CONNECT', code }, async (r) => {
      $('connectBtn').disabled = false;
      if (r && r.ok) { $('connectMsg').hidden = true; await load(); render(); }
      else { $('connectMsg').textContent = (r && r.message) || 'Could not connect. Is the NeuroSync backend running?'; $('connectMsg').hidden = false; }
    });
  });
  $('enabled').addEventListener('change', (e) => chrome.storage.local.set({ ns_enabled: e.target.checked }));
  ['bionicReading', 'focusMode', 'readingRuler'].forEach((id) => $(id).addEventListener('change', (e) => setOverride({ [id]: e.target.checked })));
  $('font').addEventListener('change', (e) => setOverride({ font: e.target.value }));
  $('spacing').addEventListener('change', (e) => setOverride(SPACING[e.target.value]));
  $('reader').addEventListener('click', () => toTab({ type: 'NS_READER' }));
  $('ttsPlay').addEventListener('click', () => toTab({ type: 'NS_TTS', action: 'play', rate: effective().speechSpeed || 1 }));
  $('ttsPause').addEventListener('click', () => toTab({ type: 'NS_TTS', action: 'pause' }));
  $('ttsStop').addEventListener('click', () => toTab({ type: 'NS_TTS', action: 'stop' }));
  $('reset').addEventListener('click', async () => { await chrome.storage.local.remove('ns_overrides'); state.ns_overrides = undefined; render(); notice('Reset to the settings saved in NeuroSync.'); });
  $('open').addEventListener('click', () => chrome.tabs.create({ url: 'http://localhost:5173/dashboard' }));
  chrome.storage.onChanged.addListener(async () => { await load(); render(); });
});
