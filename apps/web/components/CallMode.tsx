'use client';
/**
 * Voice call with the character, like a real phone call: it rings, picks up and greets you, then it's hands-free.
 * Just talk; when you pause it answers out loud. Talk over it to interrupt. While it works it keeps you company
 * ("one moment, I'm on it"). Mute, captions and a red hang-up button, with a call timer.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BRAND } from '@muse/core/brand';
import { type AvatarSettings, type AvatarState, type Reaction, reactionForReply, reactionForUser, tapReaction } from '@muse/core/avatar';
import { fmt, type Strings } from '@muse/core/i18n';
import { pickFiller, type TtsEngine } from '@muse/core/voice';
import { Avatar } from './Avatar';
import { CallMic, playConnect, playHangup, playRingback } from '../lib/call';
import { audioContext, unlockAudio } from '../lib/voice';

interface Props {
  avatar: AvatarSettings;
  /** Page-level avatar state (thinking / working …). */
  state: AvatarState;
  lang: string;
  t: Strings;
  reducedMotion?: boolean;
  speech: { speak: (t: string) => Promise<void>; stop: () => void; speaking: boolean; mouth: { current: number }; engine: TtsEngine };
  /** The latest assistant message; new ones are spoken. */
  lastReply?: { id: string; text: string } | null;
  streamingText?: string;
  thinking: boolean;
  onSay: (text: string) => Promise<void>;
  onClose: () => void;
}

