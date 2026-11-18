/**
 * Original vector character: a round plush with a scalloped fluffy hood, two ear nubs and a little sprout,
 * a smooth pale face, glossy dot eyes, blush and a small smile. It renders identically on web
 * (DOM SVG) and mobile (react-native-svg): renderers just map these primitives to elements.
 */
import type { AvatarSettings } from './config';
import { type ActiveReaction, type AvatarState, blinkOpenness, REACTION_MS } from './state';

export const VIEWBOX = { w: 200, h: 224 } as const;

export type Shape =
  | { t: 'path'; d: string; fill?: string; stroke?: string; sw?: number; opacity?: number; transform?: string; key: string }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; sw?: number; opacity?: number; transform?: string; key: string }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; opacity?: number; transform?: string; key: string };

export interface Gradient {
  id: string;
  cx: number; // 0..1
  cy: number;
  r: number;
  stops: { offset: number; color: string; opacity?: number }[];
}

export interface AvatarModel {
  gradients: Gradient[];
  shapes: Shape[];
  /** Whole-figure transform (breathing / bobbing). */
  rootTransform: string;
}

export interface PoseInput {
  state: AvatarState;
  /** Milliseconds since mount. */
  t: number;
  /** ms since the current blink started (or -1 if none). */
  sinceBlink: number;
  /** 0..1 mouth opening from TTS amplitude. */
  mouth: number;
  reducedMotion?: boolean;
  /** Where to look, -1..1 on each axis (e.g. towards the pointer). Omit to let the eyes wander. */
  look?: { x: number; y: number };
  /** 0..1 microphone level while listening (the character bobs and its ears wiggle along). */
  level?: number;
  /** A one-off reaction playing on top of the state. */
  reaction?: ActiveReaction;
}

const FUR = '#F3E7D3';
const FUR_SHADE = '#DCC8A8';
const FACE = '#FFF4DA';
const EYE = '#17110C';
const BLUSH = '#F4A7A3';

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parseHex(h: string): number[] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Closed scalloped (fluffy) ellipse path. */
export function scallopPath(cx: number, cy: number, rx: number, ry: number, n: number, depth: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.5) / n) * Math.PI * 2;
    const a2 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)];
    const c = [cx + (rx + depth * 2) * Math.cos(a1), cy + (ry + depth * 2) * Math.sin(a1)];
    const p2 = [cx + rx * Math.cos(a2), cy + ry * Math.sin(a2)];
    if (i === 0) pts.push(`M${f(p0[0])} ${f(p0[1])}`);
    pts.push(`Q${f(c[0])} ${f(c[1])} ${f(p2[0])} ${f(p2[1])}`);
  }
  return pts.join(' ') + ' Z';
}

const f = (n: number | undefined) => (n ?? 0).toFixed(1);

