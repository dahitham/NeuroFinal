/* NeuroSync content script – applies the saved profile to the current website. */
(function () {
  const E = globalThis.NeuroSyncEngine;
  const S = globalThis.NeuroSyncSelection;
  if (!E || !S || window.top !== window) return;

  const KEYS = ['ns_settings', 'ns_overrides', 'ns_enabled'];
  let state = {};
  let firstApply = true;
  let toastHost = null;

  /* ---- friendly notices (shadow DOM so the page can't restyle them) ---- */
  function toast(msg) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.setAttribute('data-ns-skip', '');
      const root = toastHost.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>.t{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;background:#264653;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.3)}</style><div class="t" role="status"></div>';
      document.documentElement.appendChild(toastHost);
    }
    const el = toastHost.shadowRoot.querySelector('.t');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.style.display = 'none'), 4000);
  }

  const engine = E.create({
    fontBase: chrome.runtime.getURL('assets/fonts/'),
    onNotice: toast,
    onReaderExit: () => chrome.storage.local.set({ ns_overrides: Object.assign({}, state.ns_overrides, { readerMode: false }) }),
  });

  function effective() {
    if (state.ns_enabled === false) return null;
    if (!state.ns_settings) return null; // not connected yet
    return E.mergeSettings(state.ns_settings, state.ns_overrides);
  }

  /* ---- TTS dock (shown when the profile enables text-to-speech) ---- */
  let dock = null;
  function updateDock(s) {
    if (!s || !s.textToSpeech || !engine.tts.isSupported()) {
      if (dock) dock.remove();
      dock = null;
      return;
    }
    if (dock) return;
    dock = document.createElement('div');
    dock.setAttribute('data-ns-skip', '');
    const root = dock.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .d{position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #E5E7EB;border-radius:999px;padding:6px 8px;box-shadow:0 8px 24px rgba(17,24,39,.2);font:600 13px system-ui,sans-serif}
      button{all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;background:#E8F4F2;color:#264653}
      button:hover,button:focus-visible{background:#1F7F73;color:#fff;outline:none}
      select{font:inherit;border:1px solid #d1d5db;border-radius:8px;padding:3px}
    </style><div class="d" role="group" aria-label="NeuroSync text to speech">
      <button data-a="play" aria-label="Play">▶ Listen</button><button data-a="pause" aria-label="Pause or resume">⏸</button>
      <button data-a="stop" aria-label="Stop">⏹</button>
      <select aria-label="Speech rate"><option value="0.8">0.8×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></div>`;
    const rate = root.querySelector('select');
    rate.value = String(s.speechSpeed || 1);
    root.addEventListener('click', (e) => {
      const a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a) handleTts(a, Number(rate.value));
    });
    document.documentElement.appendChild(dock);
  }

  function handleTts(action, rate) {
    const t = engine.tts;
    if (action === 'play') t.play(engine.readText(), rate);
    else if (action === 'pause') (t.getState() === 'paused' ? t.resume() : t.pause());
    else if (action === 'resume') t.resume();
    else if (action === 'stop') t.stop();
  }

  function applyNow() {
    const s = effective();
    if (!s) {
      engine.apply(E.DEFAULT_SETTINGS);
      updateDock(null);
    } else {
      engine.apply(s, { auto: firstApply });
      updateDock(s);
    }
    firstApply = false;
  }

  /* ---- selection assistant ---- */
  let vocab = null;
  chrome.runtime.sendMessage({ type: 'NS_VOCAB' }, (v) => (vocab = v || {}));
  S.init({
    lookupLocal: (w) => (vocab && vocab[w]) || null,
    speak: (text) => engine.tts.play(text, (effective() || {}).speechSpeed || 1),
    request: (kind, body) =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'NS_AI', kind, body }, (res) => {
          if (chrome.runtime.lastError || !res || !res.ok) reject({ userMessage: res && res.message ? res.message : S.AI_DOWN });
          else resolve(res.data);
        });
      }),
  });

  /* ---- messages from the popup ---- */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'NS_TTS') handleTts(msg.action, msg.rate);
    if (msg.type === 'NS_TTS_STATE') return sendResponse({ state: engine.tts.getState() });
    if (msg.type === 'NS_READER') {
      engine.reader.isOpen() ? engine.reader.close() : engine.reader.open();
    }
  });

  chrome.storage.onChanged.addListener((_c, area) => {
    if (area !== 'local') return;
    chrome.storage.local.get(KEYS, (s) => {
      state = s;
      applyNow();
    });
  });

  chrome.storage.local.get(KEYS, (s) => {
    state = s;
    applyNow();
  });
})();
