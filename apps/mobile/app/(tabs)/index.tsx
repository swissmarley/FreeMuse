import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { type Reaction, reactionForReply, resolveAvatarState, tapReaction } from '@muse/core/avatar';
import { fmt, strings } from '@muse/core/i18n';
import { api } from '../../src/api';
import { Avatar } from '../../src/Avatar';
import { useMuse } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Disclosure } from '../../src/ui';
import { useListener, useSpeech } from '../../src/voice';
import { CallMode } from '../../src/CallMode';

export default function Chat() {
  const { s, send } = useMuse();
  const th = useTheme();
  const router = useRouter();
  const me = s.me!;
  const t = strings(me.settings.language);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ fileId: string; name: string }[]>([]);
  const [greeting, setGreeting] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [voiceMode, setVoiceMode] = useState(false);
  const speech = useSpeech(me.avatar.voice, me.settings.language);
  const listener = useListener(me.settings.language);
  const listRef = useRef<FlatList>(null);
  const [reaction, setReaction] = useState<{ kind: Reaction; at: number } | null>(null);
  const taps = useRef(0);
  const reacted = useRef<string | null>(null);

  useEffect(() => { const a = setTimeout(() => setGreeting(false), 2600); const b = setInterval(() => setNow(Date.now()), 5000); return () => { clearTimeout(a); clearInterval(b); }; }, []);
  const last = s.messages.at(-1);

  useEffect(() => {
    if (!last || last.role === 'user' || reacted.current === last.id) return;
    const first = reacted.current === null;
    reacted.current = last.id;
    if (!first && !voiceMode) setReaction({ kind: reactionForReply(last.text), at: Date.now() });
  }, [last, voiceMode]);
  const openVoice = () => { speech.stop(); setVoiceMode(true); };

  const state = resolveAvatarState({ greeting, thinking: s.thinking, speaking: speech.speaking, justCompleted: now - s.completedAt < 3000, tasksRunning: s.tasksRunning, idleMs: 0 });
  const submit = async (v = text, channel: 'text' | 'voice' = 'text') => {
    if (!v.trim()) return;
    if (channel === 'voice') { await send(v.trim(), [], 'voice'); return; }
    await send(v.trim(), files.map((f) => ({ fileId: f.fileId })));
    setText('');
    setFiles([]);
  };
  const attach = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['text/*', 'application/pdf', 'image/*', 'application/json'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const { fileId } = await api.uploadFile(a.name, a.mimeType ?? 'text/plain', await new File(a.uri).base64());
    setFiles((f) => [...f, { fileId, name: a.name }]);
  };
  const talkStart = async () => { speech.stop(); await listener.start().catch(() => Alert.alert(t.micUnavailable)); };
  const talkEnd = async () => {
    let said = '';
    try { said = await listener.stop(); } catch { Alert.alert(t.callDidntCatch); return; }
    if (said) await submit(said);
  };

  const data = [...s.messages, ...(s.streaming?.text ? [{ id: 'stream', role: 'assistant', text: s.streaming.text } as never] : [])];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: th.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: th.surfaceAlt, borderBottomColor: th.border, borderBottomWidth: 1 }}>
        <Avatar settings={me.avatar} state={state} size={56} mouthRef={speech.speaking ? speech.mouth : undefined} reducedMotion={me.settings.reducedMotion}
          reaction={reaction} onTap={() => setReaction({ kind: tapReaction(taps.current++).kind, at: Date.now() })} />
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: th.text }}>{me.avatar.name}</Text>
          <Text style={{ color: th.textMuted, fontSize: 13 }}>{s.thinking ? t.statusThinking : s.tasksRunning ? fmt(t.statusWorking, { count: s.tasksRunning }) : t.statusHere}</Text>
        </View>
        {s.pendingApprovals > 0 && <Pressable accessibilityRole="button" onPress={() => router.push('/approvals')}><Text style={{ color: th.warning, fontWeight: '800' }}>{fmt(t.waitingForOk, { count: s.pendingApprovals })}</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={fmt(t.callName, { name: me.avatar.name })} onPress={openVoice}
          style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#3FA35B' }}><Text style={{ fontSize: 15, color: '#fff', fontWeight: '800' }}>📞 {t.call}</Text></Pressable>
      </View>
      <Disclosure />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList ref={listRef} data={data} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 12, gap: 10 }} onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          accessibilityLabel={t.messages}
          renderItem={({ item }) => (
            <View accessible accessibilityLabel={`${item.role === 'user' ? t.youSaid : fmt(t.nameSaid, { name: me.avatar.name })}: ${item.text}`} style={{ alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', padding: 12, borderRadius: 22, backgroundColor: item.role === 'user' ? th.userBubble : th.agentBubble, borderWidth: item.role === 'proactive' ? 1 : 0, borderColor: th.border }}>
              {item.role === 'proactive' && <Text style={{ fontSize: 12, fontWeight: '800', color: th.textMuted }}>{t.suggestion}</Text>}
              <Text style={{ color: item.role === 'user' ? th.userBubbleText : th.text, fontSize: 16 }}>{item.text.replace(/\*\*/g, '')}</Text>
            </View>
          )}
          ListFooterComponent={s.activities.length ? <View style={{ gap: 4 }}>{s.activities.slice(-4).map((a) => <Text key={a.callId} style={{ color: a.done ? (a.ok ? th.success : th.danger) : th.textMuted, fontSize: 13 }}>{a.done ? (a.ok ? '✓' : '!') : '⏳'} {a.label}</Text>)}</View> : s.thinking ? <Text style={{ color: th.textMuted }}>…</Text> : undefined}
        />
        {files.length > 0 && <Text style={{ color: th.textMuted, paddingHorizontal: 12 }}>📎 {files.map((f) => f.name).join(', ')}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: th.border, backgroundColor: th.surface, alignItems: 'flex-end' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.attachFile} onPress={() => void attach()} style={{ padding: 10 }}><Text style={{ fontSize: 20 }}>📎</Text></Pressable>
          <TextInput accessibilityLabel={t.composerPlaceholder.replace('{name}', me.avatar.name)} value={listener.listening ? t.listening : text} onChangeText={setText} editable={!listener.listening} multiline
            placeholder={t.composerPlaceholder.replace('{name}', me.avatar.name)} placeholderTextColor={th.textMuted}
            style={{ flex: 1, maxHeight: 120, borderWidth: 1, borderColor: th.border, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, color: th.text, backgroundColor: th.bg }} />
          <Pressable accessibilityRole="button" accessibilityLabel={t.holdToTalk} onPressIn={() => void talkStart()} onPressOut={() => void talkEnd()}
            style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: listener.listening ? th.danger : th.surfaceAlt }}><Text style={{ fontSize: 20 }}>🎤</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t.send} onPress={() => void submit()} style={{ height: 46, paddingHorizontal: 16, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: th.accent }}><Text style={{ color: th.accentText, fontWeight: '800' }}>{t.send}</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
      <CallMode
        visible={voiceMode}
        avatar={me.avatar}
        state={state}
        lang={me.settings.language}
        t={t}
        reducedMotion={me.settings.reducedMotion}
        speech={speech}
        lastReply={last && last.role !== 'user' ? { id: last.id, text: last.text } : null}
        streamingText={s.streaming?.text}
        thinking={s.thinking}
        onSay={(said) => submit(said, 'voice')}
        onClose={() => setVoiceMode(false)}
      />
    </SafeAreaView>
  );
}