type Phase = 'ringing' | 'connected' | 'ended' | 'error';
type Turn = 'listening' | 'user' | 'thinking' | 'speaking';

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CallMode({ avatar, state, lang, t, reducedMotion, speech, lastReply, streamingText, thinking, onSay, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('ringing');
  const [turn, setTurn] = useState<Turn>('speaking');
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [partial, setPartial] = useState('');
  const [youSaid, setYouSaid] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [reaction, setReaction] = useState<{ kind: Reaction; at: number } | null>(null);
  const mic = useRef<CallMic | null>(null);
  const levelRef = useRef(0);
  const ringRef = useRef<HTMLDivElement>(null);
  const seenReply = useRef<string | null>(lastReply?.id ?? null);
  const speakGen = useRef(0);
  const fillers = useRef(0);
  const turnRef = useRef<Turn>('speaking');
  const mutedRef = useRef(false);
  const taps = useRef(0);
  const closed = useRef(false);
  const bargedRef = useRef(false);
  // Always use the latest speech engine / callbacks (the voice config loads asynchronously).
  const sp = useRef(speech);
  sp.current = speech;
  const sayRef = useRef(onSay);
  sayRef.current = onSay;

  const react = useCallback((kind: Reaction) => setReaction({ kind, at: performance.now() }), []);
  const setT = useCallback((v: Turn) => {
    turnRef.current = v;
    setTurn(v);
    const m = mic.current;
    if (!m) return;
    if (mutedRef.current) m.setMode('off');
    else m.setMode(v === 'listening' || v === 'user' ? 'listen' : v === 'speaking' ? 'barge' : 'off');
  }, []);

  /** Say something; when it finishes (and wasn't interrupted), go back to listening. */
  const say = useCallback(async (text: string, after: Turn = 'listening') => {
    const my = ++speakGen.current;
    setT('speaking');
    await sp.current.speak(text);
    if (my === speakGen.current && !closed.current && turnRef.current === 'speaking') setT(after);
  }, [setT]);

  // Ring, pick up, say hello.
  useEffect(() => {
    let cancelled = false;
    unlockAudio();
    (async () => {
      const m = new CallMic(lang, {
        level: (v) => { levelRef.current = v; },
        speechStart: (barge) => {
          bargedRef.current = barge;
          if (barge) { speakGen.current++; sp.current.stop(); react('curious'); }
          setPartial('');
          setT('user');
        },
        partial: (p) => setPartial(p),
        blip: () => { if (turnRef.current === 'user') setT('listening'); },
        utterance: (text) => {
          setPartial('');
          // An interruption with no words was most likely noise or echo: just listen, don't nag.
          if (!text) { if (bargedRef.current) setT('listening'); else void say(t.callDidntCatch); return; }
          setYouSaid(text);
          react(reactionForUser(text));
          fillers.current = 0;
          setT('thinking');
          void sayRef.current(text).catch(() => setT('listening'));
        },
      });
      try {
        await m.start();
      } catch {
        if (!cancelled) setPhase('error');
        return;
      }
      if (cancelled) { m.stop(); return; }
      mic.current = m;
      m.setMode('off');
      try { await playRingback(audioContext()); } catch { /* no audio */ }
      if (cancelled) return;
      try { playConnect(audioContext()); } catch { /* no audio */ }
      setPhase('connected');
      setStartedAt(Date.now());
      react('hello');
      await say(fmt(t.callGreeting, { name: avatar.name }));
    })();
    return () => {
      cancelled = true;
      closed.current = true;
      sp.current.stop();
      mic.current?.stop();
      mic.current = null;
    };
    // The call is set up once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Speak each new reply.
  useEffect(() => {
    if (phase !== 'connected' || !lastReply || seenReply.current === lastReply.id) return;
    seenReply.current = lastReply.id;
    react(reactionForReply(lastReply.text));
    void say(lastReply.text);
  }, [phase, lastReply, react, say]);

  // While the agent works for a while, keep the caller company (once or twice per turn, not on top of a reply).
  useEffect(() => {
    if (phase !== 'connected' || turn !== 'thinking') return;
    const id = setTimeout(() => {
      if (turnRef.current !== 'thinking' || streamingText || fillers.current >= 2) return;
      void say(t[pickFiller(fillers.current++ + taps.current)], 'thinking');
    }, fillers.current === 0 ? 2600 : 9000);
    return () => clearTimeout(id);
  }, [phase, turn, thinking, streamingText, say, t]);

  // If the agent finished without a spoken reply (error), go back to listening.
  useEffect(() => {
    if (!thinking && turnRef.current === 'thinking') {
      const id = setTimeout(() => { if (turnRef.current === 'thinking') setT('listening'); }, 1500);
      return () => clearTimeout(id);
    }
  }, [thinking, setT]);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  // Pulse rings with your voice or its voice (DOM-updated, no re-renders).
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      const target = turnRef.current === 'speaking' ? speech.mouth.current : turnRef.current === 'user' || turnRef.current === 'listening' ? levelRef.current : 0;
      smooth += (target - smooth) * 0.25;
      ringRef.current?.style.setProperty('--pulse', smooth.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speech.mouth]);

  const hangUp = useCallback(() => {
    closed.current = true;
    speakGen.current++;
    sp.current.stop();
    mic.current?.stop();
    mic.current = null;
    try { playHangup(audioContext()); } catch { /* no audio */ }
    setPhase('ended');
    setTimeout(onClose, 650);
  }, [onClose]);

  const toggleMute = () => {
    const m = !mutedRef.current;
    mutedRef.current = m;
    setMuted(m);
    setT(turnRef.current === 'user' ? 'listening' : turnRef.current);
  };

  // Escape hangs up, M toggles mute.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hangUp();
      if ((e.key === 'm' || e.key === 'M') && !(e.target instanceof HTMLInputElement)) toggleMute();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hangUp]);

  const poke = () => {
    unlockAudio();
    if (turnRef.current === 'speaking') { speakGen.current++; sp.current.stop(); setT('listening'); return; }
    react(tapReaction(taps.current++).kind);
  };

  const avatarState: AvatarState = phase === 'ringing' ? 'idle' : turn === 'user' || turn === 'listening' ? 'listening' : turn === 'speaking' ? 'speaking' : state === 'sleeping' ? 'thinking' : state === 'idle' ? 'thinking' : state;
  const status = phase === 'ringing' ? fmt(t.calling, { name: avatar.name })
    : phase === 'ended' ? t.callEnded
    : phase === 'error' ? t.callMicNeeded
    : muted ? t.muted
    : turn === 'speaking' ? fmt(t.callSpeaking, { name: avatar.name })
    : turn === 'thinking' ? t.callThinking
    : t.callListening;
  const caption = turn === 'user' ? partial || '…' : turn === 'thinking' ? youSaid : streamingText ? streamingText.slice(-260) : lastReply?.text ? lastReply.text.slice(0, 260) : '';
  const ringsMode = turn === 'speaking' ? 'speaking' : turn === 'user' || turn === 'listening' ? 'listening' : 'idle';
  const engineLabel = speech.engine === 'elevenlabs' ? t.voiceEngineElevenlabs : speech.engine === 'natural' ? t.voiceEngineNatural : t.voiceEngineDevice;

  return (
    <div className={`voice-overlay vm call call-${phase}`} role="dialog" aria-modal="true" aria-label={fmt(t.callName, { name: avatar.name })}>
      <div className="call-top">
        <strong className="call-name">{avatar.name}</strong>
        <span className="call-time" aria-live="off">{phase === 'connected' && startedAt ? clock(now - startedAt) : phase === 'ringing' ? '…' : ''}</span>
      </div>
      <div className="vm-stage">
        <div ref={ringRef} className={`vm-rings vm-${phase === 'ringing' ? 'ringing' : ringsMode}`} aria-hidden><i /><i /><i /></div>
        <Avatar settings={avatar} state={avatarState} size={250} mouthRef={speech.mouth} levelRef={levelRef} reaction={reaction} followPointer onTap={poke} reducedMotion={reducedMotion} />
      </div>
      <div className={`vm-status chip ${muted ? 'warn' : ''}`} aria-live="polite">{status}</div>
      {captions && <p className="vm-caption" aria-live="polite">{caption}</p>}
      {phase === 'error' ? (
        <div className="call-controls"><button className="btn" onClick={onClose}>{t.close}</button></div>
      ) : (
        <div className="call-controls">
          <button className={`call-btn ${muted ? 'on' : ''}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? t.unmute : t.mute} disabled={phase !== 'connected'}>
            <span aria-hidden>{muted ? '🔇' : '🎙️'}</span><small>{muted ? t.unmute : t.mute}</small>
          </button>
          <button className="call-btn end" onClick={hangUp} aria-label={t.endCall}>
            <span aria-hidden>📞</span><small>{t.endCall}</small>
          </button>
          <button className={`call-btn ${captions ? 'on' : ''}`} onClick={() => setCaptions((c) => !c)} aria-pressed={captions} aria-label={t.captions}>
            <span aria-hidden>CC</span><small>{t.captions}</small>
          </button>
        </div>
      )}
      <p className="hint vm-hint">
        {turn === 'speaking' ? t.callInterruptHint : t.callHint} · {engineLabel} · <Link href="/avatar" onClick={hangUp}>{t.changeVoice}</Link>
      </p>
      <p className="disclosure">{BRAND.aiDisclosure}</p>
    </div>
  );
}
