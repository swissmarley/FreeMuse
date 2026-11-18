import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Task } from '@muse/core';
import { api } from '../../src/api';
import { useMuse } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, Screen } from '../../src/ui';

const ICON: Record<string, string> = { pending: '○', running: '◐', done: '●', blocked: '⚠', skipped: '–', failed: '✕' };

export default function Tasks() {
  const { s } = useMuse();
  const th = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const load = useCallback(async () => setTasks((await api.tasks()).tasks), []);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <Screen title="Working on" lead="Tasks keep going when you close the app. You'll get a notification when something changes.">
      {tasks.length === 0 ? <Text style={{ color: th.textMuted, textAlign: 'center', padding: 24 }}>No tasks yet.</Text> : tasks.map((t) => (
        <Card key={t.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text, flex: 1 }}>{t.title}</Text>
            <Chip label={t.status.replace('_', ' ')} tone={t.status === 'done' ? 'ok' : t.status === 'waiting_approval' ? 'warn' : t.status === 'failed' ? 'bad' : undefined} />
          </View>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(t.progress * 100) }} style={{ height: 8, borderRadius: 8, backgroundColor: th.surfaceAlt, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(t.progress * 100)}%`, height: '100%', backgroundColor: th.success }} />
          </View>
          {t.plan.map((p) => <Text key={p.id} style={{ color: th.text }}>{ICON[p.status]} {p.title}{p.note ? ` · ${p.note}` : ''}</Text>)}
          {t.result ? <Text style={{ color: th.text }}>{t.result.replace(/\*\*/g, '')}</Text> : null}
          {!['done', 'failed', 'cancelled'].includes(t.status) && <Button kind="ghost" label="Cancel" onPress={async () => { await api.cancelTask(t.id); void load(); }} />}
        </Card>
      ))}
    </Screen>
  );
}
