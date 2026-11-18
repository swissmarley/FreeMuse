import { en } from './en';
import { de } from './de';
import { fr } from './fr';
import { it } from './it';
import { es } from './es';
import type { Strings } from './types';

export type { Strings } from './types';
/** English is the default; the others are complete translations. */
export const LANGUAGES = { en: 'English', it: 'Italiano', de: 'Deutsch', fr: 'Français', es: 'Español' } as const;
export type Lang = keyof typeof LANGUAGES;
export const DEFAULT_LANG: Lang = 'en';
const all: Record<Lang, Strings> = { en, de, fr, it, es };

export function isLang(lang: unknown): lang is Lang {
  return typeof lang === 'string' && lang in all;
}

export function strings(lang: string | undefined | null): Strings {
  return all[isLang(lang) ? lang : DEFAULT_LANG];
}

/** Fill {placeholders}. */
export function fmt(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

/** BCP-47 locale for speech engines and date formatting. */
export const SPEECH_LOCALE: Record<Lang, string> = { en: 'en-US', it: 'it-IT', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' };
export function speechLocale(lang: string): string {
  return SPEECH_LOCALE[isLang(lang) ? lang : DEFAULT_LANG];
}
