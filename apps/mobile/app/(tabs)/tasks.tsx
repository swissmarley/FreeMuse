import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Task } from '@muse/core';
import { fmt, speechLocale, strings, type Strings } from '@muse/core/i18n';
import { api } from '../../src/api';
import { useMuse } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, Screen } from '../../src/ui';

const STATUS: Record<string, keyof Strings> = { queued: 'statusQueued', running: 'statusRunning', waiting_approval: 'statusWaiting', scheduled: 'statusScheduled', done: 'statusDone', failed: 'statusFailed', cancelled: 'statusCancelled' };
const ICON: Record<string, string> = { pending: '○', running: '◐', done: '●', blocked: '⚠', skipped: '–', failed: '✕' };

export default function Tasks() {
  const { s } = useMuse();
  const th = useTheme();
  const t = strings(s.me!.settings.language);
  const [tasks, setTasks] = useState<Task[]>([]);
  const load = useCallback(async () => setTasks((await api.tasks()).tasks), []);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <Screen title={t.workingOn} lead={t.tasksLead}>
      {tasks.length === 0 ? <Text style={{ color: th.textMuted, textAlign: 'center', padding: 24 }}>{t.noActiveTasks}</Text> : tasks.map((task) => (
        <Card key={task.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text, flex: 1 }}>{task.title}</Text>
            <Chip label={STATUS[task.status] ? t[STATUS[task.status]!] : task.status} tone={task.status === 'done' ? 'ok' : task.status === 'waiting_approval' ? 'warn' : task.status === 'failed' ? 'bad' : undefined} />
          </View>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(task.progress * 100) }} style={{ height: 8, borderRadius: 8, backgroundColor: th.surfaceAlt, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(task.progress * 100)}%`, height: '100%', backgroundColor: th.success }} />
          </View>
          {task.plan.map((p) => <Text key={p.id} style={{ color: th.text }}>{ICON[p.status]} {p.title}{p.note ? ` · ${p.note}` : ''}</Text>)}
          {task.nextRunAt && task.status === 'scheduled' ? <Text style={{ color: th.textMuted, fontSize: 13 }}>{fmt(t.nextCheck, { when: new Date(task.nextRunAt).toLocaleString(speechLocale(s.me!.settings.language)) })}</Text> : null}
          {task.result ? <Text style={{ color: th.text }}>{task.result.replace(/\*\*/g, '')}</Text> : null}
          {!['done', 'failed', 'cancelled'].includes(task.status) && <Button kind="ghost" label={t.cancel} onPress={async () => { await api.cancelTask(task.id); void load(); }} />}
        </Card>
      ))}
    </Screen>
  );
}
