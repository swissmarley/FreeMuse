export const AVATAR_STATES = ['idle', 'wave', 'listening', 'thinking', 'speaking', 'happy', 'working', 'sleeping'] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

/** Short, playful one-off animations layered on top of the current state. */
export const REACTIONS = ['giggle', 'love', 'jump', 'cheer', 'nod', 'curious', 'oops', 'hello'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** How long each reaction plays, in ms. */
export const REACTION_MS: Record<Reaction, number> = {
  giggle: 1300, love: 1700, jump: 950, cheer: 1600, nod: 950, curious: 1500, oops: 1500, hello: 1600,
};

export interface ActiveReaction { kind: Reaction; /** ms since the reaction started */ since: number }

export interface AvatarSignals {
  greeting: boolean;
  thinking: boolean;
  speaking: boolean;
  justCompleted: boolean;
  tasksRunning: number;
  idleMs: number;
  listening?: boolean;
}

/** Priority-ordered resolution of what the avatar should be doing right now. */
export function resolveAvatarState(s: AvatarSignals): AvatarState {
  if (s.listening) return 'listening';
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

/** Pick how the character reacts to a reply it is about to say. */
export function reactionForReply(text: string): Reaction {
  const t = text.slice(0, 400);
  if (/\b(sorry|oops|unfortunately|couldn'?t|can'?t|cannot|failed|error|not able|leider|désolé|lo siento|purtroppo)\b/i.test(t)) return 'oops';
  if (/\b(done|sent|booked|added|saved|scheduled|all set|great news|yay|perfect|congrat\w*|success\w*|fertig|erledigt|fatto|listo|terminé)\b|🎉|✅/i.test(t)) return 'cheer';
  if (/\b(thank\w*|love|sweet|kind of you|danke|merci|grazie|gracias)\b|❤|💛|🥰/i.test(t)) return 'love';
  if (/\?\s*$/.test(t.trim()) || /^(hmm|let me see)/i.test(t)) return 'curious';
  return 'nod';
}

/** Pick how the character reacts to something the user just said. */
export function reactionForUser(text: string): Reaction {
  if (/^\s*(hi|hello|hey|hallo|ciao|salut|hola|bonjour|good (morning|evening|afternoon))\b/i.test(text)) return 'hello';
  if (/\b(thank\w*|love you|you'?re (great|the best|cute|sweet)|danke|merci|grazie|gracias)\b/i.test(text)) return 'love';
  if (/\b(wow|amazing|awesome|whoa|no way)\b/i.test(text)) return 'jump';
  return 'nod';
}

export interface TapReaction { kind: Reaction; say: string }
const TAP_REACTIONS: TapReaction[] = [
  { kind: 'giggle', say: 'Hehe, that tickles!' },
  { kind: 'love', say: 'Aww, hi you! 💛' },
  { kind: 'jump', say: 'Whoa! You surprised me!' },
  { kind: 'hello', say: 'Hi there! 👋' },
  { kind: 'cheer', say: 'Yay! Let’s do something fun!' },
  { kind: 'giggle', say: 'Hihi, stop it!' },
  { kind: 'curious', say: 'Hm? What’s up?' },
];
/** Reaction for tapping/clicking the character; cycles so repeated taps feel varied. */
export function tapReaction(count: number): TapReaction {
  return TAP_REACTIONS[((count % TAP_REACTIONS.length) + TAP_REACTIONS.length) % TAP_REACTIONS.length]!;
}
