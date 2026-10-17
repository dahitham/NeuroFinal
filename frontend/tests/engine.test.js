import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@ext/neurosync-selection.js';
import { Engine as E } from '../src/accessibilityEngine.js';
import { DEFAULT_SETTINGS as BACKEND_DEFAULTS, SETTING_RULES, LEVEL_SETTINGS } from '../../backend/src/data/settingsSchema.js';

const S = globalThis.NeuroSyncSelection;

const page = () => {
  document.head.innerHTML = '';
  document.documentElement.className = '';
  document.body.innerHTML = `
    <nav><a href="/">Home</a></nav>
    <article>
      <h1>The Article Title</h1>
      <p>Reading online can be tiring when the text is dense and crowded together on the screen.</p>
      <p>Good typography helps. <a href="/more">Read more here</a> and <strong>stay focused</strong>.</p>
      <p>A third paragraph with enough characters to count as real article content for the extractor.</p>
      <img src="/pic.png" alt="a picture" />
      <pre>const keep = "code untouched";</pre>
      <textarea>user typed words</textarea>
      <script>var x = "script text";</script>
    </article>
    <form id="pay"><label>Card holder name</label><input type="password" name="pw" /><span id="sens">sensitive form text</span></form>
    <aside><p>Sidebar advert text that should not appear in reader mode view.</p></aside>`;
};
beforeEach(page);

describe('settings schema is shared with the backend', () => {
  it('engine defaults have exactly the backend keys and values', () => {
    expect(Object.keys(E.DEFAULT_SETTINGS).sort()).toEqual(Object.keys(BACKEND_DEFAULTS).sort());
    expect({ ...E.DEFAULT_SETTINGS }).toEqual({ ...BACKEND_DEFAULTS });
    expect(Object.keys(SETTING_RULES).sort()).toEqual(Object.keys(BACKEND_DEFAULTS).sort());
  });
  it('every enum value the backend accepts is understood by the engine', () => {
    for (const lvl of [1, 2, 3]) {
      const ctl = E.create();
      expect(() => ctl.apply({ ...LEVEL_SETTINGS[lvl] })).not.toThrow();
      ctl.destroy();
    }
    for (const font of SETTING_RULES.font.values) expect(() => E.buildCss({ ...E.DEFAULT_SETTINGS, font }, 'html.ns-on', '/f/')).not.toThrow();
  });
});

