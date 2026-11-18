import { describe, expect, it } from 'vitest';
import {
  ageOn, AVATAR_STATES, blinkOpenness, buildAvatar, DEFAULT_AVATAR, naturalPlayback, nextBlinkDelay, normalizeVoicePref, personaPrompt, pickDeviceVoice, rankDeviceVoices,
  REACTION_MS, REACTIONS, reactionForReply, reactionForUser, resolveAvatarState, speakableText, splitForSpeech, strings, SignupInput, tapReaction,
} from '../src/index';

describe('age gate', () => {
  it('computes age with birthday boundary', () => {
    const today = new Date('2026-11-18T12:00:00Z');
    expect(ageOn('2008-11-18', today)).toBe(18);
    expect(ageOn('2008-11-19', today)).toBe(17);
  });
  it('validates signup input', () => {
    expect(SignupInput.safeParse({ email: 'a@b.co', password: 'x'.repeat(10), birthDate: '2000-01-01', acceptTerms: true }).success).toBe(true);
    expect(SignupInput.safeParse({ email: 'nope', password: 'x', birthDate: '2000-01-01', acceptTerms: true }).success).toBe(false);
  });
});

describe('avatar', () => {
  it('blinks every 3-6s', () => {
    for (let i = 0; i < 50; i++) {
      const d = nextBlinkDelay();
      expect(d).toBeGreaterThanOrEqual(3000);
      expect(d).toBeLessThan(6000);
    }
    expect(blinkOpenness(80)).toBeCloseTo(0);
    expect(blinkOpenness(-1)).toBe(1);
  });
  it('resolves state by priority', () => {
    const base = { greeting: false, thinking: false, speaking: false, justCompleted: false, tasksRunning: 0, idleMs: 0 };
    expect(resolveAvatarState({ ...base, speaking: true, thinking: true })).toBe('speaking');
    expect(resolveAvatarState({ ...base, tasksRunning: 2 })).toBe('working');
    expect(resolveAvatarState({ ...base, idleMs: 10 * 60_000 })).toBe('sleeping');
    expect(resolveAvatarState(base)).toBe('idle');
  });
  it('builds every state with outfits', () => {
    for (const state of AVATAR_STATES) {
      const m = buildAvatar({ ...DEFAULT_AVATAR, outfit: { ...DEFAULT_AVATAR.outfit, hat: 'beanie', glasses: 'round', scarf: 'knit' } }, { state, t: 1234, sinceBlink: -1, mouth: 0.7 });
      expect(m.shapes.length).toBeGreaterThan(15);
      expect(m.shapes.some((s) => s.key === 'face')).toBe(true);
    }
    const speaking = buildAvatar(DEFAULT_AVATAR, { state: 'speaking', t: 0, sinceBlink: -1, mouth: 0.8 });
    expect(speaking.shapes.some((s) => s.key === 'mouthOpen')).toBe(true);
  });
  it('listens with perked ears and plays every reaction', () => {
    const base = { ...DEFAULT_AVATAR, outfit: { ...DEFAULT_AVATAR.outfit, hat: 'party' as const } };
    expect(resolveAvatarState({ greeting: false, thinking: true, speaking: true, justCompleted: false, tasksRunning: 0, idleMs: 0, listening: true })).toBe('listening');
    const listening = buildAvatar(base, { state: 'listening', t: 500, sinceBlink: -1, mouth: 0, level: 0.9 });
    expect(listening.shapes.some((s) => s.key === 'mouthListen')).toBe(true);
    expect(listening.shapes.some((s) => s.key.startsWith('wave'))).toBe(true);
    for (const kind of REACTIONS) {
      const mid = buildAvatar(base, { state: 'idle', t: 0, sinceBlink: -1, mouth: 0, reaction: { kind, since: REACTION_MS[kind] / 3 } });
      const after = buildAvatar(base, { state: 'idle', t: 0, sinceBlink: -1, mouth: 0, reaction: { kind, since: REACTION_MS[kind] + 1 } });
      expect(JSON.stringify(mid)).not.toBe(JSON.stringify(after)); // visibly animates, then ends
      expect(mid.shapes.find((s) => s.key === 'face')?.transform).toBeDefined(); // head moves as a unit
    }
    const love = buildAvatar(base, { state: 'idle', t: 0, sinceBlink: -1, mouth: 0, reaction: { kind: 'love', since: 600 } });
    expect(love.shapes.some((s) => s.key.startsWith('heart'))).toBe(true);
    // Reduced motion: no reaction effects.
    const calm = buildAvatar(base, { state: 'idle', t: 0, sinceBlink: -1, mouth: 0, reducedMotion: true, reaction: { kind: 'love', since: 600 } });
    expect(calm.shapes.some((s) => s.key.startsWith('heart'))).toBe(false);
  });
  it('picks fitting reactions', () => {
    expect(reactionForReply('Done! The email was sent 🎉')).toBe('cheer');
    expect(reactionForReply("Sorry, I couldn't find that.")).toBe('oops');
    expect(reactionForReply('Which day works for you?')).toBe('curious');
    expect(reactionForReply('Thank you, that is so kind!')).toBe('love');
    expect(reactionForUser('hey there')).toBe('hello');
    expect(reactionForUser('thanks a lot')).toBe('love');
    expect(tapReaction(0).kind).toBe('giggle');
    expect(tapReaction(-1).say).toBeTruthy();
  });
  it('turns personality into prompt text', () => {
    const p = personaPrompt({ ...DEFAULT_AVATAR, name: 'Pip', persona: 'Loves puns' });
    expect(p).toContain('Pip');
    expect(p).toContain('Loves puns');
  });
});

