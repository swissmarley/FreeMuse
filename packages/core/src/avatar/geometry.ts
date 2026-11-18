/**
 * Original vector character: a round plush with a scalloped fluffy hood, two ear nubs and a little sprout,
 * a smooth pale face, glossy dot eyes, blush and a small smile. It renders identically on web
 * (DOM SVG) and mobile (react-native-svg): renderers just map these primitives to elements.
 */
import type { AvatarSettings } from './config.js';
import { type AvatarState, blinkOpenness } from './state.js';

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

export function buildAvatar(settings: AvatarSettings, pose: PoseInput): AvatarModel {
  const o = settings.outfit;
  const fur = o.furTint ? mixHex(FUR, o.furTint, 0.35) : FUR;
  const furShade = o.furTint ? mixHex(FUR_SHADE, o.furTint, 0.35) : FUR_SHADE;
  const hood = o.hoodieColor || FUR;
  const hoodShade = mixHex(hood, '#8A7356', 0.25);
  const t = pose.reducedMotion ? 0 : pose.t / 1000;
  const s = pose.state;

  // Breathing / bobbing
  const breathPeriod = s === 'sleeping' ? 4.5 : 3.4;
  const breath = Math.sin((t * 2 * Math.PI) / breathPeriod);
  const sy = 1 + breath * (s === 'sleeping' ? 0.025 : 0.014);
  const bob = s === 'happy' ? -Math.abs(Math.sin(t * 6)) * 6 : s === 'working' ? Math.sin(t * 8) * 1.2 : 0;
  const rootTransform = `translate(0 ${f(bob + (1 - sy) * 200)}) scale(1 ${sy.toFixed(4)})`;

  // Arms
  let leftArm = 8;
  let rightArm = -8;
  if (s === 'wave') rightArm = -70 + Math.sin(t * 10) * 22;
  if (s === 'happy') {
    leftArm = 55;
    rightArm = -55;
  }
  if (s === 'working') {
    leftArm = 25 + Math.sin(t * 9) * 10;
    rightArm = -25 - Math.cos(t * 9) * 10;
  }
  if (s === 'thinking') rightArm = -95;

  // Eyes
  const open = s === 'sleeping' ? 0 : blinkOpenness(pose.sinceBlink);
  const look = s === 'thinking' ? { x: 3, y: -3 } : s === 'working' ? { x: Math.sin(t * 1.3) * 2.5, y: 1 } : { x: 0, y: 0 };

  const shapes: Shape[] = [];
  // ground shadow
  shapes.push({ t: 'ellipse', key: 'shadow', cx: 100, cy: 216, rx: 56, ry: 6, fill: '#000', opacity: 0.08 });
  // feet
  shapes.push({ t: 'ellipse', key: 'footL', cx: 78, cy: 205, rx: 17, ry: 10, fill: furShade });
  shapes.push({ t: 'ellipse', key: 'footR', cx: 122, cy: 205, rx: 17, ry: 10, fill: furShade });
  // ear nubs (behind hood)
  shapes.push({ t: 'path', key: 'earL', d: scallopPath(54, 36, 15, 15, 9, 1.6), fill: hoodShade });
  shapes.push({ t: 'path', key: 'earR', d: scallopPath(146, 36, 15, 15, 9, 1.6), fill: hoodShade });
  // body
  shapes.push({ t: 'path', key: 'body', d: scallopPath(100, 160, 56, 44, 20, 2.2), fill: 'url(#fur)' });
  // arms (rotate around shoulders)
  shapes.push({ t: 'ellipse', key: 'armL', cx: 46, cy: 162, rx: 12, ry: 19, fill: fur, transform: `rotate(${f(leftArm)} 52 146)` });
  shapes.push({ t: 'ellipse', key: 'armR', cx: 154, cy: 162, rx: 12, ry: 19, fill: fur, transform: `rotate(${f(rightArm)} 148 146)` });
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
  // sprout (signature feature)
  shapes.push({ t: 'path', key: 'stem', d: 'M100 28 Q98 16 104 8', stroke: '#6E9B5A', sw: 3, fill: 'none' });
  shapes.push({ t: 'path', key: 'leafL', d: 'M101 14 Q86 4 82 14 Q92 20 101 14 Z', fill: '#8FBF73' });
  shapes.push({ t: 'path', key: 'leafR', d: 'M103 10 Q116 -2 122 8 Q112 16 103 10 Z', fill: '#A3CF86' });
  // face
  shapes.push({ t: 'ellipse', key: 'face', cx: 100, cy: 104, rx: 50, ry: 42, fill: 'url(#face)' });
  shapes.push({ t: 'ellipse', key: 'faceRim', cx: 100, cy: 104, rx: 50, ry: 42, fill: 'none', stroke: hoodShade, sw: 1.5, opacity: 0.5 });
  // blush
  shapes.push({ t: 'ellipse', key: 'blushL', cx: 71, cy: 117, rx: 9, ry: 5, fill: BLUSH, opacity: s === 'happy' ? 0.85 : 0.6 });
  shapes.push({ t: 'ellipse', key: 'blushR', cx: 129, cy: 117, rx: 9, ry: 5, fill: BLUSH, opacity: s === 'happy' ? 0.85 : 0.6 });
  // eyes
  for (const [k, ex] of [['L', 83], ['R', 117]] as const) {
    if (s === 'happy') {
      shapes.push({ t: 'path', key: 'eyeHappy' + k, d: `M${ex - 6} 102 Q${ex} 93 ${ex + 6} 102`, stroke: EYE, sw: 3, fill: 'none' });
    } else if (open < 0.25) {
      shapes.push({ t: 'path', key: 'eyeShut' + k, d: `M${ex - 6} 100 Q${ex} 105 ${ex + 6} 100`, stroke: EYE, sw: 2.6, fill: 'none' });
    } else {
      const cx = ex + look.x;
      const cy = 100 + look.y;
      shapes.push({ t: 'ellipse', key: 'eye' + k, cx, cy, rx: 6.5, ry: 7 * open, fill: EYE });
      shapes.push({ t: 'circle', key: 'glint' + k, cx: cx + 2.2, cy: cy - 2.6 * open, r: 2.1, fill: '#FFFFFF' });
      shapes.push({ t: 'circle', key: 'glint2' + k, cx: cx - 2, cy: cy + 2.4 * open, r: 0.9, fill: '#FFFFFF', opacity: 0.8 });
    }
  }
  // mouth
  if (s === 'speaking' && pose.mouth > 0.05) {
    const h = 2 + pose.mouth * 7;
    shapes.push({ t: 'ellipse', key: 'mouthOpen', cx: 100, cy: 121, rx: 5 + pose.mouth * 2, ry: h / 2, fill: '#7A3B35' });
  } else if (s === 'sleeping') {
    shapes.push({ t: 'ellipse', key: 'mouthSleep', cx: 100, cy: 121, rx: 2.5, ry: 2, fill: '#7A3B35', opacity: 0.8 });
  } else {
    const w = s === 'happy' ? 9 : 6;
    const dip = s === 'happy' ? 8 : s === 'thinking' ? 2 : 5;
    shapes.push({ t: 'path', key: 'mouth', d: `M${100 - w} 118 Q100 ${118 + dip} ${100 + w} 118`, stroke: '#7A3B35', sw: 2.4, fill: 'none' });
  }
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

function starPath(cx: number, cy: number, R: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${i === 0 ? 'M' : 'L'}${f(cx + rad * Math.cos(a))} ${f(cy + rad * Math.sin(a))}`);
  }
  return pts.join(' ') + ' Z';
}