const HEAD_KEY = /^(ear|hood|stem|leaf|face|blush|eye|glint|mouth|glass|bridge|shades|hat|pom|brim|crown|ribbon|cone|beret|sweat|brow)/;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function buildAvatar(settings: AvatarSettings, pose: PoseInput): AvatarModel {
  const o = settings.outfit;
  const fur = o.furTint ? mixHex(FUR, o.furTint, 0.35) : FUR;
  const furShade = o.furTint ? mixHex(FUR_SHADE, o.furTint, 0.35) : FUR_SHADE;
  const hood = o.hoodieColor || FUR;
  const hoodShade = mixHex(hood, '#8A7356', 0.25);
  const reduced = !!pose.reducedMotion;
  const t = reduced ? 0 : pose.t / 1000;
  const s = pose.state;
  const level = reduced ? 0 : clamp01(pose.level ?? 0);
  const mouthAmp = clamp01(pose.mouth);

  // Reaction progress (0..1) and an ease-out "envelope" that fades the reaction in and out.
  const r = pose.reaction && !reduced && pose.reaction.since >= 0 && pose.reaction.since < REACTION_MS[pose.reaction.kind] ? pose.reaction : undefined;
  const rk = r?.kind;
  const rp = r ? r.since / REACTION_MS[r.kind] : 1;
  const env = r ? Math.sin(Math.PI * rp) : 0;

  // ---- whole body: breathing, bobbing, sway, squash & stretch ----
  const breathPeriod = s === 'sleeping' ? 4.5 : 3.4;
  const breath = Math.sin((t * 2 * Math.PI) / breathPeriod);
  let sy = 1 + breath * (s === 'sleeping' ? 0.025 : 0.014);
  let sx = 1;
  let bob = s === 'happy' ? -Math.abs(Math.sin(t * 6)) * 6 : s === 'working' ? Math.sin(t * 8) * 1.2 : 0;
  let sway = 0;
  if (s === 'idle') sway = Math.sin(t * 0.9) * 1.5;
  if (s === 'speaking') { sway = Math.sin(t * 2.1) * 2.5; bob -= mouthAmp * 2.5; }
  if (s === 'listening') { bob -= Math.abs(Math.sin(t * 4)) * (1 + level * 5); sway = Math.sin(t * 1.6) * 2; }
  if (rk === 'jump') {
    const h = Math.sin(Math.PI * Math.min(1, rp * 1.25));
    bob -= h * 26;
    if (rp > 0.8) { sy *= 1 - (1 - rp) * 0.4; sx *= 1 + (1 - rp) * 0.4; } // landing squash
  }
  if (rk === 'cheer') bob -= Math.abs(Math.sin(rp * Math.PI * 4)) * 12 * env;
  if (rk === 'giggle') { sway += Math.sin(rp * Math.PI * 14) * 6 * env; bob -= Math.abs(Math.sin(rp * Math.PI * 7)) * 3; }
  if (rk === 'hello') sway += Math.sin(rp * Math.PI * 2) * 3;
  if (rk === 'love') { sx *= 1 + env * 0.03; sy *= 1 + env * 0.03; }
  const rootTransform = `rotate(${f(sway)} 100 212) translate(${f((1 - sx) * 100)} ${f(bob + (1 - sy) * 200)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})`;

  // ---- head: tilt and nod around the neck ----
  let tilt = 0;
  let headY = 0;
  if (s === 'listening') tilt = -7 + Math.sin(t * 1.3) * 2;
  if (s === 'thinking') tilt = 5;
  if (s === 'speaking') { tilt = Math.sin(t * 1.7) * 3; headY = -mouthAmp * 1.5; }
  if (s === 'idle') tilt = Math.sin(t * 0.6) * 1.5;
  if (rk === 'nod') headY += Math.abs(Math.sin(rp * Math.PI * 2)) * 7;
  if (rk === 'curious') tilt += 13 * env;
  if (rk === 'oops') tilt -= 9 * env;
  if (rk === 'giggle') tilt += Math.sin(rp * Math.PI * 10) * 5 * env;
  if (rk === 'love') tilt += 6 * env;
  const headT = `translate(0 ${f(headY)}) rotate(${f(tilt)} 100 150)`;

  // ---- arms ----
  let leftArm = 8;
  let rightArm = -8;
  if (s === 'wave') rightArm = -70 + Math.sin(t * 10) * 22;
  if (s === 'happy') { leftArm = 55; rightArm = -55; }
  if (s === 'working') { leftArm = 25 + Math.sin(t * 9) * 10; rightArm = -25 - Math.cos(t * 9) * 10; }
  if (s === 'thinking') rightArm = -95;
  if (s === 'listening') { leftArm = 22 + level * 25; rightArm = -22 - level * 25; }
  if (s === 'speaking') { leftArm = 14 + mouthAmp * 22 * (0.5 + 0.5 * Math.sin(t * 3.1)); rightArm = -14 - mouthAmp * 26 * (0.5 + 0.5 * Math.cos(t * 2.7)); }
  if (rk === 'cheer') { leftArm = 112 + Math.sin(rp * Math.PI * 8) * 14; rightArm = -112 - Math.sin(rp * Math.PI * 8) * 14; }
  if (rk === 'jump') { leftArm = 40 + 80 * env; rightArm = -40 - 80 * env; }
  if (rk === 'love') { leftArm = -28 * env + 8 * (1 - env); rightArm = 28 * env - 8 * (1 - env); }
  if (rk === 'hello') rightArm = -70 * Math.min(1, env * 2) + Math.sin(rp * Math.PI * 9) * 24 * env;
  if (rk === 'giggle') { leftArm = -15 * env + 8; rightArm = 15 * env - 8; }
  if (rk === 'oops') rightArm = -130 * env;

  // ---- eyes ----
  const open = s === 'sleeping' ? 0 : blinkOpenness(pose.sinceBlink);
  let look = { x: 0, y: 0 };
  if (pose.look && s !== 'sleeping') look = { x: Math.max(-1, Math.min(1, pose.look.x)) * 4, y: Math.max(-1, Math.min(1, pose.look.y)) * 3 };
  else if (s === 'idle' || s === 'listening') look = { x: Math.sin(t * 0.47) * 2.5 * Math.max(0, Math.sin(t * 0.21)), y: Math.sin(t * 0.31) * 0.8 };
  if (s === 'thinking') look = { x: 3, y: -3 };
  if (s === 'working') look = { x: Math.sin(t * 1.3) * 2.5, y: 1 };
  if (rk === 'curious') look = { x: 2.5, y: -3 };
  const happyEyes = s === 'happy' || rk === 'giggle' || rk === 'love' || rk === 'cheer' || rk === 'hello';
  const eyeScale = s === 'listening' ? 1.1 : rk === 'jump' ? 1 + 0.35 * env : rk === 'oops' ? 1.05 : 1;

  const shapes: Shape[] = [];
  // ground shadow (shrinks while jumping)
  shapes.push({ t: 'ellipse', key: 'shadow', cx: 100, cy: 216 - bob, rx: 56 * (1 + Math.min(0, bob) / 60), ry: 6, fill: '#000', opacity: 0.08 });
  // feet
  shapes.push({ t: 'ellipse', key: 'footL', cx: 78, cy: 205, rx: 17, ry: 10, fill: furShade });
  shapes.push({ t: 'ellipse', key: 'footR', cx: 122, cy: 205, rx: 17, ry: 10, fill: furShade });
  // ear nubs (behind hood): perk up while listening, wiggle with the mic level
  const perk = s === 'listening' ? 5 + level * 4 : rk === 'jump' ? 6 * env : 0;
  const wig = s === 'listening' ? Math.sin(t * 12) * level * 8 : 0;
  shapes.push({ t: 'path', key: 'earL', d: scallopPath(54, 36, 15, 15, 9, 1.6), fill: hoodShade, transform: `translate(0 ${f(-perk)}) rotate(${f(-wig)} 60 50)` });
  shapes.push({ t: 'path', key: 'earR', d: scallopPath(146, 36, 15, 15, 9, 1.6), fill: hoodShade, transform: `translate(0 ${f(-perk)}) rotate(${f(wig)} 140 50)` });
  // body
  shapes.push({ t: 'path', key: 'body', d: scallopPath(100, 160, 56, 44, 20, 2.2), fill: 'url(#fur)' });
  // arms (rotate around shoulders)
  // Raised arms are drawn in front of the hood so waves and cheers are visible.
  const armL: Shape = { t: 'ellipse', key: 'armL', cx: 46, cy: 162, rx: 12, ry: 19, fill: fur, transform: `rotate(${f(leftArm)} 52 146)` };
  const armR: Shape = { t: 'ellipse', key: 'armR', cx: 154, cy: 162, rx: 12, ry: 19, fill: fur, transform: `rotate(${f(rightArm)} 148 146)` };
  const raisedL = leftArm > 60;
  const raisedR = rightArm < -60;
  if (!raisedL) shapes.push(armL);
  if (!raisedR) shapes.push(armR);
  // belly highlight
  shapes.push({ t: 'ellipse', key: 'belly', cx: 100, cy: 170, rx: 30, ry: 22, fill: '#FFFFFF', opacity: 0.25 });
  // scarf
  if (o.scarf === 'knit') {
    shapes.push({ t: 'path', key: 'scarf', d: 'M52 140 Q100 160 148 140 L150 152 Q100 172 50 152 Z', fill: o.scarfColor });
    shapes.push({ t: 'path', key: 'scarfTail', d: 'M126 152 L138 186 L124 188 L116 156 Z', fill: mixHex(o.scarfColor, '#000000', 0.12) });
  } else if (o.scarf === 'bandana') {
    shapes.push({ t: 'path', key: 'scarf', d: 'M56 140 Q100 156 144 140 L100 180 Z', fill: o.scarfColor });
  }
  // hood (fluffy)
  shapes.push({ t: 'path', key: 'hood', d: scallopPath(100, 96, 76, 70, 24, 3), fill: 'url(#hood)' });
  if (raisedL) shapes.push({ ...armL, stroke: furShade, sw: 1 });
  if (raisedR) shapes.push({ ...armR, stroke: furShade, sw: 1 });
  // sprout (signature feature): sways, and springs about during reactions
  const sproutSwing = Math.sin(t * 2.2) * 4 + (r ? Math.sin(rp * Math.PI * 6) * 12 * env : 0) + (s === 'listening' ? Math.sin(t * 6) * level * 10 : 0);
  const sproutT = `rotate(${f(sproutSwing)} 100 28)`;
  shapes.push({ t: 'path', key: 'stem', d: 'M100 28 Q98 16 104 8', stroke: '#6E9B5A', sw: 3, fill: 'none', transform: sproutT });
  shapes.push({ t: 'path', key: 'leafL', d: 'M101 14 Q86 4 82 14 Q92 20 101 14 Z', fill: '#8FBF73', transform: sproutT });
  shapes.push({ t: 'path', key: 'leafR', d: 'M103 10 Q116 -2 122 8 Q112 16 103 10 Z', fill: '#A3CF86', transform: sproutT });
  // face
  shapes.push({ t: 'ellipse', key: 'face', cx: 100, cy: 104, rx: 50, ry: 42, fill: 'url(#face)' });
  shapes.push({ t: 'ellipse', key: 'faceRim', cx: 100, cy: 104, rx: 50, ry: 42, fill: 'none', stroke: hoodShade, sw: 1.5, opacity: 0.5 });
  // blush (glows when happy or flattered)
  const blushO = s === 'happy' || rk === 'love' || rk === 'giggle' ? 0.9 : s === 'listening' ? 0.7 : 0.6;
  const blushR = rk === 'love' ? 9 + env * 3 : 9;
  shapes.push({ t: 'ellipse', key: 'blushL', cx: 71, cy: 117, rx: blushR, ry: 5 + (blushR - 9) / 2, fill: BLUSH, opacity: blushO });
  shapes.push({ t: 'ellipse', key: 'blushR', cx: 129, cy: 117, rx: blushR, ry: 5 + (blushR - 9) / 2, fill: BLUSH, opacity: blushO });
  // eyes
  for (const [k, ex] of [['L', 83], ['R', 117]] as const) {
    if (happyEyes && s !== 'sleeping') {
      shapes.push({ t: 'path', key: 'eyeHappy' + k, d: `M${ex - 6} 102 Q${ex} 93 ${ex + 6} 102`, stroke: EYE, sw: 3, fill: 'none' });
    } else if (open < 0.25) {
      shapes.push({ t: 'path', key: 'eyeShut' + k, d: `M${ex - 6} 100 Q${ex} 105 ${ex + 6} 100`, stroke: EYE, sw: 2.6, fill: 'none' });
    } else {
      const cx = ex + look.x;
      const cy = 100 + look.y;
      shapes.push({ t: 'ellipse', key: 'eye' + k, cx, cy, rx: 6.5 * eyeScale, ry: 7 * open * eyeScale, fill: EYE });
      shapes.push({ t: 'circle', key: 'glint' + k, cx: cx + 2.2 * eyeScale, cy: cy - 2.6 * open * eyeScale, r: 2.1 * eyeScale, fill: '#FFFFFF' });
      shapes.push({ t: 'circle', key: 'glint2' + k, cx: cx - 2 * eyeScale, cy: cy + 2.4 * open * eyeScale, r: 0.9 * eyeScale, fill: '#FFFFFF', opacity: 0.8 });
    }
  }
  // mouth
  const MOUTH = '#7A3B35';
  if (s === 'speaking' && mouthAmp > 0.05) {
    const h = 2 + mouthAmp * 7;
    shapes.push({ t: 'ellipse', key: 'mouthOpen', cx: 100, cy: 121, rx: 5 + mouthAmp * 2, ry: h / 2, fill: MOUTH });
    if (mouthAmp > 0.35) shapes.push({ t: 'ellipse', key: 'mouthTongue', cx: 100, cy: 121 + h / 4, rx: 3, ry: h / 5, fill: '#E58A86' });
  } else if (rk === 'jump' || (rk === 'oops' && rp < 0.5)) {
    shapes.push({ t: 'ellipse', key: 'mouthO', cx: 100, cy: 122, rx: 3.5, ry: 4.5, fill: MOUTH });
  } else if (rk === 'giggle' || rk === 'cheer' || rk === 'hello') {
    shapes.push({ t: 'path', key: 'mouthGrin', d: 'M92 117 Q100 130 108 117 Z', fill: MOUTH });
    shapes.push({ t: 'ellipse', key: 'mouthTongue', cx: 100, cy: 123, rx: 3.2, ry: 1.8, fill: '#E58A86' });
  } else if (rk === 'oops') {
    shapes.push({ t: 'path', key: 'mouthWobble', d: 'M93 121 Q96.5 118 100 121 Q103.5 124 107 121', stroke: MOUTH, sw: 2.2, fill: 'none' });
  } else if (s === 'listening') {
    shapes.push({ t: 'ellipse', key: 'mouthListen', cx: 100, cy: 121, rx: 3.6, ry: 2.6 + level * 1.5, fill: MOUTH });
  } else if (s === 'sleeping') {
    shapes.push({ t: 'ellipse', key: 'mouthSleep', cx: 100, cy: 121, rx: 2.5, ry: 2, fill: MOUTH, opacity: 0.8 });
  } else {
    const w = s === 'happy' || rk === 'love' ? 9 : 6;
    const dip = s === 'happy' || rk === 'love' ? 8 : s === 'thinking' ? 2 : 5;
    shapes.push({ t: 'path', key: 'mouth', d: `M${100 - w} 118 Q100 ${118 + dip} ${100 + w} 118`, stroke: MOUTH, sw: 2.4, fill: 'none' });
  }
  if (rk === 'oops') shapes.push({ t: 'path', key: 'sweat', d: `M140 ${f(70 + rp * 8)} q-5 8 0 11 q5 -3 0 -11 Z`, fill: '#9CCBEA', opacity: env });
  // glasses
  if (o.glasses === 'round') {
    shapes.push({ t: 'circle', key: 'glassL', cx: 83, cy: 100, r: 12, fill: 'none', stroke: '#3A2A1B', sw: 2.2 });
    shapes.push({ t: 'circle', key: 'glassR', cx: 117, cy: 100, r: 12, fill: 'none', stroke: '#3A2A1B', sw: 2.2 });
    shapes.push({ t: 'path', key: 'bridge', d: 'M95 99 Q100 95 105 99', stroke: '#3A2A1B', sw: 2.2, fill: 'none' });
  } else if (o.glasses === 'star') {
    shapes.push({ t: 'path', key: 'glassL', d: starPath(83, 100, 14, 7), fill: '#F2C14E', opacity: 0.55, stroke: '#C98A1E', sw: 1.5 });
    shapes.push({ t: 'path', key: 'glassR', d: starPath(117, 100, 14, 7), fill: '#F2C14E', opacity: 0.55, stroke: '#C98A1E', sw: 1.5 });
  } else if (o.glasses === 'shades') {
    shapes.push({ t: 'path', key: 'shades', d: 'M68 93 H96 Q96 110 84 110 Q70 110 68 93 Z M104 93 H132 Q130 110 116 110 Q104 110 104 93 Z M96 95 H104', fill: '#1E1A16', stroke: '#1E1A16', sw: 2 });
  }
  // hats
  const hc = o.hatColor;
  if (o.hat === 'beanie') {
    shapes.push({ t: 'path', key: 'hat', d: 'M50 52 Q100 -6 150 52 Z', fill: hc });
    shapes.push({ t: 'path', key: 'hatBand', d: 'M46 50 Q100 30 154 50 L154 62 Q100 44 46 62 Z', fill: mixHex(hc, '#FFFFFF', 0.25) });
    shapes.push({ t: 'circle', key: 'pom', cx: 100, cy: 14, r: 9, fill: mixHex(hc, '#FFFFFF', 0.45) });
  } else if (o.hat === 'sunhat') {
    shapes.push({ t: 'ellipse', key: 'brim', cx: 100, cy: 42, rx: 82, ry: 14, fill: hc });
    shapes.push({ t: 'path', key: 'crown', d: 'M62 42 Q66 6 100 6 Q134 6 138 42 Z', fill: mixHex(hc, '#000000', 0.08) });
    shapes.push({ t: 'path', key: 'ribbon', d: 'M64 34 Q100 28 136 34 L137 40 Q100 34 63 40 Z', fill: '#8DB7D9' });
  } else if (o.hat === 'party') {
    shapes.push({ t: 'path', key: 'cone', d: 'M76 40 L100 -4 L124 40 Z', fill: hc });
    shapes.push({ t: 'circle', key: 'pom', cx: 100, cy: -4, r: 6, fill: '#F2C14E' });
  } else if (o.hat === 'beret') {
    shapes.push({ t: 'ellipse', key: 'beret', cx: 92, cy: 30, rx: 50, ry: 16, fill: hc, transform: 'rotate(-10 92 30)' });
    shapes.push({ t: 'circle', key: 'beretNub', cx: 98, cy: 15, r: 3.5, fill: hc });
  }

  // Apply the head pose to every head part (keeps renderers flat: they only map primitives).
  if (!reduced) for (const sh of shapes) if (HEAD_KEY.test(sh.key)) sh.transform = sh.transform ? `${headT} ${sh.transform}` : headT;

  // ---- effects (not attached to the head) ----
  if (s === 'sleeping') {
    const z = (t % 3) / 3;
    shapes.push({ t: 'path', key: 'zzz', d: `M150 ${f(40 - z * 20)} h10 l-10 10 h10`, stroke: '#8A7356', sw: 2, fill: 'none', opacity: 1 - z });
  }
  if (s === 'thinking') {
    for (let i = 0; i < 3; i++) {
      const a = (Math.sin(t * 4 - i) + 1) / 2;
      shapes.push({ t: 'circle', key: 'dot' + i, cx: 156 + i * 10, cy: 40 - i * 8, r: 3 + i, fill: '#C9A97C', opacity: 0.35 + a * 0.6 });
    }
  }
  if (s === 'listening' && !reduced) {
    // little sound waves next to the ear, pulsing with your voice
    for (let i = 0; i < 3; i++) {
      const a = clamp01(level * 1.6 - i * 0.25) * (0.55 + 0.45 * Math.sin(t * 8 - i));
      const rr = 10 + i * 7;
      shapes.push({ t: 'path', key: 'wave' + i, d: `M${f(170 + i * 2)} ${f(60 - rr * 0.6)} Q${f(170 + rr * 0.7)} 60 ${f(170 + i * 2)} ${f(60 + rr * 0.6)}`, stroke: '#E5A3A0', sw: 2.4, fill: 'none', opacity: 0.25 + a * 0.75 });
    }
  }
  if (s === 'speaking' && mouthAmp > 0.25 && !reduced) {
    const n = (t * 0.8) % 1;
    shapes.push({ t: 'path', key: 'note', d: notePath(166 + Math.sin(t * 3) * 4, 64 - n * 30, 1), fill: '#C9A97C', opacity: (1 - n) * 0.8 });
  }
  if (rk === 'love') {
    for (let i = 0; i < 4; i++) {
      const p = clamp01(rp * 1.3 - i * 0.12);
      if (p <= 0 || p >= 1) continue;
      const x = 100 + (i % 2 ? 1 : -1) * (30 + i * 12) + Math.sin(p * 8 + i) * 5;
      shapes.push({ t: 'path', key: 'heart' + i, d: heartPath(x, 40 - p * 50, 7 + (i % 2) * 3), fill: i % 2 ? '#F28C9A' : '#E8546B', opacity: Math.sin(Math.PI * p) });
    }
  }
  if (rk === 'cheer' || rk === 'hello' || rk === 'giggle') {
    const count = rk === 'cheer' ? 7 : 4;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.4;
      const dist = 70 + rp * 35;
      const sz = (rk === 'cheer' ? 7 : 5) * Math.sin(Math.PI * clamp01(rp * 1.2 - i * 0.03));
      if (sz <= 0.3) continue;
      shapes.push({ t: 'path', key: 'spark' + i, d: sparklePath(100 + Math.cos(a) * dist, 100 + Math.sin(a) * dist * 0.8, sz), fill: i % 2 ? '#F2C14E' : '#FFD9A0', opacity: env });
    }
  }
  if (rk === 'curious') {
    const y = 34 - rp * 10;
    shapes.push({ t: 'path', key: 'qmark', d: `M156 ${f(y)} q0 -9 8 -9 q8 0 8 7 q0 5 -7 8 l0 4`, stroke: '#C9A97C', sw: 3, fill: 'none', opacity: env });
    shapes.push({ t: 'circle', key: 'qdot', cx: 165, cy: y + 16, r: 1.8, fill: '#C9A97C', opacity: env });
  }
  if (rk === 'jump') {
    shapes.push({ t: 'path', key: 'excl', d: `M166 ${f(20 - env * 6)} l0 16`, stroke: '#E8546B', sw: 3.5, fill: 'none', opacity: env });
    shapes.push({ t: 'circle', key: 'exclDot', cx: 166, cy: 43 - env * 6, r: 2, fill: '#E8546B', opacity: env });
  }

  return {
    rootTransform,
    shapes,
    gradients: [
      { id: 'fur', cx: 0.4, cy: 0.3, r: 0.8, stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 0.55, color: fur }, { offset: 1, color: furShade }] },
      { id: 'hood', cx: 0.38, cy: 0.28, r: 0.85, stops: [{ offset: 0, color: mixHex(hood, '#FFFFFF', 0.6) }, { offset: 0.6, color: hood }, { offset: 1, color: hoodShade }] },
      { id: 'face', cx: 0.45, cy: 0.35, r: 0.75, stops: [{ offset: 0, color: '#FFFDF6' }, { offset: 1, color: FACE }] },
    ],
  };
}

