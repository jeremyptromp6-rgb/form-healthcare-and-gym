import { uuid } from './dates';

/** Web: the development store's "store account" for this browser (see storeAccount.ts). */
const KEY = 'form.devStoreAccount';

export async function storeAccountId(): Promise<string> {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = uuid();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage blocked: purchases still work; restore on this browser just won't find them later.
    return uuid();
  }
}
