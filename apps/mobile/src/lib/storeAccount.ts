import * as SecureStore from 'expo-secure-store';
import { uuid } from './dates';

/**
 * The device's store account — for the development store only. On a real phone the App Store or
 * Google Play account plays this part (it's what "restore purchases" finds); the sandbox store
 * needs a stable id for "this device's store account", so restore works the same way.
 */
const KEY = 'form.devStoreAccount';

export async function storeAccountId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY).catch(() => null);
  if (existing) return existing;
  const id = uuid();
  await SecureStore.setItemAsync(KEY, id).catch(() => undefined);
  return id;
}
