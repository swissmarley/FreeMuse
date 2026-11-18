import { en } from './en.js';
import { de } from './de.js';
import { fr } from './fr.js';
import { it } from './it.js';
import { es } from './es.js';

export type Strings = typeof en;
export const LANGUAGES = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano', es: 'Español' } as const;
export type Lang = keyof typeof LANGUAGES;
const all: Record<Lang, Partial<Strings>> = { en, de, fr, it, es };

export function strings(lang: string): Strings {
  const l = (lang in all ? lang : 'en') as Lang;
  return { ...en, ...all[l] };
}
