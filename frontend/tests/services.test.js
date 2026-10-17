import { describe, it, expect, vi, beforeEach } from 'vitest';
import { s } from '../src/utils/css.js';
import { api, tokenStore, AI_DOWN_MESSAGE, ApiError } from '../src/services/api.js';

describe('s() – design inline styles are converted verbatim', () => {
  it('converts kebab-case properties, keeps custom properties and complex values', () => {
    expect(s('display:flex;gap:14px;flex-wrap:wrap')).toEqual({ display: 'flex', gap: '14px', flexWrap: 'wrap' });
    expect(s('background:linear-gradient(135deg,var(--neurosync-dark) 50%,var(--neurosync-teal) 50%);--x:1')).toEqual({ background: 'linear-gradient(135deg,var(--neurosync-dark) 50%,var(--neurosync-teal) 50%)', '--x': '1' });
    expect(s('box-shadow:0 1px 3px rgba(17,24,39,.08),0 8px 24px rgba(17,24,39,.04);')).toEqual({ boxShadow: '0 1px 3px rgba(17,24,39,.08),0 8px 24px rgba(17,24,39,.04)' });
  });
});

const ok = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });

describe('API service', () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it('sends the bearer token and JSON body, never any secret', async () => {
    tokenStore.set('abc.def.ghi');
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ simplified: 'x' }));
    await api.ai.simplify('hello there');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/simplify');
    expect(init.headers.Authorization).toBe('Bearer abc.def.ghi');
    expect(JSON.parse(init.body)).toEqual({ text: 'hello there' });
    expect(JSON.stringify(f.mock.calls)).not.toMatch(/(?:GEMINI|OPENROUTER)_API_KEY|sk-/);
  });

  it('login/signup do not send a stale token', async () => {
    tokenStore.set('stale');
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ token: 't' }));
    await api.login('a@b.co', 'password1');
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('network failure on an AI call gives the specified friendly message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.ai.simplify('some text')).rejects.toMatchObject({ message: AI_DOWN_MESSAGE });
    await expect(api.dashboard()).rejects.toMatchObject({ message: expect.stringContaining("couldn't reach") });
  });

  it('server error messages are shown as-is; validation details are kept', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ error: { code: 'VALIDATION', message: 'Some settings are not valid.', details: ['"fontSize" must be between 14 and 28.'] } }, 400));
    const e = await api.accessibility.update({ fontSize: 99 }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe('Some settings are not valid.');
    expect(e.details).toHaveLength(1);
  });

  it('a 401 on an authenticated call signals the app to sign out', async () => {
    tokenStore.set('expired');
    const listener = vi.fn();
    window.addEventListener('neurosync:unauthorized', listener);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in again to continue.' } }, 401));
    await expect(api.dashboard()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('neurosync:unauthorized', listener);
  });

  it('assessment calls carry the part and the cursor', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({}));
    await api.assessment.questions('core', 3);
    await api.assessment.answer('core', { stepId: 's2', value: 'x' });
    expect(f.mock.calls[0][0]).toContain('/assessment/questions?part=core&cursor=3');
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ part: 'core', stepId: 's2', value: 'x' });
  });
});