describe('i18n', () => {
  it('falls back to English', () => {
    expect(strings('de').send).toBe('Senden');
    expect(strings('fr').holdToTalk).toBe('Hold to talk');
    expect(strings('xx').send).toBe('Send');
  });
});

describe('voice', () => {
  it('upgrades old robotic defaults to automatic natural voice', () => {
    expect(normalizeVoicePref({ provider: 'device', voiceId: '', rate: 1, pitch: 1 } as never).provider).toBe('auto');
    expect(normalizeVoicePref({ provider: 'device', voiceId: 'com.apple.Samantha', rate: 1, pitch: 1 } as never).provider).toBe('device');
    expect(normalizeVoicePref(undefined).naturalVoice).toBe('af_heart');
  });
  it('cleans text and splits it into short speakable chunks', () => {
    expect(speakableText('**Hi** there 👋! See [the docs](https://x.y) or https://a.b/c')).toBe('Hi there! See the docs or a link');
    const chunks = splitForSpeech('First sentence here. ' + 'Second one is a bit longer and keeps going. '.repeat(10));
    expect(chunks[0]!.length).toBeLessThanOrEqual(120);
    expect(chunks.every((c) => c.length <= 220)).toBe(true);
    expect(chunks.join(' ')).toContain('First sentence here.');
    expect(splitForSpeech('🎉🎉')).toEqual([]);
  });
  it('keeps the speaking speed when raising pitch', () => {
    const { synthSpeed, playbackRate } = naturalPlayback(1, 1.1);
    expect(synthSpeed * playbackRate).toBeCloseTo(1);
    expect(naturalPlayback(1, 3).playbackRate).toBe(1.25);
  });
  it('ranks natural device voices above robotic ones', () => {
    const voices = [
      { id: 'espeak-en', name: 'eSpeak English', lang: 'en-US' },
      { id: 'zarvox', name: 'Zarvox', lang: 'en-US' },
      { id: 'samantha', name: 'Samantha', lang: 'en-US' },
      { id: 'aria', name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false },
      { id: 'anna', name: 'Anna', lang: 'de-DE' },
    ];
    const ranked = rankDeviceVoices(voices, 'en-US');
    expect(ranked[0]!.id).toBe('aria');
    expect(ranked.map((v) => v.id)).not.toContain('zarvox');
    expect(ranked.at(-1)!.id).toBe('espeak-en');
    expect(pickDeviceVoice(voices, 'de')!.id).toBe('anna');
    expect(pickDeviceVoice(voices, 'en', 'samantha')!.id).toBe('samantha');
  });
});
