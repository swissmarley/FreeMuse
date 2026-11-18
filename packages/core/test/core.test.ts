import { describe, expect, it } from 'vitest';
import { ageOn, blinkOpenness, buildAvatar, DEFAULT_AVATAR, nextBlinkDelay, personaPrompt, resolveAvatarState, strings, SignupInput } from '../src/index';

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
    for (const state of ['idle', 'wave', 'thinking', 'speaking', 'happy', 'working', 'sleeping'] as const) {
      const m = buildAvatar({ ...DEFAULT_AVATAR, outfit: { ...DEFAULT_AVATAR.outfit, hat: 'beanie', glasses: 'round', scarf: 'knit' } }, { state, t: 1234, sinceBlink: -1, mouth: 0.7 });
      expect(m.shapes.length).toBeGreaterThan(15);
      expect(m.shapes.some((s) => s.key === 'face')).toBe(true);
    }
    const speaking = buildAvatar(DEFAULT_AVATAR, { state: 'speaking', t: 0, sinceBlink: -1, mouth: 0.8 });
    expect(speaking.shapes.some((s) => s.key === 'mouthOpen')).toBe(true);
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
