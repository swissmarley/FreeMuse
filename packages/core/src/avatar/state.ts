export const AVATAR_STATES = ['idle', 'wave', 'thinking', 'speaking', 'happy', 'working', 'sleeping'] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

export interface AvatarSignals {
  greeting: boolean;
  thinking: boolean;
  speaking: boolean;
  justCompleted: boolean;
  tasksRunning: number;
  idleMs: number;
}

/** Priority-ordered resolution of what the avatar should be doing right now. */
export function resolveAvatarState(s: AvatarSignals): AvatarState {
  if (s.speaking) return 'speaking';
  if (s.greeting) return 'wave';
  if (s.thinking) return 'thinking';
  if (s.justCompleted) return 'happy';
  if (s.tasksRunning > 0) return 'working';
  if (s.idleMs > 5 * 60_000) return 'sleeping';
  return 'idle';
}

/** Random blink interval between 3 and 6 seconds. */
export function nextBlinkDelay(rand: () => number = Math.random): number {
  return 3000 + Math.floor(rand() * 3000);
}

export const BLINK_MS = 160;

/** Eye openness (0 closed .. 1 open) for a blink that started `sinceBlink` ms ago. */
export function blinkOpenness(sinceBlink: number): number {
  if (sinceBlink < 0 || sinceBlink > BLINK_MS) return 1;
  const half = BLINK_MS / 2;
  return Math.abs(sinceBlink - half) / half;
}
