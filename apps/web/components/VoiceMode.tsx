'use client';
/**
 * Full-screen voice mode: the character listens (ears perk up and wiggle with your voice), nods when you finish,
 * thinks, then speaks with lip-sync and reacts to what it says (cheers when something is done, a little "oops"
 * when it can't, hearts when you say thanks). Tap it to play: it giggles, jumps and waves back.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BRAND } from '@muse/core/brand';
import { type AvatarSettings, type AvatarState, type Reaction, reactionForReply, reactionForUser, tapReaction } from '@muse/core/avatar';
import { Avatar } from './Avatar';
import { unlockAudio } from '../lib/voice';

interface Props {
  avatar: AvatarSettings;
  /** Page-level avatar state (thinking / speaking / working …). */
  state: AvatarState;
  reducedMotion?: boolean;
  speech: { speak: (t: string) => Promise<void>; stop: () => void; speaking: boolean; mouth: { current: number }; engine: 'natural' | 'device' };
  listener: { start: () => Promise<void>; stop: () => Promise<string>; listening: boolean; partial: string; level: number };
  /** The latest assistant message (spoken by the page while voice mode is open). */
  lastReply?: { id: string; text: string } | null;
  streamingText?: string;
  thinking: boolean;
  strings: { listening: string; holdToTalk: string };
  onSay: (text: string) => Promise<void>;
  onClose: () => void;
  onMicError: () => void;
}

const HOLD_MS = 350;

/** Soft rings behind the character that pulse with your voice or its voice (DOM-updated, no re-renders). */
function PulseRings({ levelRef, mouthRef, active }: { levelRef: { current: number }; mouthRef: { current: number }; active: 'listening' | 'speaking' | 'idle' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      const target = active === 'listening' ? levelRef.current : active === 'speaking' ? mouthRef.current : 0;
      smooth += (target - smooth) * 0.25;
      ref.current?.style.setProperty('--pulse', smooth.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef, mouthRef]);
  return <div ref={ref} className={`vm-rings vm-${active}`} aria-hidden><i /><i /><i /></div>;
}

export function VoiceMode({ avatar, state, reducedMotion, speech, listener, lastReply, streamingText, thinking, strings, onSay, onClose, onMicError }: Props) {
  const [reaction, setReaction] = useState<{ kind: Reaction; at: number } | null>(null);
  const [bubble, setBubble] = useState<string | null>(`Hi! I'm all ears 👂 Hold the button (or the space bar) and talk to me.`);
  const [latched, setLatched] = useState(false);
  const taps = useRef(0);
  const pressAt = useRef(0);
  const levelRef = useRef(0);
  const seenReply = useRef<string | null>(lastReply?.id ?? null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  levelRef.current = listener.level;
  const react = useCallback((kind: Reaction) => setReaction({ kind, at: performance.now() }), []);
  const say = useCallback((text: string | null, ms = 3500) => {
    clearTimeout(bubbleTimer.current);
    setBubble(text);
    if (text) bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  // Say hello when voice mode opens.
  useEffect(() => {
    unlockAudio();
    react('hello');
    bubbleTimer.current = setTimeout(() => setBubble(null), 6000);
    return () => clearTimeout(bubbleTimer.current);
  }, [react]);

  // React to each new reply before/while it is spoken.
  useEffect(() => {
    if (!lastReply || seenReply.current === lastReply.id) return;
    seenReply.current = lastReply.id;
    react(reactionForReply(lastReply.text));
    setBubble(null);
  }, [lastReply, react]);

  const startTalking = useCallback(async () => {
    if (listener.listening) return;
    unlockAudio();
    speech.stop();
    say(null);
    try { await listener.start(); } catch { onMicError(); }
  }, [listener, speech, say, onMicError]);

  const stopTalking = useCallback(async () => {
    setLatched(false);
    if (!listener.listening) return;
    const said = (await listener.stop().catch(() => '')).trim();
    if (!said) { react('curious'); say("Hmm, I didn't catch that. Try again?"); return; }
    react(reactionForUser(said));
    await onSay(said);
  }, [listener, onSay, react, say]);

  // Hold to talk, or tap once to start and tap again to send.
  const onPointerDown = () => { pressAt.current = performance.now(); if (latched) return; void startTalking(); };
  const onPointerUp = () => {
    if (latched) { void stopTalking(); return; }
    if (performance.now() - pressAt.current < HOLD_MS) setLatched(true);
    else void stopTalking();
  };

  // Space bar = hold to talk; Escape closes.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { speech.stop(); onClose(); }
      if (e.key === ' ' && !e.repeat && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); void startTalking(); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); void stopTalking(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [startTalking, stopTalking, speech, onClose]);

  const poke = () => {
    unlockAudio();
    const r = tapReaction(taps.current++);
    react(r.kind);
    say(r.say, 2200);
    if (!speech.speaking && !listener.listening && !thinking) void speech.speak(r.say.replace(/[^\p{L}\p{N}\s,.!?’']/gu, ''));
  };

  const vmState: AvatarState = listener.listening ? 'listening' : state === 'sleeping' ? 'idle' : state;
  const rings = listener.listening ? 'listening' : speech.speaking ? 'speaking' : 'idle';
  const status = listener.listening ? strings.listening : thinking ? 'Thinking…' : speech.speaking ? 'Speaking' : `Tap ${avatar.name} to play`;
  const caption = listener.listening ? listener.partial || '…' : streamingText ? streamingText.slice(-240) : lastReply?.text ? lastReply.text.slice(0, 240) : '';

  return (
    <div className="voice-overlay vm" role="dialog" aria-modal="true" aria-label="Voice mode">
      <button className="btn ghost vm-close" onClick={() => { speech.stop(); onClose(); }} aria-label="Close voice mode">✕</button>
      <div className="vm-stage">
        <PulseRings levelRef={levelRef} mouthRef={speech.mouth} active={rings} />
        {bubble && <div className="vm-bubble" aria-live="polite" key={bubble}>{bubble}</div>}
        <Avatar settings={avatar} state={vmState} size={250} mouthRef={speech.mouth} levelRef={levelRef} reaction={reaction} followPointer onTap={poke} reducedMotion={reducedMotion} />
      </div>
      <div className="vm-status chip" aria-live="polite">{status}</div>
      <p className="vm-caption" aria-live="polite">{caption}</p>
      <button
        className={`vm-talk ${listener.listening ? 'on' : ''}`}
        aria-pressed={listener.listening}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => void stopTalking()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); void startTalking(); } }}
        onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void stopTalking(); } }}
      >
        <span aria-hidden>{listener.listening ? '■' : '🎤'}</span>
        {listener.listening ? (latched ? 'Tap to send' : 'Release to send') : strings.holdToTalk}
      </button>
      <p className="hint vm-hint">
        Hold to talk, or tap once and tap again when you&apos;re done ·{' '}
        {speech.engine === 'natural' ? 'Natural voice' : 'Device voice'} · <Link href="/avatar">change voice</Link>
      </p>
      <p className="disclosure">{BRAND.aiDisclosure}</p>
    </div>
  );
}
