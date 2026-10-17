/**
 * NeuroSync selection assistant
 * ------------------------------------------------------------------
 * Shows "Simplify / Summarize / Explain Word / Listen" next to selected text.
 * Only the text the user selected is ever sent anywhere, and only after a click.
 *
 * Word help is LOCAL FIRST (vocabulary derived from datasets/Word_Difficulty_Test.json).
 * The remote AI is only used when the word is not found locally, and the
 * request is debounced, cached and de-duplicated.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NeuroSyncSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AI_DOWN = 'AI assistance is temporarily unavailable. Your local accessibility tools are still available.';
  const MAX_TEXT = 5000;

  function normalizeWord(raw) {
    const w = String(raw || '')
      .trim()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .toLowerCase();
    if (!w || w.length > 40 || /\s/.test(w)) return '';
    return w;
  }

  /** Local-first word assistant with cache, in-flight de-duplication and debounce. */
  function createWordAssistant(cfg) {
    const debounceMs = cfg.debounceMs == null ? 350 : cfg.debounceMs;
    const cache = new Map();
    const inflight = new Map();
    let timer = null;
    let rejectPending = null;
    return {
      cache,
      assist(raw, context) {
        const word = normalizeWord(raw);
        if (!word) return Promise.reject(new Error('Please select a single word.'));
        if (cache.has(word)) return Promise.resolve(cache.get(word));
        const local = cfg.lookupLocal && cfg.lookupLocal(word);
        if (local) {
          const entry = Object.assign({ source: 'local' }, local);
          cache.set(word, entry);
          return Promise.resolve(entry);
        }
        if (inflight.has(word)) return inflight.get(word);
        const p = new Promise((resolve, reject) => {
          clearTimeout(timer);
          if (rejectPending) rejectPending(Object.assign(new Error('superseded'), { superseded: true }));
          rejectPending = reject;
          timer = setTimeout(async () => {
            rejectPending = null;
            try {
              const result = Object.assign({ source: 'ai' }, await cfg.requestRemote(word, context));
              cache.set(word, result);
              resolve(result);
            } catch (e) {
              reject(e);
            }
          }, debounceMs);
        });
        inflight.set(word, p);
        const cleanup = () => inflight.delete(word);
        p.then(cleanup, cleanup);
        return p;
      },
    };
  }

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .bar{position:fixed;z-index:2147483647;display:flex;gap:4px;padding:6px;background:#264653;border-radius:12px;box-shadow:0 8px 28px rgba(17,24,39,.35)}
  .bar button{all:unset;cursor:pointer;color:#fff;font-size:13px;font-weight:600;padding:7px 11px;border-radius:8px;line-height:1}
  .bar button:hover,.bar button:focus-visible{background:#1F7F73;outline:2px solid #fff}
  .bar button[disabled]{opacity:.45;cursor:not-allowed}
  .panel{position:fixed;z-index:2147483647;width:min(360px,calc(100vw - 24px));max-height:60vh;overflow:auto;background:#fff;color:#264653;border:1px solid #e5e7eb;border-radius:14px;padding:14px 16px;box-shadow:0 14px 40px rgba(17,24,39,.25);font-size:15px;line-height:1.55}
  .panel h4{margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#1F7F73}
  .panel p,.panel ul{margin:0 0 8px}.panel ul{padding-left:18px}
  .panel .x{all:unset;position:absolute;top:8px;right:10px;cursor:pointer;font-size:18px;color:#6B7280}
  .panel dt{font-weight:700;margin-top:6px}.panel dd{margin:0 0 4px}
  .muted{color:#6B7280;font-size:12px}.err{color:#b91c1c}
  .row{display:flex;gap:8px;margin-top:8px}
  .row button{all:unset;cursor:pointer;background:#E8F4F2;color:#264653;font-weight:600;font-size:13px;padding:6px 10px;border-radius:8px}
  `;

  function init(cfg) {
    const doc = cfg.document || document;
    const win = doc.defaultView || window;
    const assistant = createWordAssistant({
      lookupLocal: cfg.lookupLocal,
      requestRemote: (word, ctx) => cfg.request('word', { word, context: ctx }),
    });

    const host = doc.createElement('div');
    host.setAttribute('data-ns-skip', '');
    host.id = 'neurosync-selection-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    const mount = doc.createElement('div');
    shadow.appendChild(mount);
    doc.documentElement.appendChild(host);

    let selectedText = '';
    let requestId = 0;

    const clear = () => {
      mount.textContent = '';
      requestId++;
    };

    function selectionAllowed(sel) {
      if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
      const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (!node || node.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],#ns-reader-none')) return false;
      const form = node.closest('form');
      if (form && form.querySelector('input[type="password"],input[autocomplete^="cc-"]')) return false;
      return true;
    }

    function showBar() {
      clear();
      const sel = win.getSelection();
      if (!selectionAllowed(sel)) return;
      const text = sel.toString().trim();
      if (text.length < 2) return;
      selectedText = text.slice(0, MAX_TEXT);
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect ? range.getBoundingClientRect() : { left: 8, bottom: 8 };
      const bar = doc.createElement('div');
      bar.className = 'bar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'NeuroSync assistance');
      bar.style.top = Math.min(win.innerHeight - 56, rect.bottom + 8) + 'px';
      bar.style.left = Math.max(8, Math.min(win.innerWidth - 340, rect.left)) + 'px';
      bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection alive
      const singleWord = !!normalizeWord(text);
      [
        ['Simplify', 'simplify', true],
        ['Summarize', 'summarize', true],
        ['Explain Word', 'word', singleWord],
        ['Listen', 'listen', true],
      ].forEach(([label, kind, enabled]) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (!enabled) {
          b.disabled = true;
          b.title = 'Select a single word to use this';
        }
        b.addEventListener('click', () => run(kind, bar));
        bar.appendChild(b);
      });
      mount.appendChild(bar);
    }

    function panel(anchorBar, title) {
      const old = mount.querySelector('.panel');
      if (old) old.remove();
      const p = doc.createElement('div');
      p.className = 'panel';
      p.setAttribute('role', 'dialog');
      p.setAttribute('aria-label', title);
      const top = parseFloat(anchorBar.style.top) + 48;
      p.style.top = Math.min(win.innerHeight - 120, top) + 'px';
      p.style.left = anchorBar.style.left;
      const h = doc.createElement('h4');
      h.textContent = title;
      const x = doc.createElement('button');
      x.className = 'x';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', clear);
      p.append(x, h);
      mount.appendChild(p);
      return p;
    }

    const add = (parent, tag, text, cls) => {
      const el = doc.createElement(tag);
      el.textContent = text;
      if (cls) el.className = cls;
      parent.appendChild(el);
      return el;
    };

    async function run(kind, bar) {
      if (kind === 'listen') {
        if (cfg.speak) cfg.speak(selectedText);
        return;
      }
      const titles = { simplify: 'Simplified text', summarize: 'Summary', word: 'Word help' };
      const p = panel(bar, titles[kind]);
      const id = ++requestId;
      add(p, 'p', 'Working on it…', 'muted').setAttribute('role', 'status');
      try {
        let result;
        if (kind === 'word') result = await assistant.assist(selectedText, selectionContext());
        else result = await cfg.request(kind, { text: selectedText });
        if (id !== requestId) return;
        render(p, kind, result);
      } catch (e) {
        if (id !== requestId || (e && e.superseded)) return;
        p.querySelector('.muted') && p.querySelector('.muted').remove();
        const msg = e && e.userMessage ? e.userMessage : e && e.message && kind === 'word' && /single word/.test(e.message) ? e.message : AI_DOWN;
        add(p, 'p', msg, 'err').setAttribute('role', 'alert');
      }
    }

    function selectionContext() {
      const sel = win.getSelection();
      const el = sel && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      return el && el.textContent ? el.textContent.trim().slice(0, 300) : '';
    }

    function render(p, kind, r) {
      p.querySelectorAll('.muted').forEach((n) => n.remove());
      if (kind === 'simplify') {
        add(p, 'p', r.simplified || r.text || '');
      } else if (kind === 'summarize') {
        const bullets = r.bullets && r.bullets.length ? r.bullets : [r.summary || ''];
        const ul = add(p, 'ul', '');
        bullets.forEach((b) => add(ul, 'li', b));
      } else {
        const dl = add(p, 'dl', '');
        add(dl, 'dt', 'Simple meaning');
        add(dl, 'dd', r.simpleMeaning || '—');
        if (r.synonym) {
          add(dl, 'dt', 'Synonym');
          add(dl, 'dd', r.synonym);
        }
        if (r.pronunciation) {
          add(dl, 'dt', 'Pronunciation');
          add(dl, 'dd', r.pronunciation);
        }
        if (r.visualHint) {
          add(dl, 'dt', r.source === 'local' ? 'Example' : 'Visual hint');
          add(dl, 'dd', r.visualHint);
        }
        add(p, 'p', r.source === 'local' ? 'From the local NeuroSync vocabulary (works offline).' : 'Generated by AI — double-check important details.', 'muted');
        if (cfg.speak) {
          const row = add(p, 'div', '', 'row');
          const b = add(row, 'button', '🔊 Say word');
          b.addEventListener('click', () => cfg.speak(normalizeWord(selectedText)));
        }
      }
      if (kind !== 'word') add(p, 'p', 'Generated by AI — double-check important details.', 'muted');
    }

    let selTimer = null;
    const onUp = (e) => {
      if (e.composedPath && e.composedPath().includes(host)) return;
      clearTimeout(selTimer);
      selTimer = setTimeout(showBar, 120);
    };
    const onDown = (e) => {
      if (e.composedPath && e.composedPath().includes(host)) return;
      clear();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') clear();
    };
    doc.addEventListener('mouseup', onUp);
    doc.addEventListener('keyup', (e) => e.shiftKey && onUp(e));
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('keydown', onKey);

    return {
      assistant,
      destroy() {
        doc.removeEventListener('mouseup', onUp);
        doc.removeEventListener('mousedown', onDown);
        doc.removeEventListener('keydown', onKey);
        host.remove();
      },
    };
  }

  return { init, createWordAssistant, normalizeWord, AI_DOWN };
});
