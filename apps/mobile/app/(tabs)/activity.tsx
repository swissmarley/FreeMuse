import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { AuditEvent } from '@muse/core';
import { speechLocale, strings, type Strings } from '@muse/core/i18n';
import { api } from '../../src/api';
import { useMuse } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Card, Chip, Screen } from '../../src/ui';

const WHO: Record<string, keyof Strings> = { user: 'actorUser', agent: 'actorAgent', subagent: 'actorSubagent', sentinel: 'actorSentinel', system: 'actorSystem' };

export default function Activity() {
  const { s } = useMuse();
  const th = useTheme();
  const t = strings(s.me!.settings.language);
  const [d, setD] = useState<{ events: AuditEvent[]; planned: { title: string; step: string }[]; chainValid: boolean } | null>(null);
  const load = useCallback(async () => setD(await api.audit()), []);
  useEffect(() => { void load(); }, [load, s.version]);
  return (
    <Screen title={t.activity} lead={t.activityLead}>
      {d && <Chip label={d.chainValid ? t.chainOk : t.chainBad} tone={d.chainValid ? 'ok' : 'bad'} />}
      {d?.planned.length ? <Card><Text style={{ fontWeight: '800', color: th.text }}>{t.plannedNext}</Text>{d.planned.map((p, i) => <Text key={i} style={{ color: th.textMuted }}>◌ {p.step} ({p.title})</Text>)}</Card> : null}
      {d?.events.map((e) => (
        <View key={e.id} accessible style={{ borderLeftWidth: 3, borderLeftColor: e.actor === 'sentinel' ? th.warning : e.actor === 'user' ? th.success : th.accent, paddingLeft: 10, gap: 2 }}>
          <Text style={{ color: th.textMuted, fontSize: 12 }}>{WHO[e.actor] ? t[WHO[e.actor]!] : e.actor} · {new Date(e.createdAt).toLocaleString(speechLocale(s.me!.settings.language))}</Text>
          <Text style={{ color: th.text }}>{e.summary}</Text>
        </View>
      ))}
    </Screen>
  );
}
