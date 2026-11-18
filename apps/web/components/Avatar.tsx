'use client';
import { useEffect, useRef, useState } from 'react';
import { AVATAR_ASSET, type AvatarSettings, type AvatarState, buildAvatar, nextBlinkDelay, VIEWBOX } from '@muse/core/avatar';

const STATE_LABEL: Record<AvatarState, string> = {
  idle: 'relaxing', wave: 'waving hello', thinking: 'thinking', speaking: 'speaking', happy: 'happy', working: 'working on your tasks', sleeping: 'sleeping',
};

export interface AvatarProps {
  settings: AvatarSettings;
  state: AvatarState;
  size?: number;
  /** 0..1 mouth opening (TTS amplitude); a ref so it can change every frame without re-rendering. */
  mouthRef?: { current: number };
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

/** Animated character: breathing, random blinks (3-6 s), wave, thinking, speaking (lip-sync), happy, working, sleeping. */
export function Avatar({ settings, state, size = 120, mouthRef, reducedMotion, className }: AvatarProps) {
  const sysReduced = usePrefersReducedMotion();
  const reduced = reducedMotion || sysReduced;
  const [frame, setFrame] = useState(0);
  const start = useRef(0);
  const blinkAt = useRef(-1);

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

  const t = frame ? frame - start.current : 0;
  const sinceBlink = blinkAt.current < 0 || reduced ? -1 : frame - blinkAt.current;
  let mouth = mouthRef?.current ?? 0;
  if (state === 'speaking' && !mouthRef) mouth = (Math.sin(t / 70) + 1) / 2;
  const label = `${settings.name} is ${STATE_LABEL[state]}`;

  if (AVATAR_ASSET.kind === 'image') {
    return <img src={AVATAR_ASSET.path} alt={label} width={size} height={size} className={`avatar-img avatar-${state} ${className ?? ''}`} />;
  }
  const model = buildAvatar(settings, { state, t, sinceBlink, mouth, reducedMotion: reduced });
  const h = (size * VIEWBOX.h) / VIEWBOX.w;
  return (
    <svg role="img" aria-label={label} width={size} height={h} viewBox={`-10 -14 ${VIEWBOX.w + 20} ${VIEWBOX.h + 20}`} className={className}>
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
          const common = { fill: s.fill ?? 'none', stroke: s.stroke, strokeWidth: s.sw, opacity: s.opacity, transform: s.transform, strokeLinecap: 'round' as const };
          if (s.t === 'path') return <path key={s.key} d={s.d} {...common} />;
          if (s.t === 'ellipse') return <ellipse key={s.key} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />;
          return <circle key={s.key} cx={s.cx} cy={s.cy} r={s.r} {...common} />;
        })}
      </g>
    </svg>
  );
}
