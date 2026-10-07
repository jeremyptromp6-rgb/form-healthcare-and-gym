import * as SecureStore from 'expo-secure-store';

// Native: the session token lives in the OS keychain / keystore, never in plain storage.
const KEY = 'form.session';

export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token: string) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
