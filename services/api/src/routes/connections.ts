import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { appendAudit, getConnection, listConnections, mapConnection } from '@muse/db';
import { CONNECTOR_SCOPES } from '@muse/security';
import { ConnectorError, USER_CONNECTORS } from '../connectors/index.js';
import type { Deps } from '../deps.js';

export function connectionRoutes(app: FastifyInstance, d: Deps) {
  const auth = { preHandler: app.auth };
  const ctx = (userId: string) => ({ userId, db: d.db, vault: d.vault, cfg: d.cfg, sandbox: d.sandbox });

  app.get('/v1/connectors', auth, async () => ({
    connectors: USER_CONNECTORS.map((id) => d.registry.get(id)!.info(d.cfg)),
  }));

  app.get('/v1/connections', auth, async (req) => ({ connections: await listConnections(d.db, req.user!.id) }));

  app.post('/v1/connectors/:id/connect', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const impl = USER_CONNECTORS.includes(id) ? d.registry.get(id) : undefined;
    if (!impl) return reply.code(404).send({ code: 'not_found', message: 'Unknown connector' });
    const allowed = (CONNECTOR_SCOPES[id] ?? []).map((s) => s.id);
    const scopes = [...new Set(((req.body as { scopes?: string[] })?.scopes ?? []).filter((s) => allowed.includes(s)))];
    if (!scopes.length) return reply.code(400).send({ code: 'invalid', message: 'Pick at least one permission' });
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('base64url');
    try {
      const r = await impl.connect(ctx(userId), scopes, state, challenge);
      if ('authorizeUrl' in r) {
        await d.db.q('INSERT INTO oauth_states(state, user_id, connector, scopes, code_verifier) VALUES ($1,$2,$3,$4,$5)', [state, userId, id, scopes, verifier]);
        return { authorizeUrl: r.authorizeUrl };
      }
      const row = await saveConnection(d, userId, id, scopes, r.account, null);
      return { connection: row };
    } catch (e) {
      if (e instanceof ConnectorError) return reply.code(400).send({ code: e.code, message: e.message });
      throw e;
    }
  });

  // OAuth redirect target (browser navigation, so no auth header: state binds it to the user).
  app.get('/v1/oauth/google/callback', async (req, reply) => {
    const { state, code, error } = req.query as { state?: string; code?: string; error?: string };
    const web = d.cfg.webOrigin[0];
    const st = state ? await d.db.one('DELETE FROM oauth_states WHERE state=$1 AND created_at > now() - interval \'15 minutes\' RETURNING *', [state]) : null;
    if (!st || error || !code) return reply.redirect(`${web}/connections?error=${encodeURIComponent(error ?? 'invalid_state')}`);
    try {
      const impl = d.registry.get(st.connector)!;
      const r = await impl.complete!(ctx(st.user_id), code, st.code_verifier, st.scopes);
      await saveConnection(d, st.user_id, st.connector, st.scopes, r.account, r.vaultId);
      return reply.redirect(`${web}/connections?connected=${st.connector}`);
    } catch (e) {
      return reply.redirect(`${web}/connections?error=${encodeURIComponent((e as Error).message.slice(0, 100))}`);
    }
  });

  app.patch('/v1/connections/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const row = await d.db.one("SELECT * FROM connections WHERE id=$1 AND user_id=$2 AND status='active'", [id, userId]);
    if (!row) return reply.code(404).send({ code: 'not_found', message: 'Connection not found' });
    const allowed = (CONNECTOR_SCOPES[row.connector] ?? []).map((s) => s.id);
    const scopes = [...new Set(((req.body as { scopes?: string[] })?.scopes ?? []).filter((s) => allowed.includes(s)))];
    if (!scopes.length) return reply.code(400).send({ code: 'invalid', message: 'Keep at least one permission, or disconnect' });
    const added = scopes.filter((s) => !row.scopes.includes(s));
    const impl = d.registry.get(row.connector)!;
    if (added.length && impl.complete) {
      // Wider access needs fresh consent from Google.
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(24).toString('base64url');
      const r = await impl.connect(ctx(userId), scopes, state, createHash('sha256').update(verifier).digest('base64url'));
      if ('authorizeUrl' in r) {
        await d.db.q('INSERT INTO oauth_states(state, user_id, connector, scopes, code_verifier) VALUES ($1,$2,$3,$4,$5)', [state, userId, row.connector, scopes, verifier]);
        return { connection: mapConnection(row), authorizeUrl: r.authorizeUrl };
      }
    }
    // Narrowing (or demo connectors): enforced immediately by Sentinel + executor.
    const upd = await d.db.one('UPDATE connections SET scopes=$3, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *', [id, userId, scopes]);
    await d.db.tx((c) => appendAudit(c, { userId, kind: 'connection.scopes', actor: 'user', summary: `Changed ${row.connector} permissions to: ${scopes.join(', ')}`, data: { connector: row.connector, scopes } }));
    return { connection: mapConnection(upd) };
  });

  app.delete('/v1/connections/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const row = await d.db.one('SELECT * FROM connections WHERE id=$1 AND user_id=$2', [id, userId]);
    if (!row) return reply.code(404).send({ code: 'not_found', message: 'Connection not found' });
    await d.registry.get(row.connector)?.revoke?.({ ...ctx(userId), vaultId: row.vault_id }).catch(() => {});
    await d.db.q('DELETE FROM connections WHERE id=$1', [id]);
    await d.db.tx((c) => appendAudit(c, { userId, kind: 'connection.revoked', actor: 'user', summary: `Disconnected ${row.connector} and revoked access`, data: { connector: row.connector } }));
    return { ok: true };
  });

  // ---------- saved logins (vault). Values are write-only: never returned. ----------
  app.get('/v1/vault', auth, async (req) => ({
    items: (await d.vault.list(req.user!.id)).map((r) => ({ id: r.id, service: r.service, username: r.username, createdAt: new Date(r.created_at).toISOString() })),
  }));
  app.post('/v1/vault', auth, async (req, reply) => {
    const { service, username, password } = (req.body ?? {}) as Record<string, string>;
    const svc = String(service ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(svc) || !username || !password) return reply.code(400).send({ code: 'invalid', message: 'Website domain, username and password are required' });
    const id = await d.vault.put(req.user!.id, 'login', svc, String(username).slice(0, 200), { password: String(password).slice(0, 500) });
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'vault.saved', actor: 'user', summary: `Saved a login for ${svc}` }));
    return { id };
  });
  app.delete('/v1/vault/:id', auth, async (req) => {
    await d.vault.remove(req.user!.id, (req.params as { id: string }).id);
    await d.db.tx((c) => appendAudit(c, { userId: req.user!.id, kind: 'vault.deleted', actor: 'user', summary: 'Deleted a saved login' }));
    return { ok: true };
  });
}

async function saveConnection(d: Deps, userId: string, connector: string, scopes: string[], account: string, vaultId: string | null) {
  const prev = await getConnection(d.db, userId, connector);
  const row = await d.db.one(
    `INSERT INTO connections(user_id, connector, scopes, account, vault_id, status) VALUES ($1,$2,$3,$4,$5,'active')
     ON CONFLICT (user_id, connector) DO UPDATE SET scopes=EXCLUDED.scopes, account=EXCLUDED.account, vault_id=coalesce(EXCLUDED.vault_id, connections.vault_id), status='active', updated_at=now()
     RETURNING *`,
    [userId, connector, scopes, account, vaultId],
  );
  await d.db.tx((c) => appendAudit(c, { userId, kind: prev ? 'connection.updated' : 'connection.created', actor: 'user', summary: `Connected ${connector} (${scopes.join(', ')})`, data: { connector, scopes, account } }));
  return mapConnection(row);
}
