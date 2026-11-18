import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { AuditEvent } from '@muse/core';
import { api } from '../../src/api';
import { useMuse } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Card, Chip, Screen } from '../../src/ui';

const WHO: Record<string, string> = { user: 'You', agent: 'Agent', subagent: 'Helper', sentinel: 'Sentinel', system: 'System' };

export default function Activity() {
  const { s } = useMuse();
  const th = useTheme();
  const [d, setD] = useState<{ events: AuditEvent[]; planned: { title: string; step: string }[]; chainValid: boolean } | null>(null);
  const load = useCallback(async () => setD(await api.audit()), []);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <Screen title="Activity" lead="Everything done for you, and what's planned next.">
      {d && <Chip label={d.chainValid ? '✓ Audit trail verified' : '⚠ Integrity check failed'} tone={d.chainValid ? 'ok' : 'bad'} />}
      {d?.planned.length ? <Card><Text style={{ fontWeight: '800', color: th.text }}>Planned next</Text>{d.planned.map((p, i) => <Text key={i} style={{ color: th.textMuted }}>◌ {p.step} ({p.title})</Text>)}</Card> : null}
      {d?.events.map((e) => (
        <View key={e.id} accessible style={{ borderLeftWidth: 3, borderLeftColor: e.actor === 'sentinel' ? th.warning : e.actor === 'user' ? th.success : th.accent, paddingLeft: 10, gap: 2 }}>
          <Text style={{ color: th.textMuted, fontSize: 12 }}>{WHO[e.actor]} · {new Date(e.createdAt).toLocaleString()}</Text>
          <Text style={{ color: th.text }}>{e.summary}</Text>
        </View>
      ))}
    </Screen>
  );
}
