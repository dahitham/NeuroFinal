/**
 * NeuroSync Accessibility Engine
 * ------------------------------------------------------------------
 * Framework-free module shared by the Chrome extension (content script) and
 * the React web app (imported through the `@ext` alias). It never talks to the
 * network: every feature here works fully offline.
 *
 * Features: fonts (Lexend / OpenDyslexic), font size, line/letter/word spacing,
 * bionic reading, background colour + tint + contrast, reading ruler,
 * focus mode, reader mode and text-to-speech (SpeechSynthesis).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NeuroSyncEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Same schema as the backend (backend/src/data/settingsSchema.js) and the Reading Studio page.
   * fontSize 16px and lineSpacing 1.5 mean "leave the website as it is".
   * letterSpacing / wordSpacing are slider values 0–10 (× 0.01em and × 0.03em).
   */
  const DEFAULT_SETTINGS = Object.freeze({
    font: 'system', // system | lexend | atkinson | opendyslexic
    fontSize: 16,
    lineSpacing: 1.5,
    letterSpacing: 0,
    wordSpacing: 0,
    bionicReading: false,
    bionicIntensity: 'normal', // light | normal
    readingRuler: false,
    focusMode: false,
    readerMode: false,
    background: 'white', // white | cream | gray
    colorTint: 'none', // none | yellow | blue
    contrast: 'standard', // standard | high
    textToSpeech: false,
    speechSpeed: 1,
  });

  const BACKGROUNDS = Object.freeze({ white: '#FFFFFF', cream: '#FCF6E3', gray: '#EEF0F1' });
  const TINTS = Object.freeze({ none: '#FFFFFF', yellow: '#FFF8D6', blue: '#E3EEF9' });

  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  /** Page colour = background × tint (multiply), or null when both are plain white. */
  function pageColor(s) {
    if (s.background === 'white' && s.colorTint === 'none') return null;
    const a = hexToRgb(BACKGROUNDS[s.background] || BACKGROUNDS.white);
    const b = hexToRgb(TINTS[s.colorTint] || TINTS.none);
    return '#' + a.map((v, i) => Math.round((v * b[i]) / 255).toString(16).padStart(2, '0')).join('');
  }

  const BIONIC_SKIP =
    'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,canvas,iframe,video,audio,' +
    '[contenteditable=""],[contenteditable="true"],.ns-bionic-wrap,[data-ns-skip],#ns-ruler';
  const SENSITIVE_FORM =
    'input[type="password"],input[autocomplete^="cc-"],input[name*="card" i],input[name*="cvv" i],input[name*="iban" i]';
  const ICON_EXCLUDE =
    ':not([class*="icon" i]):not([class*="fa-" i]):not(.material-icons):not(.material-symbols-outlined):not([class*="glyph" i]):not(pre):not(code):not(kbd):not(samp)';
  const FOCUS_BLOCKS = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,pre,dd,figcaption';

  function mergeSettings(recommended, overrides) {
    return Object.assign({}, DEFAULT_SETTINGS, recommended || {}, overrides || {});
  }

  /* ---------------------------------------------------------------- bionic */

  /** Returns the number of leading characters to embolden for a word. */
  function bionicSplitIndex(wordLength, intensity) {
    if (wordLength <= 1) return 0;
    const ratio = intensity === 'light' ? 0.3 : 0.5;
    return Math.max(1, Math.ceil(wordLength * ratio));
  }

  function isSkippable(textNode) {
    const parent = textNode.parentElement;
    if (!parent) return true;
    if (parent.closest(BIONIC_SKIP)) return true;
    const form = parent.closest('form');
    if (form && form.querySelector(SENSITIVE_FORM)) return true;
    return textNode.nodeValue.trim().length < 2;
  }

  function collectTextNodes(rootEl) {
    const doc = rootEl.ownerDocument || document;
    const walker = doc.createTreeWalker(rootEl, 4 /* SHOW_TEXT */, {
      acceptNode: (n) => (isSkippable(n) ? 2 /* REJECT */ : 1 /* ACCEPT */),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function bionicifyNode(textNode, intensity) {
    const doc = textNode.ownerDocument;
    const text = textNode.nodeValue;
    const wrap = doc.createElement('span');
    wrap.className = 'ns-bionic-wrap';
    wrap.setAttribute('data-ns-orig', text);
    text.split(/(\s+)/).forEach((token) => {
      const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}'’-]+)([\s\S]*)$/u.exec(token);
      if (!m) {
        wrap.appendChild(doc.createTextNode(token));
        return;
      }
      const [, lead, word, tail] = m;
      const cut = bionicSplitIndex(word.length, intensity);
      if (lead) wrap.appendChild(doc.createTextNode(lead));
      if (cut > 0) {
        const b = doc.createElement('b');
        b.className = 'ns-b';
        b.textContent = word.slice(0, cut);
        wrap.appendChild(b);
      }
      wrap.appendChild(doc.createTextNode(word.slice(cut) + tail));
    });
    textNode.parentNode.replaceChild(wrap, textNode);
  }

  /** Synchronous bionic pass. Returns the number of text nodes converted. */
  function bionicifyTextNodes(rootEl, intensity) {
    const nodes = collectTextNodes(rootEl);
    nodes.forEach((n) => bionicifyNode(n, intensity));
    return nodes.length;
  }

  function removeBionic(rootEl) {
    const doc = rootEl.ownerDocument || document;
    rootEl.querySelectorAll('.ns-bionic-wrap').forEach((wrap) => {
      wrap.parentNode.replaceChild(doc.createTextNode(wrap.getAttribute('data-ns-orig') || wrap.textContent), wrap);
    });
    if (rootEl.normalize) rootEl.normalize();
  }

  /* ----------------------------------------------------------- reader mode */

  function paragraphScore(el) {
    let score = 0;
    el.querySelectorAll('p').forEach((p) => {
      const len = p.textContent.trim().length;
      if (len >= 40) score += len;
    });
    return score;
  }

  /** Finds the most article-like element inside `rootEl`. */
  function extractMainContent(rootEl) {
    const preferred = rootEl.querySelectorAll(
      'article,[role="main"],main,#content,.post-content,.article-body,.entry-content,.post-body'
    );
    let best = null;
    let bestScore = 0;
    const consider = (el) => {
      const s = paragraphScore(el);
      if (s > bestScore) {
        best = el;
        bestScore = s;
      }
    };
    preferred.forEach(consider);
    if (!best || bestScore < 300) rootEl.querySelectorAll('div,section,article,main').forEach(consider);
    if (!best && paragraphScore(rootEl) > 0) best = rootEl; // e.g. a preview box whose content is the scope itself
    if (!best) return null;
    const words = best.textContent.trim().split(/\s+/).length;
    const doc = rootEl.ownerDocument || document;
    const h1 = best.querySelector('h1') || rootEl.querySelector('h1');
    return { node: best, words, title: (h1 && h1.textContent.trim()) || doc.title || 'Reader mode' };
  }

  const REMOVE_IN_READER =
    'script,style,noscript,iframe,form,nav,aside,footer,button,input,select,textarea,object,embed,' +
    '[aria-hidden="true"],[class*="advert" i],[class*="share" i],[class*="social" i],[class*="newsletter" i],[class*="cookie" i],[class*="comments" i]';

  function sanitizeForReader(clone) {
    clone.querySelectorAll(REMOVE_IN_READER).forEach((n) => n.remove());
    clone.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => {
        const name = a.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'width' || name === 'height') {
          el.removeAttribute(a.name);
        } else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value)) {
          el.removeAttribute(a.name);
        }
      });
      if (el.tagName === 'IMG' && !el.getAttribute('src')) {
        const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
        if (lazy) el.setAttribute('src', lazy);
      }
      if (el.tagName === 'A') el.setAttribute('rel', 'noopener noreferrer');
    });
    return clone;
  }

  /* ------------------------------------------------------------------- css */

  const FACES = {
    lexend: ['NS Lexend', 'lexend-latin-400-normal.woff2', 'lexend-latin-700-normal.woff2', 'woff2'],
    atkinson: ['NS Atkinson', 'atkinson-hyperlegible-latin-400-normal.woff2', 'atkinson-hyperlegible-latin-700-normal.woff2', 'woff2'],
    opendyslexic: ['NS OpenDyslexic', 'OpenDyslexic-Regular.woff', 'OpenDyslexic-Bold.woff', 'woff'],
  };
  const FAMILY = { lexend: '"NS Lexend",Lexend,sans-serif', atkinson: '"NS Atkinson","Atkinson Hyperlegible",sans-serif', opendyslexic: '"NS OpenDyslexic",OpenDyslexic,sans-serif' };

  function fontFaceCss(font, base) {
    const f = FACES[font];
    if (!f) return '';
    return (
      `@font-face{font-family:"${f[0]}";font-weight:400;font-display:swap;src:url("${base}${f[1]}") format("${f[3]}")}` +
      `@font-face{font-family:"${f[0]}";font-weight:700;font-display:swap;src:url("${base}${f[2]}") format("${f[3]}")}`
    );
  }

  function buildCss(s, sc, fontBase) {
    const out = [fontFaceCss(s.font, fontBase)];
    const ALL = `${sc} :is(p,li,td,th,dd,dt,blockquote,figcaption,label,summary,span,a,em,strong,b,i,cite,q,small,div,h1,h2,h3,h4,h5,h6,button,input,textarea,select)${ICON_EXCLUDE}`;
    const BODY = `${sc} :is(p,li,td,th,dd,dt,blockquote,figcaption,label,summary)`;
    if (FAMILY[s.font]) out.push(`${sc}, ${ALL}{font-family:${FAMILY[s.font]} !important}`);
    if (s.fontSize !== 16) out.push(`${BODY}{font-size:${s.fontSize}px !important}`);
    if (s.lineSpacing !== 1.5) out.push(`${BODY}, ${sc} :is(div,span,a){line-height:${s.lineSpacing} !important}`);
    if (s.letterSpacing > 0) out.push(`${ALL}{letter-spacing:${(s.letterSpacing * 0.01).toFixed(2)}em !important}`);
    if (s.wordSpacing > 0) out.push(`${ALL}{word-spacing:${(s.wordSpacing * 0.03).toFixed(2)}em !important}`);
    if (s.contrast === 'high') out.push(`${BODY}, ${sc} :is(h1,h2,h3,h4,h5,h6){color:#000 !important}${BODY}{font-weight:500 !important}`);
    out.push(`${sc} .ns-bionic-wrap b.ns-b{font-weight:700 !important}`);
    if (s.focusMode) {
      out.push(
        `${sc}.ns-focus-on.ns-focus-active :is(${FOCUS_BLOCKS}):not(.ns-focus-current):not(:has(.ns-focus-current)):not(.ns-focus-current *){opacity:.32;transition:opacity .15s}` +
          `${sc}.ns-focus-on.ns-focus-active :is(aside,nav,footer,[role="banner"],[role="complementary"],[class*="cookie" i],[class*="advert" i]){opacity:.25}` +
          `${sc}.ns-focus-on.ns-focus-active :is(aside,nav,footer):hover{opacity:1}`
      );
    }
    return out.join('\n');
  }

  /* ----------------------------------------------------------- controller */

  let instanceCounter = 0;

  /**
   * @param {object} opts
   * @param {Element} [opts.scope]   Restrict everything to this element (preview areas).
   * @param {string}  [opts.fontBase] Base URL holding the bundled font files.
   * @param {Function} [opts.onReaderExit] Called when the user leaves reader mode.
   * @param {Function} [opts.onNotice]     Called with friendly status messages.
   */
  function create(opts) {
    opts = opts || {};
    const doc = (opts.scope && opts.scope.ownerDocument) || opts.document || document;
    const win = doc.defaultView || window;
    const scopeEl = opts.scope || null;
    const id = 'ns' + ++instanceCounter;
    const fontBase = opts.fontBase || '/fonts/';
    const host = scopeEl || doc.documentElement;
    const sc = scopeEl ? `[data-ns-scope="${id}"]` : 'html.ns-on';
    const notice = (msg) => opts.onNotice && opts.onNotice(msg);

    let settings = Object.assign({}, DEFAULT_SETTINGS);
    let styleEl = null;
    let overlayEl = null;
    let rulerEl = null;
    let readerEl = null;
    let originalBg = null;
    let bionicObserver = null;
    let bionicTimer = null;
    let focusCurrent = null;
    let rulerHandler = null;
    let focusHandler = null;
    let applied = false;

    if (scopeEl) scopeEl.setAttribute('data-ns-scope', id);

    /* ---- background colour + tint ---- */
    function applyTint() {
      const color = pageColor(settings);
      if (scopeEl) {
        if (originalBg === null) originalBg = scopeEl.style.backgroundColor;
        scopeEl.style.backgroundColor = color || originalBg;
        return;
      }
      if (color) {
        if (!overlayEl) {
          overlayEl = doc.createElement('div');
          overlayEl.id = 'ns-overlay-' + id;
          overlayEl.setAttribute('aria-hidden', 'true');
          overlayEl.setAttribute('data-ns-skip', '');
          overlayEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483640;mix-blend-mode:multiply;';
          host.appendChild(overlayEl);
        }
        overlayEl.style.background = color;
      } else if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
      }
    }

    /* ---- bionic ---- */
    function setBionic(on, intensity) {
      const target = scopeEl || doc.body;
      // the reader overlay is attached to <html> in page mode, so it must be handled explicitly
      const roots = [target];
      if (readerEl && target && !target.contains(readerEl)) roots.push(readerEl);
      // stop observing FIRST: removing the wrappers would otherwise queue them for re-processing
      if (bionicObserver) {
        bionicObserver.disconnect();
        bionicObserver = null;
      }
      if (bionicTimer) {
        win.clearTimeout(bionicTimer);
        bionicTimer = null;
      }
      roots.forEach((r) => r && removeBionic(r));
      if (!on || !target) return;
      const nodes = roots.flatMap((r) => collectTextNodes(r));
      let i = 0;
      (function chunk() {
        if (!settings.bionicReading || settings.bionicIntensity !== intensity) return; // superseded
        const end = Math.min(i + 300, nodes.length);
        for (; i < end; i++) if (nodes[i].parentNode) bionicifyNode(nodes[i], intensity);
        if (i < nodes.length) win.setTimeout(chunk, 0);
      })();
      if (win.MutationObserver) {
        bionicObserver = new win.MutationObserver((records) => {
          if (bionicTimer) return;
          bionicTimer = win.setTimeout(() => {
            bionicTimer = null;
            if (!bionicObserver) return;
            records.forEach((r) =>
              r.addedNodes.forEach((n) => {
                if (n.nodeType === 1 && !n.closest('.ns-bionic-wrap')) bionicifyTextNodes(n, intensity);
                else if (n.nodeType === 3 && n.parentNode && !isSkippable(n)) bionicifyNode(n, intensity);
              })
            );
          }, 400);
        });
        roots.forEach((r) => r && bionicObserver.observe(r, { childList: true, subtree: true }));
      }
    }

    /* ---- ruler ---- */
    function setRuler(on) {
      if (!on) {
        if (rulerEl) rulerEl.remove();
        if (rulerHandler) doc.removeEventListener('pointermove', rulerHandler);
        rulerEl = null;
        rulerHandler = null;
        return;
      }
      if (rulerEl) return;
      rulerEl = doc.createElement('div');
      rulerEl.id = 'ns-ruler';
      rulerEl.setAttribute('aria-hidden', 'true');
      rulerEl.setAttribute('data-ns-skip', '');
      rulerEl.style.cssText =
        'position:fixed;left:0;width:100%;height:46px;pointer-events:none;z-index:2147483646;' +
        'border-top:2px solid #2A9D8F;border-bottom:2px solid #2A9D8F;box-shadow:0 0 0 100vmax rgba(15,23,42,.22);' +
        'transition:top .04s linear;top:40vh;';
      host.appendChild(rulerEl);
      let raf = 0;
      rulerHandler = (e) => {
        if (scopeEl) {
          const r = scopeEl.getBoundingClientRect();
          const inside = e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
          rulerEl.style.display = inside ? '' : 'none';
        }
        if (raf) return;
        raf = win.requestAnimationFrame(() => {
          raf = 0;
          if (rulerEl) rulerEl.style.top = Math.max(0, e.clientY - 23) + 'px';
        });
      };
      doc.addEventListener('pointermove', rulerHandler, { passive: true });
    }

    /* ---- focus mode ---- */
    function setFocus(on) {
      host.classList.toggle('ns-focus-on', on);
      if (!on) {
        if (focusCurrent) focusCurrent.classList.remove('ns-focus-current');
        focusCurrent = null;
        host.classList.remove('ns-focus-active');
        if (focusHandler) doc.removeEventListener('pointermove', focusHandler);
        focusHandler = null;
        return;
      }
      if (focusHandler) return;
      focusHandler = (e) => {
        const t = e.target && e.target.closest ? e.target.closest(FOCUS_BLOCKS) : null;
        if (!t || t === focusCurrent || (scopeEl && !scopeEl.contains(t))) return;
        if (focusCurrent) focusCurrent.classList.remove('ns-focus-current');
        focusCurrent = t;
        t.classList.add('ns-focus-current');
        host.classList.add('ns-focus-active'); // dim the other blocks only once a block has been pointed at
      };
      doc.addEventListener('pointermove', focusHandler, { passive: true });
    }

    /* ---- reader mode ---- */
    function isReaderOpen() {
      return !!readerEl;
    }

    function openReader(openOpts) {
      if (readerEl) return true;
      const target = scopeEl || doc.body;
      const found = extractMainContent(target);
      if (!found || (openOpts && openOpts.minWords && found.words < openOpts.minWords)) {
        if (!openOpts || !openOpts.silent) notice('Reader mode could not find a main article on this page.');
        return false;
      }
      const clone = sanitizeForReader(found.node.cloneNode(true));
      readerEl = doc.createElement('div');
      readerEl.id = 'ns-reader';
      readerEl.setAttribute('role', 'dialog');
      readerEl.setAttribute('aria-label', 'Reader mode');
      readerEl.setAttribute('data-ns-reader', '');
      const dark = false;
      const bg = pageColor(settings) || '#ffffff';
      readerEl.style.cssText =
        `position:${scopeEl ? 'absolute' : 'fixed'};inset:0;overflow:auto;z-index:2147483000;background:${bg};` +
        `color:${settings.contrast === 'high' ? '#000' : '#1E2F36'};font:18px/1.8 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;`;
      const bar = doc.createElement('div');
      bar.style.cssText =
        'position:sticky;top:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 20px;' +
        'background:#264653;color:#fff;font:600 14px system-ui,sans-serif;z-index:1;';
      bar.setAttribute('data-ns-skip', '');
      const label = doc.createElement('span');
      label.textContent = 'NeuroSync Reader Mode';
      const exit = doc.createElement('button');
      exit.type = 'button';
      exit.textContent = 'Exit Reader Mode (Esc)';
      exit.style.cssText =
        'background:#fff;color:#264653;border:0;border-radius:12px;padding:8px 16px;font:600 14px system-ui,sans-serif;cursor:pointer;';
      exit.addEventListener('click', () => closeReader(true));
      bar.append(label, exit);
      const article = doc.createElement('article');
      article.style.cssText = 'max-width:720px;margin:0 auto;padding:32px 20px 80px;';
      const h = doc.createElement('h1');
      h.textContent = found.title;
      h.style.cssText = 'font-size:1.9em;line-height:1.25;margin:0 0 1em;';
      article.appendChild(h);
      // drop a duplicated first heading from the clone
      const firstH1 = clone.querySelector('h1');
      if (firstH1 && firstH1.textContent.trim() === found.title) firstH1.remove();
      article.appendChild(clone);
      article.querySelectorAll('img,video').forEach((m) => (m.style.cssText = 'max-width:100%;height:auto;border-radius:8px;'));
      article.querySelectorAll('p,li').forEach((p) => (p.style.cssText = 'margin:0 0 1.1em;'));
      article.querySelectorAll('a').forEach((a) => (a.style.color = '#1F7A6F'));
      readerEl.append(bar, article);
      if (scopeEl) scopeEl.style.position = scopeEl.style.position || 'relative';
      host.appendChild(readerEl);
      if (!scopeEl) doc.documentElement.setAttribute('data-ns-prev-overflow', doc.documentElement.style.overflow || '');
      if (!scopeEl) doc.documentElement.style.overflow = 'hidden';
      doc.addEventListener('keydown', onReaderKey, true);
      exit.focus();
      if (settings.bionicReading) bionicifyTextNodes(readerEl, settings.bionicIntensity);
      return true;
    }

    function onReaderKey(e) {
      if (e.key === 'Escape' && readerEl) {
        e.stopPropagation();
        closeReader(true);
      }
    }

    function closeReader(userInitiated) {
      if (!readerEl) return;
      readerEl.remove();
      readerEl = null;
      doc.removeEventListener('keydown', onReaderKey, true);
      if (!scopeEl) {
        doc.documentElement.style.overflow = doc.documentElement.getAttribute('data-ns-prev-overflow') || '';
        doc.documentElement.removeAttribute('data-ns-prev-overflow');
      }
      if (userInitiated && opts.onReaderExit) opts.onReaderExit();
    }

    /* ---- text to speech ---- */
    const synth = win.speechSynthesis || null;
    const ttsListeners = new Set();
    const tts = {
      state: synth ? 'idle' : 'unsupported',
      _queue: [],
      _token: 0,
      isSupported: () => !!synth,
      getState() {
        return tts.state;
      },
      onChange(cb) {
        ttsListeners.add(cb);
        return () => ttsListeners.delete(cb);
      },
      _set(state) {
        tts.state = state;
        ttsListeners.forEach((cb) => cb(state));
      },
      play(text, rate) {
        if (!synth) return notice('Text-to-speech is not supported in this browser.');
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return notice('Select some text or open a page with readable content first.');
        tts.stop();
        const token = ++tts._token;
        tts._queue = clean.match(/[^.!?\n]+[.!?]*\s*/g) || [clean];
        tts._queue = tts._queue.flatMap((s) => (s.length > 220 ? s.match(/.{1,200}(\s|$)/g) : [s]));
        const next = () => {
          if (token !== tts._token) return;
          const piece = tts._queue.shift();
          if (!piece) return tts._set('idle');
          const u = new win.SpeechSynthesisUtterance(piece);
          u.rate = Number(rate || settings.speechSpeed || 1);
          u.onend = next;
          u.onerror = (ev) => {
            if (ev.error === 'interrupted' || ev.error === 'canceled') return;
            tts._set('idle');
          };
          synth.speak(u);
        };
        tts._set('playing');
        next();
      },
      pause() {
        if (synth && tts.state === 'playing') {
          synth.pause();
          tts._set('paused');
        }
      },
      resume() {
        if (synth && tts.state === 'paused') {
          synth.resume();
          tts._set('playing');
        }
      },
      stop() {
        if (!synth) return;
        tts._token++;
        tts._queue = [];
        synth.cancel();
        if (tts.state !== 'idle') tts._set('idle');
      },
    };

    function getReadableText() {
      const sel = win.getSelection && win.getSelection().toString().trim();
      if (sel) return sel;
      if (readerEl) return readerEl.querySelector('article').innerText;
      const found = extractMainContent(scopeEl || doc.body);
      const text = found ? found.node.innerText || found.node.textContent : (scopeEl || doc.body).innerText;
      return String(text || '').slice(0, 20000);
    }

    /* ---- apply ---- */
    function apply(next, applyOpts) {
      const prev = settings;
      settings = mergeSettings(null, next);
      if (!scopeEl) host.classList.add('ns-on');
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = 'ns-style-' + id;
        (doc.head || host).appendChild(styleEl);
      }
      styleEl.textContent = buildCss(settings, sc, fontBase);
      applyTint();
      if (!applied || prev.bionicReading !== settings.bionicReading || prev.bionicIntensity !== settings.bionicIntensity) {
        setBionic(settings.bionicReading, settings.bionicIntensity);
      }
      setRuler(settings.readingRuler);
      setFocus(settings.focusMode);
      if (settings.readerMode && !readerEl) {
        openReader(applyOpts && applyOpts.auto ? { minWords: 250, silent: true } : undefined);
      } else if (!settings.readerMode && readerEl) closeReader(false);
      if (!settings.textToSpeech && !(applyOpts && applyOpts.keepTts)) {
        /* TTS stays user-triggered; the flag only controls whether controls are shown */
      }
      applied = true;
      return settings;
    }

    function destroy() {
      tts.stop();
      setBionic(false);
      setRuler(false);
      setFocus(false);
      closeReader(false);
      if (overlayEl) overlayEl.remove();
      if (styleEl) styleEl.remove();
      overlayEl = styleEl = null;
      host.classList.remove('ns-on', 'ns-focus-on', 'ns-focus-active');
      if (scopeEl) {
        scopeEl.style.backgroundColor = originalBg || '';
        scopeEl.removeAttribute('data-ns-scope');
      }
      applied = false;
    }

    return {
      apply,
      destroy,
      getSettings: () => Object.assign({}, settings),
      tts,
      readText: getReadableText,
      reader: { open: openReader, close: () => closeReader(true), isOpen: isReaderOpen },
    };
  }

  return {
    DEFAULT_SETTINGS,
    BACKGROUNDS,
    TINTS,
    pageColor,
    mergeSettings,
    create,
    // exported for unit tests and reuse
    bionicSplitIndex,
    bionicifyTextNodes,
    removeBionic,
    extractMainContent,
    sanitizeForReader,
    buildCss,
  };
});
