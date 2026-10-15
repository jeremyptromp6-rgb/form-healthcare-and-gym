import { networkAdProvider } from './networkProvider';

describe('networkAdProvider (no ads in this build)', () => {
  it('is never available and refuses to load', async () => {
    expect(networkAdProvider.availability()).toEqual({ available: false, reason: 'not_configured' });
    await expect(networkAdProvider.load({ personalized: false, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'not_configured' });
  });
});
