import { en } from './en';
import { de } from './de';
import { fr } from './fr';
import { it } from './it';
import { es } from './es';

export type Strings = typeof en;
export const LANGUAGES = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano', es: 'Español' } as const;
export type Lang = keyof typeof LANGUAGES;
const all: Record<Lang, Partial<Strings>> = { en, de, fr, it, es };

export function strings(lang: string): Strings {
  const l = (lang in all ? lang : 'en') as Lang;
  return { ...en, ...all[l] };
}
