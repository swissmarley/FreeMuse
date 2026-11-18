import { describe, expect, it } from 'vitest';
import { fmt, LANGUAGES, strings } from '../src/i18n/index';
import { en } from '../src/i18n/en';
import { BARGE_IN_VAD, chooseTtsEngine, DEFAULT_VAD, Vad } from '../src/voice';
import { DEFAULT_SETTINGS, SignupInput } from '../src/schemas';

describe('i18n', () => {
  it('English is the default and every language translates every key', () => {
    expect(strings(undefined).send).toBe('Send');
    expect(strings('xx').send).toBe('Send');
    expect(DEFAULT_SETTINGS.language).toBe('en');
    for (const lang of Object.keys(LANGUAGES)) {
      const t = strings(lang);
      for (const k of Object.keys(en)) expect(typeof (t as Record<string, string>)[k], `${lang}.${k}`).toBe('string');
    }
  });
  it('has real translations and keeps placeholders', () => {
    expect(strings('it').send).toBe('Invia');
    expect(strings('de').endCall).toBe('Auflegen');
    for (const lang of ['it', 'de', 'fr', 'es']) {
      const t = strings(lang) as Record<string, string>;
      for (const [k, v] of Object.entries(en)) {
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
        expect(ph(t[k]!), `${lang}.${k}`).toBe(ph(v));
      }
    }
    expect(fmt('Hi {name}, {count}', { name: 'Jolly', count: 2 })).toBe('Hi Jolly, 2');
  });
  it('signup accepts a language', () => {
    expect(SignupInput.safeParse({ email: 'a@b.co', password: 'x'.repeat(10), birthDate: '1990-01-01', acceptTerms: true, language: 'it' }).success).toBe(true);
    expect(SignupInput.safeParse({ email: 'a@b.co', password: 'x'.repeat(10), birthDate: '1990-01-01', acceptTerms: true, language: 'xx' }).success).toBe(false);
  });
  it('contributor mode is off by default', () => {
    expect(DEFAULT_SETTINGS.contributorMode).toBe(false);
    expect(DEFAULT_SETTINGS.trainingOptOut).toBe(true);
  });
});

describe('tts engine choice', () => {
  it('prefers ElevenLabs when configured, natural only for English', () => {
    expect(chooseTtsEngine('auto', 'it', { elevenlabs: true, natural: true })).toBe('elevenlabs');
    expect(chooseTtsEngine('auto', 'it', { elevenlabs: false, natural: true })).toBe('device');
    expect(chooseTtsEngine('auto', 'en', { elevenlabs: false, natural: true })).toBe('natural');
    expect(chooseTtsEngine('device', 'en', { elevenlabs: true, natural: true })).toBe('device');
    expect(chooseTtsEngine('elevenlabs', 'de', { elevenlabs: false, natural: true })).toBe('device');
    expect(chooseTtsEngine('server', 'en', { elevenlabs: true, natural: false })).toBe('elevenlabs');
  });
});

describe('vad', () => {
  const feed = (v: Vad, samples: [number, number][]) => samples.map(([t, l]) => v.push(l, t)).filter(Boolean);
  it('starts after sustained speech and ends after a pause', () => {
    const v = new Vad(DEFAULT_VAD);
    const s: [number, number][] = [];
    for (let t = 0; t < 1000; t += 40) s.push([t, 0.01]);
    for (let t = 1000; t < 2000; t += 40) s.push([t, 0.3]);
    for (let t = 2000; t < 3200; t += 40) s.push([t, 0.01]);
    expect(feed(v, s)).toEqual(['speech-start', 'speech-end']);
  });
  it('ignores clicks and short blips', () => {
    const v = new Vad(DEFAULT_VAD);
    const s: [number, number][] = [[0, 0.01], [40, 0.5], [80, 0.01], [120, 0.01]];
    for (let t = 160; t < 2000; t += 40) s.push([t, 0.01]);
    expect(feed(v, s)).toEqual([]);
  });
  it('barge-in needs a louder voice', () => {
    const v = new Vad(BARGE_IN_VAD);
    const s: [number, number][] = [];
    for (let t = 0; t < 1000; t += 40) s.push([t, 0.08]);
    expect(feed(v, s)).toEqual([]);
  });
});
