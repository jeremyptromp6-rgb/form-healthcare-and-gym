import { ApiError, request } from './api';

describe('request(): response bodies', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.useRealTimers();
  });

  it('retries a request that got no response (a waking server) and succeeds without showing an error', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
    await expect(request('/home', { retryMs: 5000 })).resolves.toEqual({ ok: 1 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up with a plain "check your internet" message once the retry budget is spent', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(request('/home', { retryMs: 0 })).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/internet/i) });
  });

  it('turns a 200 with a body that is not JSON into a friendly server error', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('Unexpected token <')) });
    const err = (await request('/home').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'server', code: 'bad_response', status: 200, retryable: true });
    expect(err.message).toMatch(/unexpected/i);
  });

  it('turns a 200 with a null body into a server error too', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null });
    await expect(request('/home')).rejects.toMatchObject({ kind: 'server', code: 'bad_response' });
  });

  it('still accepts 204 (no content) and ordinary JSON, including falsy values', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    await expect(request('/me/weight/2026-01-01', { method: 'DELETE' })).resolves.toBeUndefined();
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await expect(request('/x')).resolves.toEqual({ ok: true });
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => 0 });
    await expect(request('/x')).resolves.toBe(0);
  });

  it('keeps the error envelope for failures even when the body is not JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new SyntaxError('x')) });
    await expect(request('/x')).rejects.toMatchObject({ kind: 'server', status: 502, message: 'Something went wrong' });
  });

  it('keeps the timeout armed until the body is read: a stalled body becomes a network error', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn().mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          // The body never arrives; it only fails when the request is aborted.
          json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
        }),
    );
    const pending = request('/home', { timeoutMs: 1000 }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(1001);
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'network', retryable: true });
  });
});
