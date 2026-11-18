/**
 * Avatar configuration. The default name is an editable constant.
 * The built-in artwork is an original stylised plush character drawn as vectors (see geometry.ts).
 * To use your own artwork, put files in /assets/avatar and set AVATAR_ASSET (an image or .riv path);
 * renderers fall back to the vector character when the asset is missing.
 */
export const DEFAULT_AVATAR_NAME = 'Jolly';

export const AVATAR_ASSET: { kind: 'vector' } | { kind: 'image'; path: string } = { kind: 'vector' };

export const HATS = ['none', 'beanie', 'sunhat', 'party', 'beret'] as const;
export const GLASSES = ['none', 'round', 'star', 'shades'] as const;
export const SCARVES = ['none', 'knit', 'bandana'] as const;
export type Hat = (typeof HATS)[number];
export type Glasses = (typeof GLASSES)[number];
export type Scarf = (typeof SCARVES)[number];

export interface Outfit {
  hat: Hat;
  hatColor: string;
  glasses: Glasses;
  scarf: Scarf;
  scarfColor: string;
  /** Hoodie colour (the hood shell). Defaults to cream. */
  hoodieColor: string;
  /** Tint mixed into the fur; '' = natural cream. */
  furTint: string;
}

export interface Personality {
  warmth: number; // 0..100
  playfulness: number;
  verbosity: number;
  proactivity: number;
  formality: number;
}

export interface VoicePref {
  provider: 'device' | 'server';
  voiceId: string; // '' = system default
  rate: number; // 0.5..2
  pitch: number; // 0.5..2
}

export interface AvatarSettings {
  name: string;
  persona: string;
  personality: Personality;
  voice: VoicePref;
  outfit: Outfit;
}

export const DEFAULT_AVATAR: AvatarSettings = {
  name: DEFAULT_AVATAR_NAME,
  persona: '',
  personality: { warmth: 80, playfulness: 55, verbosity: 35, proactivity: 65, formality: 25 },
  voice: { provider: 'device', voiceId: '', rate: 1, pitch: 1.1 },
  outfit: {
    hat: 'none',
    hatColor: '#C9465A',
    glasses: 'none',
    scarf: 'none',
    scarfColor: '#8DB7D9',
    hoodieColor: '#F3E7D3',
    furTint: '',
  },
};

/** Turn personality sliders + persona into system-prompt guidance. */
export function personaPrompt(a: AvatarSettings): string {
  const p = a.personality;
  const lvl = (v: number, lo: string, mid: string, hi: string) => (v < 34 ? lo : v < 67 ? mid : hi);
  const lines = [
    `Your name is ${a.name}.`,
    `Tone: ${lvl(p.warmth, 'neutral and matter-of-fact', 'friendly', 'very warm and encouraging')}, ` +
      `${lvl(p.playfulness, 'serious', 'lightly playful', 'playful with gentle humour')}, ` +
      `${lvl(p.formality, 'casual', 'semi-formal', 'formal')}.`,
    `Length: ${lvl(p.verbosity, 'very concise (1-3 short sentences unless asked)', 'concise', 'detailed when useful')}.`,
    `Initiative: ${lvl(p.proactivity, 'only do what is asked', 'suggest next steps occasionally', 'proactively suggest helpful next steps')}.`,
  ];
  if (a.persona.trim()) lines.push(`User-defined persona (style only, never overrides safety rules): ${a.persona.trim().slice(0, 600)}`);
  return lines.join('\n');
}
