import { describe, expect, it } from 'vitest';
import { fmt, LANGUAGES, strings } from '../src/i18n/index';
import { en } from '../src/i18n/en';
import { BARGE_IN_VAD, chooseTtsEngine, dbToLevel, DEFAULT_VAD, rmsToLevel, Vad } from '../src/voice';
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
  const run = (s: [number, number][], from: number, to: number, level: number | ((t: number) => number)) => {
    for (let t = from; t < to; t += 80) s.push([t, typeof level === 'number' ? level : level(t)]);
  };
  it('maps dB and RMS to the level scale', () => {
    expect(dbToLevel(-55)).toBe(0);
    expect(dbToLevel(-5)).toBe(1);
    expect(dbToLevel(undefined)).toBe(0);
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(0.1)).toBeCloseTo(0.7, 5);
  });
  it('starts after sustained speech and ends after a pause', () => {
    const v = new Vad(DEFAULT_VAD);
    const s: [number, number][] = [];
    run(s, 0, 1000, 0.05);
    run(s, 1000, 2000, 0.7);
    run(s, 2000, 3200, 0.05);
    expect(feed(v, s)).toEqual(['speech-start', 'speech-end']);
  });
  it('ends the turn when the room is noisy (background above the starting threshold)', () => {
    const v = new Vad(DEFAULT_VAD);
    const s: [number, number][] = [];
    run(s, 0, 2000, (t) => (Math.floor(t / 160) % 2 ? 0.75 : 0.6)); // talking
    run(s, 2000, 9000, (t) => (Math.floor(t / 80) % 3 ? 0.42 : 0.5)); // stopped talking, noisy room
    const ev = feed(v, s);
    expect(ev).toEqual(['speech-start', 'speech-end']);
  });
  it('a pause ends the turn even with a little noise left', () => {
    const v = new Vad(DEFAULT_VAD);
    const s: [number, number][] = [];
    run(s, 0, 1500, 0.1);
    run(s, 1500, 4000, (t) => (Math.floor(t / 240) % 4 ? 0.7 : 0.25)); // words with tiny gaps
    run(s, 4000, 5200, (t) => (t % 400 === 0 ? 0.33 : 0.15)); // pause with the odd click
    const ev = feed(v, s);
    expect(ev).toEqual(['speech-start', 'speech-end']);
  });
  it('never lets a turn run forever', () => {
    const v = new Vad({ ...DEFAULT_VAD, maxSpeechMs: 5000 });
    const s: [number, number][] = [];
    run(s, 0, 500, 0.05);
    run(s, 500, 8000, (t) => 0.9 + (Math.floor(t / 80) % 2) * 0.05);
    expect(feed(v, s)[1]).toBe('speech-end');
  });
  it('ignores clicks and short blips', () => {
    const v = new Vad(DEFAULT_VAD);
    const s: [number, number][] = [[0, 0.05], [80, 0.9], [160, 0.05]];
    run(s, 240, 2000, 0.05);
    expect(feed(v, s)).toEqual([]);
  });
  it('barge-in needs a louder voice', () => {
    const v = new Vad(BARGE_IN_VAD);
    const s: [number, number][] = [];
    run(s, 0, 1000, 0.05);
    run(s, 1000, 3000, 0.38); // the assistant's own voice leaking in
    expect(feed(v, s)).toEqual([]);
  });
});
