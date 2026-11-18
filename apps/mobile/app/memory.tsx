import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Memory } from '@muse/core';
import { api } from '../src/api';
import { useMuse } from '../src/store';
import { useTheme } from '../src/theme';
import { Button, Card, Field, Screen } from '../src/ui';

export default function MemoryScreen() {
  const { s } = useMuse();
  const th = useTheme();
  const [mems, setMems] = useState<Memory[]>([]);
  const [add, setAdd] = useState('');
  const load = useCallback(async () => setMems((await api.memories()).memories), []);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <Screen lead={`What ${s.me!.avatar.name} remembers. Delete anything, or say "forget …" in chat.`}>
      <Field label="Add a memory" value={add} onChangeText={setAdd} maxLength={500} />
      <Button label="Add" disabled={!add.trim()} onPress={async () => { await api.addMemory(add.trim()); setAdd(''); void load(); }} />
      {mems.map((m) => (
        <Card key={m.id}>
          <Text style={{ color: th.text }}>{m.content}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: th.textMuted, fontSize: 12 }}>{m.kind} · {m.source}</Text>
            <Button kind="ghost" label="Forget" accessibilityHint={`Deletes: ${m.content}`} onPress={async () => { await api.deleteMemory(m.id); void load(); }} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
