import { ApiError, kindForStatus, request } from './api';
import { apiSettings, resolveApiUrl } from './config';
import { localDateKey, uuid } from './dates';
import { shouldRetry } from './queryClient';

describe('resolveApiUrl', () => {
  it('defaults to the local dev API and strips trailing slashes', () => {
    expect(resolveApiUrl(undefined, true)).toBe('http://localhost:4000');
    expect(resolveApiUrl('https://api.form.fitness/', false)).toBe('https://api.form.fitness');
  });

  it('allows plain http only for local hosts in development', () => {
    expect(resolveApiUrl('http://192.168.1.20:4000', true)).toBe('http://192.168.1.20:4000');
    expect(() => resolveApiUrl('http://api.form.fitness', true)).toThrow(/https/);
    expect(() => resolveApiUrl('http://localhost:4000', false)).toThrow(/https/);
  });

  it('rejects malformed URLs', () => {
    expect(() => resolveApiUrl('not a url', true)).toThrow(/valid URL/);
  });
});

describe('API client', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('maps HTTP statuses to error kinds', () => {
    expect(kindForStatus(401)).toBe('unauthorized');
    expect(kindForStatus(403)).toBe('forbidden');
    expect(kindForStatus(422)).toBe('validation');
    expect(kindForStatus(503)).toBe('unavailable');
    expect(kindForStatus(500)).toBe('server');
  });

  it('turns a failed fetch into a retryable network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request('/x')).rejects.toMatchObject({ kind: 'network', retryable: true });
  });

  it('surfaces the server error envelope, including provider retryability', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: 'provider_unconfigured', message: 'AI coach is not configured', details: { retryable: false } } }),
    });
    const err = await request('/coach').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unavailable', code: 'provider_unconfigured', retryable: false, status: 503 });
  });

  it('sends the bearer token and JSON body, and returns undefined for 204', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = fetchMock;
    await expect(request('/me', { method: 'DELETE', body: { password: 'p' }, token: 'tok' })).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok', 'content-type': 'application/json' });
    expect(init.body).toBe('{"password":"p"}');
  });
});

describe('query retry policy', () => {
  const net = new ApiError('network', 'network', 'x', null, true);
  const bad = new ApiError('validation', 'invalid_request', 'x', 400, false);

  it('retries network and retryable failures at most twice', () => {
    expect(shouldRetry(0, net)).toBe(true);
    expect(shouldRetry(1, net)).toBe(true);
    expect(shouldRetry(2, net)).toBe(false);
  });

  it('never retries validation or auth failures', () => {
    expect(shouldRetry(0, bad)).toBe(false);
    expect(shouldRetry(0, new ApiError('unauthorized', 'unauthorized', 'x', 401, false))).toBe(false);
  });
});

describe('dates', () => {
  it('formats the local calendar date', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('generates RFC 4122 v4 ids', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('apiSettings', () => {
  it('never throws: a build without a safe address gets no URL and a reason instead', () => {
    expect(apiSettings('https://api.form.fitness', false)).toEqual({ apiUrl: 'https://api.form.fitness', apiProblem: null });
    const missing = apiSettings(undefined, false);
    expect(missing.apiUrl).toBeNull();
    expect(missing.apiProblem).toMatch(/https/);
    expect(apiSettings('http://api.form.fitness', false).apiUrl).toBeNull();
  });
});