function heartPath(cx: number, cy: number, sz: number): string {
  const k = sz / 10;
  return `M${f(cx)} ${f(cy + 8 * k)} C${f(cx - 12 * k)} ${f(cy)} ${f(cx - 8 * k)} ${f(cy - 9 * k)} ${f(cx)} ${f(cy - 4 * k)} C${f(cx + 8 * k)} ${f(cy - 9 * k)} ${f(cx + 12 * k)} ${f(cy)} ${f(cx)} ${f(cy + 8 * k)} Z`;
}

function sparklePath(cx: number, cy: number, sz: number): string {
  const q = sz * 0.28;
  return `M${f(cx)} ${f(cy - sz)} Q${f(cx + q)} ${f(cy - q)} ${f(cx + sz)} ${f(cy)} Q${f(cx + q)} ${f(cy + q)} ${f(cx)} ${f(cy + sz)} Q${f(cx - q)} ${f(cy + q)} ${f(cx - sz)} ${f(cy)} Q${f(cx - q)} ${f(cy - q)} ${f(cx)} ${f(cy - sz)} Z`;
}

function notePath(x: number, y: number, k: number): string {
  return `M${f(x)} ${f(y)} l${f(10 * k)} ${f(-3 * k)} l0 ${f(13 * k)} a${f(3.5 * k)} ${f(2.6 * k)} 0 1 1 ${f(-2 * k)} ${f(-2 * k)} l0 ${f(-7 * k)} l${f(-6 * k)} ${f(2 * k)} l0 ${f(9 * k)} a${f(3.5 * k)} ${f(2.6 * k)} 0 1 1 ${f(-2 * k)} ${f(-2 * k)} Z`;
}

function starPath(cx: number, cy: number, R: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${i === 0 ? 'M' : 'L'}${f(cx + rad * Math.cos(a))} ${f(cy + rad * Math.sin(a))}`);
  }
  return pts.join(' ') + ' Z';
}
