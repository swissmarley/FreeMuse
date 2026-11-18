import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { MuseClient } from '@muse/core/client';

/** Build-time default; release builds let the user enter their own server address (stored on the device). */
export const DEFAULT_API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:4000';
const KEY = 'muse_session';
const SERVER_KEY = 'muse_server';
const LANG_KEY = 'muse_lang';

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
export const api = new MuseClient({ baseUrl: DEFAULT_API_URL, getToken, credentials: 'omit', clientName: 'mobile' });

/** Normalise what people type: "192.168.1.20:4000" → "http://192.168.1.20:4000". */
export function normaliseServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

/** Load the saved server address (call once at startup, before any request). */
export async function loadServerUrl(): Promise<string> {
  const saved = await SecureStore.getItemAsync(SERVER_KEY).catch(() => null);
  if (saved) api.setBaseUrl(saved);
  return api.baseUrl;
}

/** Check the address answers like a Free Muse API, then remember it. */
export async function setServerUrl(input: string): Promise<string> {
  const url = normaliseServerUrl(input);
  const r = await fetch(`${url}/health`).catch(() => null);
  if (!r || !r.ok) throw new Error(`No Free Muse server answered at ${url}`);
  api.setBaseUrl(url);
  await SecureStore.setItemAsync(SERVER_KEY, url);
  return url;
}

/** Language picked before signing in (English by default). */
export async function getSavedLang(): Promise<string | null> { return SecureStore.getItemAsync(LANG_KEY).catch(() => null); }
export async function saveLang(l: string) { await SecureStore.setItemAsync(LANG_KEY, l).catch(() => {}); }
