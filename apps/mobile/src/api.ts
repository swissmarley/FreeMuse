import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { MuseClient } from '@muse/core/client';

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:4000';
const KEY = 'muse_session';

let cached: string | null | undefined;
export async function getToken(): Promise<string | null> {
  if (cached === undefined) cached = await SecureStore.getItemAsync(KEY);
  return cached;
}
export async function setToken(t: string | null) {
  cached = t;
  if (t) await SecureStore.setItemAsync(KEY, t, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(KEY);
}

/** Mobile authenticates with a bearer token kept in the device keychain/keystore. */
export const api = new MuseClient({ baseUrl: API_URL, getToken, credentials: 'omit', clientName: 'mobile' });
