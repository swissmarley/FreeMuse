/**
 * Mobile voice call with the character, like a phone call: it rings, picks up and greets you, then it's
 * hands-free. Talk, pause, and it answers out loud. Tap it to interrupt. Mute, speaker and a red hang-up button.
 */
import * as Haptics from 'expo-haptics';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type AvatarSettings, type AvatarState, type Reaction, reactionForReply, reactionForUser, tapReaction } from '@muse/core/avatar';
import { fmt, type Strings } from '@muse/core/i18n';
import { pickFiller, type TtsEngine } from '@muse/core/voice';
import { Avatar } from './Avatar';
import { MobileCallMic, setCallAudio } from './call';
import { useTheme } from './theme';
import { Disclosure } from './ui';

interface Props {
  visible: boolean;
  avatar: AvatarSettings;
  state: AvatarState;
  lang: string;
  t: Strings;
  reducedMotion?: boolean;
  speech: { speak: (t: string) => Promise<void>; stop: () => void; speaking: boolean; mouth: { current: number }; engine: TtsEngine };
  lastReply?: { id: string; text: string } | null;
  streamingText?: string;
  thinking: boolean;
  onSay: (text: string) => Promise<void>;
  onClose: () => void;
}

type Phase = 'ringing' | 'connected' | 'ended' | 'error';
type Turn = 'listening' | 'user' | 'thinking' | 'speaking';
const clock = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function CallButton({ label, glyph, on, danger, onPress, disabled }: { label: string; glyph: string; on?: boolean; danger?: boolean; onPress: () => void; disabled?: boolean }) {
  const th = useTheme();
  const size = danger ? 74 : 62;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ alignItems: 'center', gap: 6, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? '#D9443F' : on ? th.text : th.surfaceAlt, borderWidth: 1, borderColor: danger ? '#D9443F' : th.border }}>
        <Text style={{ fontSize: 24, color: danger || on ? '#fff' : th.text, transform: danger ? [{ rotate: '135deg' }] : [] }}>{glyph}</Text>
      </View>
      <Text style={{ color: th.textMuted, fontSize: 12, fontWeight: '700', maxWidth: 90, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

export function CallMode({ visible, avatar, state, lang, t, reducedMotion, speech, lastReply, streamingText, thinking, onSay, onClose }: Props) {
  const th = useTheme();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [phase, setPhase] = useState<Phase>('ringing');
  const [turn, setTurn] = useState<Turn>('speaking');
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [level, setLevel] = useState(0);
  const [youSaid, setYouSaid] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [reaction, setReaction] = useState<{ kind: Reaction; at: number } | null>(null);
  const mic = useRef<MobileCallMic | null>(null);
  const levelRef = useRef(0);
  const turnRef = useRef<Turn>('speaking');
  const mutedRef = useRef(false);
  const speakGen = useRef(0);
  const fillers = useRef(0);
  const taps = useRef(0);
  const seen = useRef<string | null>(null);
  const closed = useRef(true);
  const sp = useRef(speech);
  sp.current = speech;
  const sayRef = useRef(onSay);
  sayRef.current = onSay;
  levelRef.current = level;

  const react = useCallback((kind: Reaction) => setReaction({ kind, at: Date.now() }), []);
  const setT = useCallback((v: Turn) => {
    turnRef.current = v;
    setTurn(v);
    const m = mic.current;
    if (!m || closed.current) return;
    if (!mutedRef.current && v === 'listening') void m.listen();
    else if (v !== 'user') void m.pause();
  }, []);
  const say = useCallback(async (text: string, after: Turn = 'listening') => {
    const my = ++speakGen.current;
    setT('speaking');
    await sp.current.speak(text);
    if (my === speakGen.current && !closed.current && turnRef.current === 'speaking') setT(after);
  }, [setT]);

  // Ring, pick up, greet.
  useEffect(() => {
    if (!visible) return;
    closed.current = false;
    seen.current = lastReply?.id ?? null;
    setPhase('ringing');
    setMuted(false); mutedRef.current = false;
    let cancelled = false;
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => ({ granted: false }));
      if (!perm.granted) { setPhase('error'); return; }
      await setCallAudio(true, !speaker);
      mic.current = new MobileCallMic(recorder, lang, {
        level: (v) => setLevel(v),
        speechStart: () => setT('user'),
        blip: () => { if (turnRef.current === 'user') setT('listening'); },
        utterance: (text) => {
          if (closed.current) return;
          if (!text) { void say(t.callDidntCatch); return; }
          setYouSaid(text);
          react(reactionForUser(text));
          fillers.current = 0;
          setT('thinking');
          void sayRef.current(text).catch(() => setT('listening'));
        },
      });
      for (let i = 0; i < 2 && !cancelled; i++) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        await new Promise((r) => setTimeout(r, 1100));
      }
      if (cancelled) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhase('connected');
      setStartedAt(Date.now());
      react('hello');
      await say(fmt(t.callGreeting, { name: avatar.name }));
    })();
    return () => {
      cancelled = true;
      closed.current = true;
      sp.current.stop();
      void mic.current?.stop();
      mic.current = null;
      void setCallAudio(false);
    };
    // One call per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || phase !== 'connected' || !lastReply || seen.current === lastReply.id) return;
    seen.current = lastReply.id;
    react(reactionForReply(lastReply.text));
    void say(lastReply.text);
  }, [visible, phase, lastReply, react, say]);

  useEffect(() => {
    if (phase !== 'connected' || turn !== 'thinking') return;
    const id = setTimeout(() => {
      if (turnRef.current !== 'thinking' || streamingText || fillers.current >= 2) return;
      void say(t[pickFiller(fillers.current++ + taps.current)], 'thinking');
    }, fillers.current === 0 ? 2600 : 9000);
    return () => clearTimeout(id);
  }, [phase, turn, thinking, streamingText, say, t]);

  useEffect(() => {
    if (!thinking && turnRef.current === 'thinking') {
      const id = setTimeout(() => { if (turnRef.current === 'thinking') setT('listening'); }, 1500);
      return () => clearTimeout(id);
    }
  }, [thinking, setT]);

  useEffect(() => { if (!visible) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [visible]);

  const hangUp = () => {
    closed.current = true;
    speakGen.current++;
    sp.current.stop();
    void mic.current?.stop();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPhase('ended');
    setTimeout(onClose, 400);
  };
  const toggleMute = () => {
    const m = !mutedRef.current;
    mutedRef.current = m;
    setMuted(m);
    if (m) void mic.current?.pause();
    else if (turnRef.current === 'listening' || turnRef.current === 'user') setT('listening');
  };
  const toggleSpeaker = () => {
    const s = !speaker;
    setSpeaker(s);
    void setCallAudio(true, !s);
  };
  const poke = () => {
    if (turnRef.current === 'speaking') { speakGen.current++; sp.current.stop(); setT('listening'); return; }
    const r = tapReaction(taps.current++);
    react(r.kind);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
  };

  const avatarState: AvatarState = phase === 'ringing' ? 'idle' : turn === 'user' || turn === 'listening' ? 'listening' : turn === 'speaking' ? 'speaking' : state === 'idle' || state === 'sleeping' ? 'thinking' : state;
  const status = phase === 'ringing' ? fmt(t.calling, { name: avatar.name })
    : phase === 'ended' ? t.callEnded
    : phase === 'error' ? t.callMicNeeded
    : muted ? t.muted
    : turn === 'speaking' ? fmt(t.callSpeaking, { name: avatar.name })
    : turn === 'thinking' ? t.callThinking : t.callListening;
  const caption = turn === 'thinking' ? youSaid : streamingText ? streamingText.slice(-200) : lastReply?.text?.slice(0, 200) ?? '';
  const ring = turn === 'speaking' ? speech.mouth.current : level;
  const engineLabel = speech.engine === 'elevenlabs' ? t.voiceEngineElevenlabs : speech.engine === 'natural' ? t.voiceEngineNatural : t.voiceEngineDevice;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={hangUp} accessibilityViewIsModal>
      <SafeAreaView style={{ flex: 1, backgroundColor: th.bg, alignItems: 'center', justifyContent: 'space-between', padding: 20 }}>
        <View style={{ alignItems: 'center', gap: 2, marginTop: 12 }}>
          <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '800', color: th.text }}>{avatar.name}</Text>
          <Text style={{ color: th.textMuted, fontVariant: ['tabular-nums'] }}>{phase === 'connected' && startedAt ? clock(now - startedAt) : phase === 'ringing' ? '…' : ''}</Text>
        </View>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: turn === 'speaking' ? '#8FBF73' : phase === 'ringing' ? '#8DB7D9' : '#F4A7A3', opacity: 0.16 + ring * 0.3, transform: [{ scale: reducedMotion ? 1 : 1 + ring * 0.15 }] }} />
          <Avatar settings={avatar} state={avatarState} size={240} mouthRef={speech.mouth} levelRef={levelRef} reaction={reaction} onTap={poke} reducedMotion={reducedMotion} />
        </View>
        <View style={{ alignItems: 'center', gap: 8, minHeight: 110 }}>
          <Text accessibilityLiveRegion="polite" style={{ color: muted ? th.warning : th.text, fontWeight: '800', fontSize: 16 }}>{status}</Text>
          <Text style={{ color: th.text, fontSize: 16, textAlign: 'center' }} numberOfLines={4}>{caption}</Text>
        </View>
        {phase === 'error' ? (
          <Pressable accessibilityRole="button" onPress={onClose} style={{ paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, backgroundColor: th.accent }}><Text style={{ color: th.accentText, fontWeight: '800' }}>{t.close}</Text></Pressable>
        ) : (
          <View style={{ flexDirection: 'row', gap: 26, alignItems: 'flex-start' }}>
            <CallButton label={muted ? t.unmute : t.mute} glyph={muted ? '🔇' : '🎙️'} on={muted} onPress={toggleMute} disabled={phase !== 'connected'} />
            <CallButton label={t.endCall} glyph="📞" danger onPress={hangUp} />
            <CallButton label={t.speaker} glyph="🔊" on={speaker} onPress={toggleSpeaker} />
          </View>
        )}
        <Text style={{ color: th.textMuted, fontSize: 12, textAlign: 'center' }}>{turn === 'speaking' ? fmt(t.callTapToInterrupt, { name: avatar.name }) : t.callHint} · {engineLabel}</Text>
        <Disclosure />
      </SafeAreaView>
    </Modal>
  );
}
