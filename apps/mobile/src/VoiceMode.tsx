/**
 * Mobile voice mode: a big animated character that listens (ears perk up and wiggle with your voice), nods,
 * thinks, speaks with lip-sync and reacts to what it says. Tap it to play. Hold the button to talk, or tap once
 * to start and tap again to send.
 */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type AvatarSettings, type AvatarState, type Reaction, reactionForReply, reactionForUser, tapReaction } from '@muse/core/avatar';
import { Avatar } from './Avatar';
import { useTheme } from './theme';
import { Disclosure } from './ui';

interface Props {
  visible: boolean;
  avatar: AvatarSettings;
  state: AvatarState;
  reducedMotion?: boolean;
  speech: { speak: (t: string) => Promise<void>; stop: () => void; speaking: boolean; mouth: { current: number }; engine: 'natural' | 'device' };
  listener: { start: () => Promise<void>; stop: () => Promise<string>; listening: boolean; level: number };
  lastReply?: { id: string; text: string } | null;
  streamingText?: string;
  thinking: boolean;
  strings: { listening: string; holdToTalk: string };
  onSay: (text: string) => Promise<void>;
  onClose: () => void;
}

const HOLD_MS = 350;

export function VoiceMode({ visible, avatar, state, reducedMotion, speech, listener, lastReply, streamingText, thinking, strings, onSay, onClose }: Props) {
  const th = useTheme();
  const [reaction, setReaction] = useState<{ kind: Reaction; at: number } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [latched, setLatched] = useState(false);
  const taps = useRef(0);
  const pressAt = useRef(0);
  const levelRef = useRef(0);
  const seen = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  levelRef.current = listener.level;

  const react = useCallback((kind: Reaction) => setReaction({ kind, at: Date.now() }), []);
  const say = useCallback((text: string | null, ms = 3500) => {
    clearTimeout(timer.current);
    setBubble(text);
    if (text) timer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  useEffect(() => {
    if (!visible) return;
    seen.current = lastReply?.id ?? null;
    react('hello');
    say("Hi! I'm all ears 👂 Hold the button and talk to me.", 6000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !lastReply || seen.current === lastReply.id) return;
    seen.current = lastReply.id;
    react(reactionForReply(lastReply.text));
    setBubble(null);
  }, [visible, lastReply, react]);

  const startTalking = async () => {
    if (listener.listening) return;
    speech.stop();
    say(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try { await listener.start(); } catch { say('I need microphone access to hear you.'); }
  };
  const stopTalking = async () => {
    setLatched(false);
    if (!listener.listening) return;
    const said = (await listener.stop().catch(() => '')).trim();
    if (!said) { react('curious'); say("Hmm, I didn't catch that. Try again?"); return; }
    react(reactionForUser(said));
    await onSay(said);
  };

  const poke = () => {
    const r = tapReaction(taps.current++);
    react(r.kind);
    say(r.say, 2200);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
    if (!speech.speaking && !listener.listening && !thinking) void speech.speak(r.say);
  };

  const vmState: AvatarState = listener.listening ? 'listening' : state === 'sleeping' ? 'idle' : state;
  const status = listener.listening ? strings.listening : thinking ? 'Thinking…' : speech.speaking ? 'Speaking' : `Tap ${avatar.name} to play`;
  const caption = listener.listening ? '…' : streamingText ? streamingText.slice(-200) : lastReply?.text?.slice(0, 200) ?? '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { speech.stop(); onClose(); }} accessibilityViewIsModal>
      <SafeAreaView style={{ flex: 1, backgroundColor: th.bg, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close voice mode" onPress={() => { speech.stop(); onClose(); }} style={{ position: 'absolute', top: 54, right: 20, padding: 10 }}>
          <Text style={{ fontSize: 22, color: th.text }}>✕</Text>
        </Pressable>
        <View style={{ minHeight: 64, justifyContent: 'flex-end' }}>
          {bubble ? (
            <View accessibilityLiveRegion="polite" style={{ backgroundColor: th.surface, borderColor: th.border, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, maxWidth: 300 }}>
              <Text style={{ color: th.text, fontWeight: '700', textAlign: 'center' }}>{bubble}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: listener.listening ? '#F4A7A3' : speech.speaking ? '#8FBF73' : th.surfaceAlt, opacity: 0.18 + listener.level * 0.3, transform: [{ scale: 1 + listener.level * 0.15 }] }} />
          <Avatar settings={avatar} state={vmState} size={240} mouthRef={speech.mouth} levelRef={levelRef} reaction={reaction} onTap={poke} reducedMotion={reducedMotion} />
        </View>
        <Text accessibilityLiveRegion="polite" style={{ color: th.text, fontWeight: '800' }}>{status}</Text>
        <Text style={{ color: th.text, fontSize: 16, textAlign: 'center', minHeight: 48 }} numberOfLines={4}>{caption}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={listener.listening ? 'Send' : strings.holdToTalk}
          onPressIn={() => { pressAt.current = Date.now(); if (!latched) void startTalking(); }}
          onPressOut={() => {
            if (latched) { void stopTalking(); return; }
            if (Date.now() - pressAt.current < HOLD_MS) setLatched(true);
            else void stopTalking();
          }}
          style={({ pressed }) => ({ minWidth: 230, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: listener.listening ? th.danger : th.accent, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
          <Text style={{ color: listener.listening ? '#fff' : th.accentText, fontWeight: '800', fontSize: 17 }}>
            {listener.listening ? (latched ? '■  Tap to send' : '■  Release to send') : `🎤  ${strings.holdToTalk}`}
          </Text>
        </Pressable>
        <Text style={{ color: th.textMuted, fontSize: 12, textAlign: 'center' }}>Hold to talk, or tap once and tap again when done · {speech.engine === 'natural' ? 'Natural voice' : 'Device voice'}</Text>
        <Disclosure />
      </SafeAreaView>
    </Modal>
  );
}
