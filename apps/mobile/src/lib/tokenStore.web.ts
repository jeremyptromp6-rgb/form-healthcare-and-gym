// Web: sessionStorage, so the token does not outlive the tab. Storage can be blocked
// (private mode, disabled site data), in which case the user simply signs in again.
const KEY = 'form.session';

export const tokenStore = {
  get: async () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: async (token: string) => {
    try {
      sessionStorage.setItem(KEY, token);
    } catch {}
  },
  clear: async () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  },
};
