import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Memory } from '@muse/core';
import { fmt, strings, type Strings } from '@muse/core/i18n';
import { api } from '../src/api';

const KIND: Record<string, keyof Strings> = { fact: 'kindFact', preference: 'kindPreference', person: 'kindPerson', goal: 'kindGoal', routine: 'kindRoutine' };
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Field, Screen } from '../src/ui';

export default function MemoryScreen() {
  const { s } = useMuse();
  const th = useTheme();
  const t = strings(s.me!.settings.language);
  const [mems, setMems] = useState<Memory[]>([]);
  const [add, setAdd] = useState('');
  const load = useCallback(async () => setMems((await api.memories()).memories), []);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <Screen lead={fmt(t.memoryLead, { name: s.me!.avatar.name })}>
      <Field label={t.addMemory} value={add} onChangeText={setAdd} maxLength={500} />
      <Button label={t.add} disabled={!add.trim()} onPress={async () => { await api.addMemory(add.trim()); setAdd(''); void load(); }} />
      {mems.map((m) => (
        <Card key={m.id}>
          <Text style={{ color: th.text }}>{m.content}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: th.textMuted, fontSize: 12 }}>{KIND[m.kind] ? t[KIND[m.kind]!] : m.kind} · {fmt(t.fromSource, { source: m.source })}</Text>
            <Button kind="ghost" label={t.forget} accessibilityHint={`${t.forget}: ${m.content}`} onPress={async () => { await api.deleteMemory(m.id); void load(); }} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