describe('bionic reading', () => {
  it('splits words by intensity', () => {
    expect([E.bionicSplitIndex(1, 'normal'), E.bionicSplitIndex(4, 'normal'), E.bionicSplitIndex(10, 'light'), E.bionicSplitIndex(2, 'light')]).toEqual([0, 2, 3, 1]);
  });
  it('bolds word starts, preserving text, links and structure', () => {
    const before = document.querySelector('article').textContent;
    expect(E.bionicifyTextNodes(document.querySelector('article'), 'normal')).toBeGreaterThan(3);
    expect(document.querySelector('article').textContent).toBe(before);
    expect(document.querySelector('a[href="/more"]')).not.toBeNull();
    expect(document.querySelector('img')).not.toBeNull();
    expect(document.querySelector('h1 .ns-b')).not.toBeNull();
  });
  it('never touches script, style, input, textarea, code, pre or sensitive forms', () => {
    E.bionicifyTextNodes(document.body, 'normal');
    expect(document.querySelector('pre').innerHTML).toBe('const keep = "code untouched";');
    expect(document.querySelector('textarea').innerHTML).toBe('user typed words');
    expect(document.querySelector('script').innerHTML).toBe('var x = "script text";');
    expect(document.querySelector('#sens').innerHTML).toBe('sensitive form text');
  });
  it('turning bionic off removes every span and nothing re-applies it later (observer race)', async () => {
    const ctl = E.create();
    ctl.apply({ ...E.DEFAULT_SETTINGS, bionicReading: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelectorAll('.ns-b').length).toBeGreaterThan(5);
    ctl.apply({ ...E.DEFAULT_SETTINGS, bionicReading: false });
    await new Promise((r) => setTimeout(r, 700)); // longer than the observer debounce
    expect(document.querySelectorAll('.ns-b').length).toBe(0);
    expect(document.querySelectorAll('.ns-bionic-wrap').length).toBe(0);
    ctl.destroy();
  });
  it('also covers (and fully removes bionic from) the reader overlay, which lives outside <body>', async () => {
    const ctl = E.create();
    ctl.apply({ ...E.DEFAULT_SETTINGS, bionicReading: true, readerMode: true });
    await new Promise((r) => setTimeout(r, 50));
    const reader = document.getElementById('ns-reader');
    expect(reader).not.toBeNull();
    expect(reader.parentElement).toBe(document.documentElement);
    expect(reader.querySelectorAll('.ns-b').length).toBeGreaterThan(5);
    ctl.apply({ ...E.DEFAULT_SETTINGS, bionicReading: false, readerMode: true });
    await new Promise((r) => setTimeout(r, 700));
    expect(document.querySelectorAll('.ns-b, .ns-bionic-wrap').length).toBe(0);
    ctl.apply({ ...E.DEFAULT_SETTINGS, bionicReading: true, readerMode: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.getElementById('ns-reader').querySelectorAll('.ns-b').length).toBeGreaterThan(5);
    ctl.destroy();
  });
  it('is fully reversible', () => {
    const html = document.body.innerHTML;
    E.bionicifyTextNodes(document.body, 'light');
    E.removeBionic(document.body);
    expect(document.body.innerHTML).toBe(html);
  });
});

describe('fonts, spacing, size, colour and contrast', () => {
  it('Lexend, Atkinson and OpenDyslexic each load their bundled font files', () => {
    const css = (font) => E.buildCss({ ...E.DEFAULT_SETTINGS, font }, 'html.ns-on', '/fonts/');
    expect(css('lexend')).toContain('lexend-latin-400-normal.woff2');
    expect(css('atkinson')).toContain('atkinson-hyperlegible-latin-700-normal.woff2');
    expect(css('atkinson')).toContain('font-family:"NS Atkinson"');
    expect(css('opendyslexic')).toContain('OpenDyslexic-Regular.woff');
  });
  it('slider units: letter ×0.01em, word ×0.03em, size and line only when changed from the neutral default', () => {
    const css = E.buildCss({ ...E.DEFAULT_SETTINGS, fontSize: 20, lineSpacing: 2, letterSpacing: 4, wordSpacing: 3 }, 'html.ns-on', '/f/');
    expect(css).toContain('font-size:20px');
    expect(css).toContain('line-height:2');
    expect(css).toContain('letter-spacing:0.04em');
    expect(css).toContain('word-spacing:0.09em');
    expect(E.buildCss(E.DEFAULT_SETTINGS, 'html.ns-on', '/f/')).not.toMatch(/font-family|font-size|letter-spacing|word-spacing|line-height/);
  });
  it('background × tint produce one page colour; plain white leaves the page alone', () => {
    expect(E.pageColor({ background: 'white', colorTint: 'none' })).toBeNull();
    expect(E.pageColor({ background: 'cream', colorTint: 'none' })).toBe('#fcf6e3');
    const both = E.pageColor({ background: 'cream', colorTint: 'blue' });
    expect(both).not.toBe('#fcf6e3');
    expect(both).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('high contrast darkens text', () => {
    expect(E.buildCss({ ...E.DEFAULT_SETTINGS, contrast: 'high' }, 'html.ns-on', '/f/')).toContain('color:#000');
  });
  it('applies to the page, then removes everything on destroy; the overlay never blocks clicks', () => {
    const ctl = E.create({ fontBase: '/fonts/' });
    ctl.apply({ ...E.DEFAULT_SETTINGS, font: 'lexend', letterSpacing: 5, background: 'cream', colorTint: 'yellow', bionicReading: true });
    expect(document.documentElement.classList.contains('ns-on')).toBe(true);
    expect(document.querySelector('style[id^="ns-style"]').textContent).toContain('NS Lexend');
    expect(document.querySelector('[id^="ns-overlay"]').style.pointerEvents).toBe('none');
    ctl.destroy();
    expect(document.querySelector('style[id^="ns-style"]')).toBeNull();
    expect(document.querySelector('[id^="ns-overlay"]')).toBeNull();
    expect(document.documentElement.classList.contains('ns-on')).toBe(false);
  });
  it('scoped controllers only touch their own element', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="demo"><p>Preview paragraph with a few words in it.</p></div>');
    const demo = document.getElementById('demo');
    const ctl = E.create({ scope: demo });
    ctl.apply({ ...E.DEFAULT_SETTINGS, font: 'lexend', background: 'cream' });
    expect(document.documentElement.classList.contains('ns-on')).toBe(false);
    expect(demo.style.backgroundColor).not.toBe('');
    ctl.destroy();
    expect(demo.style.backgroundColor).toBe('');
  });
});

describe('reading ruler and focus mode', () => {
  it('ruler is click-through and can be toggled off', () => {
    const ctl = E.create();
    ctl.apply({ ...E.DEFAULT_SETTINGS, readingRuler: true });
    expect(document.getElementById('ns-ruler').style.pointerEvents).toBe('none');
    ctl.apply({ ...E.DEFAULT_SETTINGS, readingRuler: false });
    expect(document.getElementById('ns-ruler')).toBeNull();
    ctl.destroy();
  });
  it('focus mode dims nothing until a block is pointed at, then highlights that block', () => {
    const ctl = E.create();
    ctl.apply({ ...E.DEFAULT_SETTINGS, focusMode: true });
    expect(document.documentElement.classList.contains('ns-focus-active')).toBe(false);
    const p = document.querySelector('article p');
    p.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(p.classList.contains('ns-focus-current')).toBe(true);
    expect(document.documentElement.classList.contains('ns-focus-active')).toBe(true);
    ctl.apply({ ...E.DEFAULT_SETTINGS, focusMode: false });
    expect(document.querySelector('.ns-focus-current')).toBeNull();
    expect(document.documentElement.classList.contains('ns-focus-active')).toBe(false);
    ctl.destroy();
  });
});

describe('reader mode', () => {
  it('extracts the article, keeps headings/links/images, drops sidebar & scripts, leaves the page intact, and exits', () => {
    const exits = vi.fn();
    const ctl = E.create({ onReaderExit: exits });
    const before = document.querySelector('article').outerHTML;
    expect(ctl.reader.open()).toBe(true);
    const reader = document.getElementById('ns-reader');
    expect(reader.querySelectorAll('h1').length).toBe(1);
    expect(reader.querySelector('a[href="/more"]')).not.toBeNull();
    expect(reader.querySelector('img[src="/pic.png"]')).not.toBeNull();
    expect(reader.textContent).not.toContain('Sidebar advert');
    expect(reader.querySelector('script')).toBeNull();
    expect(document.querySelector('body > article').outerHTML).toBe(before);
    [...reader.querySelectorAll('button')].find((b) => /Exit/.test(b.textContent)).click();
    expect(document.getElementById('ns-reader')).toBeNull();
    expect(exits).toHaveBeenCalledTimes(1);
    ctl.destroy();
  });
  it('works when the scope element itself holds the paragraphs (Reading Studio preview)', () => {
    document.body.innerHTML = '<div id="box"><p>Good reading support should feel quiet and steady, with plenty of calm space.</p></div>';
    const ctl = E.create({ scope: document.getElementById('box') });
    expect(ctl.reader.open()).toBe(true);
    expect(document.querySelector('#box #ns-reader')).not.toBeNull();
    ctl.destroy();
  });
  it('Escape exits; the settings flag opens it; clones lose inline handlers and javascript: links', () => {
    const ctl = E.create();
    ctl.apply({ ...E.DEFAULT_SETTINGS, readerMode: true });
    expect(ctl.reader.isOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ctl.reader.isOpen()).toBe(false);
    document.querySelector('article').insertAdjacentHTML('beforeend', '<p onclick="alert(1)">x <a href="javascript:alert(1)">bad</a></p>');
    expect(E.sanitizeForReader(document.querySelector('article').cloneNode(true)).innerHTML).not.toMatch(/onclick|javascript:/);
    ctl.destroy();
  });
  it('tells the user when no article is found', () => {
    document.body.innerHTML = '<div><p>Hi</p></div>';
    const notice = vi.fn();
    expect(E.create({ onNotice: notice }).reader.open()).toBe(false);
    expect(notice).toHaveBeenCalled();
  });
});

describe('text to speech', () => {
  it('plays, pauses, resumes, stops with the speechSpeed setting; handles missing support', () => {
    const spoken = [];
    window.speechSynthesis = { speak: vi.fn((u) => spoken.push(u)), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    const ctl = E.create();
    ctl.apply({ ...E.DEFAULT_SETTINGS, speechSpeed: 1.5 });
    ctl.tts.play('First sentence. Second sentence.');
    expect(spoken[0].rate).toBe(1.5);
    expect(ctl.tts.getState()).toBe('playing');
    ctl.tts.pause(); expect(ctl.tts.getState()).toBe('paused');
    ctl.tts.resume(); expect(ctl.tts.getState()).toBe('playing');
    spoken[0].onend();
    expect(spoken[1].text).toMatch(/Second sentence/);
    ctl.tts.stop();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    delete window.speechSynthesis;
    expect(E.create().tts.isSupported()).toBe(false);
  });
});

describe('local-first word assistance (browser side)', () => {
  const local = { glad: { simpleMeaning: 'Means about the same as “Happy”.', synonym: 'Happy' } };
  it('answers from the local vocabulary without calling the AI; unknown words call it once and are cached', async () => {
    const remote = vi.fn(async (w) => ({ simpleMeaning: `meaning of ${w}` }));
    const a = S.createWordAssistant({ lookupLocal: (w) => local[w], requestRemote: remote, debounceMs: 5 });
    expect((await a.assist('Glad.')).source).toBe('local');
    expect(remote).not.toHaveBeenCalled();
    expect((await a.assist('zephyr')).source).toBe('ai');
    await a.assist('zephyr');
    expect(remote).toHaveBeenCalledTimes(1);
  });
  it('de-duplicates concurrent requests and debounces rapid different words', async () => {
    const remote = vi.fn(async (w) => ({ simpleMeaning: w }));
    const a = S.createWordAssistant({ lookupLocal: () => null, requestRemote: remote, debounceMs: 20 });
    const [x, y] = await Promise.all([a.assist('alpha'), a.assist('alpha')]);
    expect(x).toBe(y);
    const first = a.assist('beta').catch((e) => e);
    const second = a.assist('gamma');
    expect((await first).superseded).toBe(true);
    expect((await second).simpleMeaning).toBe('gamma');
    expect(remote).toHaveBeenCalledTimes(2);
  });
});

describe('selection toolbar', () => {
  const select = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  };
  it('sends only the selected text, only after a click', async () => {
    document.body.innerHTML = '<p id="t">Some interesting selected sentence for simplification.</p>';
    const request = vi.fn(async () => ({ simplified: 'Easy.' }));
    const inst = S.init({ request, lookupLocal: () => null });
    select(document.getElementById('t'));
    await new Promise((r) => setTimeout(r, 200));
    expect(request).not.toHaveBeenCalled();
    const root = document.getElementById('neurosync-selection-host').shadowRoot;
    expect([...root.querySelectorAll('.bar button')].map((b) => b.textContent)).toEqual(['Simplify', 'Summarize', 'Explain Word', 'Listen']);
    root.querySelectorAll('.bar button')[0].click();
    await new Promise((r) => setTimeout(r, 20));
    expect(request).toHaveBeenCalledWith('simplify', { text: 'Some interesting selected sentence for simplification.' });
    expect(root.querySelector('.panel').textContent).toContain('Easy.');
    inst.destroy();
  });
  it('shows the friendly fallback message when AI fails', async () => {
    document.body.innerHTML = '<p id="t">Another selected sentence that fails.</p>';
    const inst = S.init({ request: async () => { throw new Error('boom'); }, lookupLocal: () => null });
    select(document.getElementById('t'));
    await new Promise((r) => setTimeout(r, 200));
    const root = document.getElementById('neurosync-selection-host').shadowRoot;
    root.querySelectorAll('.bar button')[1].click();
    await new Promise((r) => setTimeout(r, 20));
    expect(root.querySelector('.panel .err').textContent).toBe('AI assistance is temporarily unavailable. Your local accessibility tools are still available.');
    inst.destroy();
  });
});
