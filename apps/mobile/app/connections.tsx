import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import type { Connection, ConnectorInfo } from '@muse/core';
import { api } from '../src/api';
import { useTheme } from '../src/theme';
import { Button, Card, Chip, Field, Screen, Toggle } from '../src/ui';

function ConnectorCard({ c, conn, reload }: { c: ConnectorInfo; conn?: Connection; reload: () => void }) {
  const th = useTheme();
  const [scopes, setScopes] = useState<string[]>(conn?.scopes ?? ['read']);
  useEffect(() => { if (conn) setScopes(conn.scopes); }, [conn]);
  const save = async () => {
    try {
      const r = conn ? await api.updateScopes(conn.id, scopes) : await api.connect(c.id, scopes);
      if (r.authorizeUrl) await Linking.openURL(r.authorizeUrl);
      reload();
    } catch (e) { Alert.alert('Connection failed', (e as Error).message); }
  };
  return (
    <Card>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>{c.name}</Text>
      {c.kind === 'demo' && <Chip label="Demo data" />}
      {conn && <Chip label={`Connected · ${conn.account}`} tone="ok" />}
      <Text style={{ color: th.textMuted }}>{c.description}</Text>
      {c.scopes.map((sc) => <Toggle key={sc.id} label={sc.label} hint={sc.description} value={scopes.includes(sc.id)} onChange={(v) => setScopes((x) => (v ? [...x, sc.id] : x.filter((y) => y !== sc.id)))} />)}
      {c.available ? <Button label={conn ? 'Save permissions' : 'Connect'} disabled={!scopes.length} onPress={() => void save()} /> : <Text style={{ color: th.textMuted }}>Not configured on the server.</Text>}
      {conn && <Button kind="ghost" label="Disconnect & revoke" onPress={async () => { await api.disconnect(conn.id); reload(); }} />}
    </Card>
  );
}

export default function Connections() {
  const th = useTheme();
  const [cons, setCons] = useState<ConnectorInfo[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [vault, setVault] = useState<{ id: string; service: string; username: string }[]>([]);
  const [f, setF] = useState({ service: '', username: '', password: '' });
  const load = useCallback(async () => {
    const [a, b, v] = await Promise.all([api.connectors(), api.connections(), api.vaultList()]);
    setCons(a.connectors); setConns(b.connections); setVault(v.items);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <Screen lead="Choose which apps the agent may use and exactly what it can do. Revoke any time.">
      {cons.map((c) => <ConnectorCard key={c.id} c={c} conn={conns.find((x) => x.connector === c.id)} reload={() => void load()} />)}
      <Card>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', color: th.text }}>Saved logins (vault)</Text>
        <Text style={{ color: th.textMuted }}>Encrypted. The agent can use them on the matching site with your approval, but never sees the password.</Text>
        {vault.map((i) => <Text key={i.id} style={{ color: th.text }}>🔒 {i.service} · {i.username}</Text>)}
        <Field label="Website" value={f.service} onChangeText={(service) => setF({ ...f, service })} autoCapitalize="none" />
        <Field label="Username or email" value={f.username} onChangeText={(username) => setF({ ...f, username })} autoCapitalize="none" />
        <Field label="Password" value={f.password} onChangeText={(password) => setF({ ...f, password })} secureTextEntry />
        <Button label="Save login" disabled={!f.service || !f.username || !f.password} onPress={async () => { await api.vaultPut(f.service, f.username, f.password); setF({ service: '', username: '', password: '' }); void load(); }} />
      </Card>
    </Screen>
  );
}
