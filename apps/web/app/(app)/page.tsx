'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND } from '@muse/core/brand';
import { type Reaction, reactionForReply, resolveAvatarState, tapReaction } from '@muse/core/avatar';
import { strings } from '@muse/core/i18n';
import { Avatar } from '../../components/Avatar';
import { RichText } from '../../components/RichText';
import { CallMode } from '../../components/CallMode';
import { api } from '../../lib/api';
import { fmt, useMuse } from '../../lib/store';
import { unlockAudio, useListener, useSpeech } from '../../lib/voice';

export default function ChatPage() {
  const { s, send, toast } = useMuse();
  const me = s.me!;
  const t = strings(me.settings.language);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<{ fileId: string; name: string }[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [greeting, setGreeting] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [lastActive, setLastActive] = useState(Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const speech = useSpeech(me.avatar.voice, me.settings.language);
  const listener = useListener(me.settings.language);
  const [reaction, setReaction] = useState<{ kind: Reaction; at: number } | null>(null);
  const taps = useRef(0);
  const reactedFor = useRef<string | null>(null);

  useEffect(() => { const id = setTimeout(() => setGreeting(false), 2600); return () => clearTimeout(id); }, []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(id); }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [s.messages.length, s.streaming?.text, s.activities.length]);

  // Replies during a call are spoken by the call screen.
  const lastMsg = s.messages.at(-1);

  // Little reactions in the header too: to each new reply, and when you poke the character.
  useEffect(() => {
    if (!lastMsg || lastMsg.role === 'user' || reactedFor.current === lastMsg.id) return;
    const first = reactedFor.current === null;
    reactedFor.current = lastMsg.id;
    if (!first && !voiceMode) setReaction({ kind: reactionForReply(lastMsg.text), at: performance.now() });
  }, [lastMsg, voiceMode]);

  const state = resolveAvatarState({
    greeting, thinking: s.thinking, speaking: speech.speaking, justCompleted: now - s.completedAt < 3000,
    tasksRunning: s.tasksRunning, idleMs: now - lastActive,
  });

  const submit = async (value = text, channel: 'text' | 'voice' = 'text') => {
    const v = value.trim();
    if (!v || (busy && channel === 'text')) return;
    setBusy(true);
    setLastActive(Date.now());
    try {
      await send(v, channel === 'voice' ? [] : attachments.map((a) => ({ fileId: a.fileId })), channel);
      if (channel === 'voice') return;
      setText('');
      setAttachments([]);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File) => {
    if (f.size > 10 * 1024 * 1024) return toast(t.fileTooBig);
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    try {
      const { fileId } = await api.uploadFile(f.name, f.type || 'text/plain', btoa(bin));
      setAttachments((a) => [...a, { fileId, name: f.name }]);
    } catch (e) { toast((e as Error).message); }
  };

  const openVoice = () => {
    unlockAudio();
    speech.stop();
    setVoiceMode(true);
  };

  const holdStart = async () => {
    try { speech.stop(); await listener.start(); } catch { toast(t.micUnavailable); }
  };
  const holdEnd = async () => {
    if (!listener.listening) return;
    const said = await listener.stop().catch(() => '');
    if (said) await submit(said);
  };

  const pendingNote = useMemo(() => (s.pendingApprovals ? fmt(t.waitingForOk, { count: s.pendingApprovals }) : null), [s.pendingApprovals, t]);

  return (
    <section className="chat" aria-label={t.chat}>
      <header className="chat-header">
        <Avatar settings={me.avatar} state={state} size={64} mouthRef={speech.speaking ? speech.mouth : undefined} reducedMotion={me.settings.reducedMotion}
          reaction={reaction} onTap={voiceMode ? undefined : () => { setLastActive(Date.now()); setReaction({ kind: tapReaction(taps.current++).kind, at: performance.now() }); }} />
        <div style={{ flex: 1 }}>
          <h1>{me.avatar.name}</h1>
          <div className="muted" style={{ fontSize: '.85rem' }} aria-live="polite">
            {s.thinking ? t.statusThinking : s.tasksRunning ? fmt(t.statusWorking, { count: s.tasksRunning }) : s.online ? t.statusHere : t.statusConnecting}
          </div>
        </div>
        {pendingNote ? <Link className="chip warn" href="/approvals">{pendingNote}</Link> : null}
        <button className="btn call-start" onClick={openVoice} aria-label={fmt(t.callName, { name: me.avatar.name })}>📞 {t.call}</button>
      </header>
      <p className="disclosure">{BRAND.aiDisclosure}</p>

      <div className="messages" ref={listRef} role="log" aria-live="polite" aria-label={t.messages}>
        {s.messages.length === 0 && (
          <div className="empty pop">
            <p style={{ fontSize: '1.2rem', fontWeight: 800 }}>{fmt(t.welcomeTitle, { name: me.avatar.name })}</p>
            <p>{t.welcomeBody}</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              {[t.example1, t.example2, t.example3].map((x) => (
                <button key={x} className="chip" onClick={() => setText(x)}>{x}</button>
              ))}
            </div>
          </div>
        )}
        {s.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`} aria-label={m.role === 'user' ? t.youSaid : fmt(t.nameSaid, { name: me.avatar.name })}>
            {m.role === 'proactive' && <div className="muted" style={{ fontSize: '.75rem', fontWeight: 800 }}>{t.suggestion}</div>}
            <RichText text={m.text} />
            {m.citations?.length ? <div className="cites">{m.citations.slice(0, 6).map((c) => <a key={c.url} className="chip" href={c.url} target="_blank" rel="noopener noreferrer">{c.title ?? new URL(c.url).hostname}</a>)}</div> : null}
            {(m.meta as { approvals?: string[] } | undefined)?.approvals?.length ? <div className="cites"><Link className="chip warn" href="/approvals">{t.reviewInApprovals}</Link></div> : null}
          </div>
        ))}
        {(s.thinking || s.activities.length > 0) && (
          <div className="activity" aria-label={t.whatImDoing}>
            {s.activities.length > 5 && <span className="muted" style={{ fontSize: '.8rem' }}>{fmt(t.earlierSteps, { count: s.activities.length - 5 })} · <Link href="/activity">{t.seeActivity}</Link></span>}
            {s.activities.slice(-5).map((a) => (
              <span key={a.callId} className={`chip ${a.done ? (a.ok ? 'ok' : 'bad') : ''}`}>{a.done ? (a.ok ? '✓' : '!') : '⏳'} {a.label}{a.done && a.summary && a.summary !== 'Done' ? ` · ${a.summary}` : ''}</span>
            ))}
          </div>
        )}
        {s.streaming?.text ? <div className="bubble assistant"><RichText text={s.streaming.text} /></div> : s.thinking ? <div className="bubble assistant typing" aria-label={t.statusThinking}><i /><i /><i /></div> : null}
      </div>

      <div className="composer">
        {attachments.length > 0 && <div className="row" style={{ maxWidth: 860, margin: '0 auto 8px' }}>{attachments.map((a) => <span key={a.fileId} className="chip">📎 {a.name}</span>)}</div>}
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input ref={fileRef} type="file" hidden accept=".txt,.md,.json,.pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          <button type="button" className="icon-btn" aria-label={t.attachFile} onClick={() => fileRef.current?.click()}>📎</button>
          <label className="sr-only" htmlFor="composer">{fmt(t.composerPlaceholder, { name: me.avatar.name })}</label>
          <textarea id="composer" className="input" rows={1} value={listener.listening ? listener.partial || t.listening : text} placeholder={fmt(t.composerPlaceholder, { name: me.avatar.name })}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} readOnly={listener.listening} />
          <button type="button" className={`icon-btn ${listener.listening ? 'recording' : ''}`} aria-label={t.holdToTalk} aria-pressed={listener.listening}
            onPointerDown={() => void holdStart()} onPointerUp={() => void holdEnd()} onPointerLeave={() => void holdEnd()}
            onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !listener.listening) { e.preventDefault(); void holdStart(); } }}
            onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') void holdEnd(); }}>🎤</button>
          <button className="btn" type="submit" disabled={busy || !text.trim()}>{t.send}</button>
        </form>
      </div>

      {voiceMode && (
        <CallMode
          avatar={me.avatar}
          state={state}
          lang={me.settings.language}
          t={t}
          reducedMotion={me.settings.reducedMotion}
          speech={speech}
          lastReply={lastMsg && lastMsg.role !== 'user' ? { id: lastMsg.id, text: lastMsg.text } : null}
          streamingText={s.streaming?.text}
          thinking={s.thinking}
          onSay={(said) => submit(said, 'voice')}
          onClose={() => setVoiceMode(false)}
        />
      )}
    </section>
  );
}
