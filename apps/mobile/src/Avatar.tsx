/**
 * Mobile avatar: renders the shared original vector character (from @muse/core) with react-native-svg.
 * Same states and timing as web: breathing, random 3-6 s blinks, wave, thinking, speaking (lip-sync), happy,
 * working, sleeping. Honours the OS "reduce motion" setting.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Pressable, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop } from 'react-native-svg';
import { AVATAR_ASSET, type AvatarSettings, type AvatarState, buildAvatar, nextBlinkDelay, type Reaction, VIEWBOX } from '@muse/core/avatar';

const LABEL: Record<AvatarState, string> = { idle: 'relaxing', wave: 'waving hello', listening: 'listening to you', thinking: 'thinking', speaking: 'speaking', happy: 'happy', working: 'working on your tasks', sleeping: 'sleeping' };

export interface AvatarProps {
  settings: AvatarSettings;
  state: AvatarState;
  size?: number;
  mouthRef?: { current: number };
  /** 0..1 microphone level while listening. */
  levelRef?: { current: number };
  /** One-off reaction; `at` is a Date.now() timestamp. */
  reaction?: { kind: Reaction; at: number } | null;
  /** Makes the character tappable. */
  onTap?: () => void;
  reducedMotion?: boolean;
}

export function Avatar({ settings, state, size = 120, mouthRef, levelRef, reaction, onTap, reducedMotion }: AvatarProps) {
  const [sysReduced, setSysReduced] = useState(false);
  const [t, setT] = useState(0);
  const start = useRef(Date.now());
  const blinkAt = useRef(-1);
  const reduced = reducedMotion || sysReduced;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setSysReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSysReduced);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setT(Date.now() - start.current), 40);
    let timer: ReturnType<typeof setTimeout>;
    const blink = () => { timer = setTimeout(() => { blinkAt.current = Date.now() - start.current; blink(); }, nextBlinkDelay()); };
    blink();
    return () => { clearInterval(id); clearTimeout(timer); };
  }, [reduced]);

  const label = `${settings.name} is ${LABEL[state]}`;
  if (AVATAR_ASSET.kind === 'image') {
    return <Image accessibilityLabel={label} source={{ uri: AVATAR_ASSET.path }} style={{ width: size, height: size }} />;
  }
  let mouth = mouthRef?.current ?? 0;
  if (state === 'speaking' && !mouthRef) mouth = (Math.sin(t / 70) + 1) / 2;
  const m = buildAvatar(settings, {
    state, t, sinceBlink: blinkAt.current < 0 ? -1 : t - blinkAt.current, mouth, reducedMotion: reduced,
    level: levelRef?.current ?? 0,
    reaction: reaction ? { kind: reaction.kind, since: Date.now() - reaction.at } : undefined,
  });
  const Wrap = onTap ? Pressable : View;
  return (
    <Wrap accessible accessibilityRole={onTap ? 'button' : 'image'} accessibilityLabel={onTap ? `${label}. Tap to play with ${settings.name}.` : label} {...(onTap ? { onPress: onTap } : {})}>
      <Svg width={size} height={(size * VIEWBOX.h) / VIEWBOX.w} viewBox={`-10 -14 ${VIEWBOX.w + 20} ${VIEWBOX.h + 20}`}>
        <Defs>
          {m.gradients.map((g) => (
            <RadialGradient key={g.id} id={g.id} cx={g.cx} cy={g.cy} r={g.r}>
              {g.stops.map((s, i) => <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />)}
            </RadialGradient>
          ))}
        </Defs>
        <G transform={m.rootTransform}>
          {m.shapes.map((s) => {
            const p = { fill: s.fill ?? 'none', stroke: s.stroke, strokeWidth: s.sw, opacity: s.opacity, transform: s.transform, strokeLinecap: 'round' as const };
            if (s.t === 'path') return <Path key={s.key} d={s.d} {...p} />;
            if (s.t === 'ellipse') return <Ellipse key={s.key} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...p} />;
            return <Circle key={s.key} cx={s.cx} cy={s.cy} r={s.r} {...p} />;
          })}
        </G>
      </Svg>
    </Wrap>
  );
}
