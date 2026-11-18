'use client';
import { useEffect, useRef, useState } from 'react';
import { AVATAR_ASSET, type AvatarSettings, type AvatarState, buildAvatar, nextBlinkDelay, type Reaction, VIEWBOX } from '@muse/core/avatar';

const STATE_LABEL: Record<AvatarState, string> = {
  idle: 'relaxing', wave: 'waving hello', listening: 'listening to you', thinking: 'thinking', speaking: 'speaking', happy: 'happy', working: 'working on your tasks', sleeping: 'sleeping',
};

export interface AvatarProps {
  settings: AvatarSettings;
  state: AvatarState;
  size?: number;
  /** 0..1 mouth opening (TTS amplitude); a ref so it can change every frame without re-rendering. */
  mouthRef?: { current: number };
  /** 0..1 microphone level while listening (a ref, like mouthRef). */
  levelRef?: { current: number };
  /** A one-off reaction; `at` is a performance.now() timestamp. Change `at` to replay it. */
  reaction?: { kind: Reaction; at: number } | null;
  /** Eyes follow the mouse/finger. */
  followPointer?: boolean;
  /** Makes the character clickable (e.g. to giggle when poked). */
  onTap?: () => void;
  reducedMotion?: boolean;
  className?: string;
}

function usePrefersReducedMotion() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setV(m.matches);
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

/** Animated character: breathing, blinks, wave, listening, thinking, speaking (lip-sync), reactions and more. */
export function Avatar({ settings, state, size = 120, mouthRef, levelRef, reaction, followPointer, onTap, reducedMotion, className }: AvatarProps) {
  const sysReduced = usePrefersReducedMotion();
  const reduced = reducedMotion || sysReduced;
  const [frame, setFrame] = useState(0);
  const start = useRef(0);
  const blinkAt = useRef(-1);
  const svgRef = useRef<SVGSVGElement>(null);
  const look = useRef<{ x: number; y: number } | null>(null);
  const lookUntil = useRef(0);

  useEffect(() => {
    start.current = performance.now();
    let raf = 0;
    let last = 0;
    let blinkTimer: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => { blinkAt.current = performance.now(); scheduleBlink(); }, nextBlinkDelay());
    };
    scheduleBlink();
    const loop = (now: number) => {
      if (now - last > 33) { last = now; setFrame(now); } // ~30 fps is plenty
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); clearTimeout(blinkTimer); };
  }, []);

  useEffect(() => {
    if (!followPointer) return;
    const onMove = (e: PointerEvent) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.45;
      look.current = { x: Math.tanh((e.clientX - cx) / (r.width * 0.9)), y: Math.tanh((e.clientY - cy) / (r.height * 0.9)) };
      lookUntil.current = performance.now() + 2500; // drift back to idle gazing after a while
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [followPointer]);

  const t = frame ? frame - start.current : 0;
  const sinceBlink = blinkAt.current < 0 || reduced ? -1 : frame - blinkAt.current;
  let mouth = mouthRef?.current ?? 0;
  if (state === 'speaking' && !mouthRef) mouth = (Math.sin(t / 70) + 1) / 2;
  const label = `${settings.name} is ${STATE_LABEL[state]}`;

  if (AVATAR_ASSET.kind === 'image') {
    return <img src={AVATAR_ASSET.path} alt={label} width={size} height={size} className={`avatar-img avatar-${state} ${className ?? ''}`} onClick={onTap} />;
  }
  const model = buildAvatar(settings, {
    state, t, sinceBlink, mouth, reducedMotion: reduced,
    level: levelRef?.current ?? 0,
    look: look.current && frame < lookUntil.current ? look.current : undefined,
    reaction: reaction && frame ? { kind: reaction.kind, since: frame - reaction.at } : undefined,
  });
  const h = (size * VIEWBOX.h) / VIEWBOX.w;
  const interactive = onTap ? {
    role: 'button' as const, tabIndex: 0, style: { cursor: 'pointer', touchAction: 'manipulation' as const },
    onClick: onTap,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } },
  } : { role: 'img' as const };
  return (
    <svg ref={svgRef} {...interactive} aria-label={onTap ? `${label}. Tap to play with ${settings.name}.` : label} width={size} height={h} viewBox={`-10 -14 ${VIEWBOX.w + 20} ${VIEWBOX.h + 20}`} className={className}>
      <title>{label}</title>
      <defs>
        {model.gradients.map((g) => (
          <radialGradient key={g.id} id={g.id} cx={g.cx} cy={g.cy} r={g.r}>
            {g.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />)}
          </radialGradient>
        ))}
      </defs>
      <g transform={model.rootTransform}>
        {model.shapes.map((s) => {
          const common = { fill: s.fill ?? 'none', stroke: s.stroke, strokeWidth: s.sw, opacity: s.opacity, transform: s.transform, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
          if (s.t === 'path') return <path key={s.key} d={s.d} {...common} />;
          if (s.t === 'ellipse') return <ellipse key={s.key} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />;
          return <circle key={s.key} cx={s.cx} cy={s.cy} r={s.r} {...common} />;
        })}
      </g>
    </svg>
  );
}
