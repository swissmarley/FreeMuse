import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { appendAudit, getConnection, listConnections, mapConnection } from '@muse/db';
import { CONNECTOR_SCOPES } from '@muse/security';
import { ConnectorError, DEMO_CONNECTORS, GOOGLE_CONNECTORS, RECOMMENDED_SCOPES, USER_CONNECTORS } from '../connectors/index.js';
import { GOOGLE_APP_SERVICE, googleApp, googleAuthorizeUrl, googleExchange, googleScopes, redirectUri, verifyGoogleClient } from '../connectors/google.js';
import type { Deps } from '../deps.js';

export function connectionRoutes(app: FastifyInstance, d: Deps) {
  const auth = { preHandler: app.auth };
  const ctx = (userId: string) => ({ userId, db: d.db, vault: d.vault, cfg: d.cfg, sandbox: d.sandbox });

  app.get('/v1/connectors', auth, async (req) => {
    const google = await googleApp(ctx(req.user!.id));
    return {
      connectors: USER_CONNECTORS.map((id) => {
        const info = d.registry.get(id)!.info(d.cfg);
        return { ...info, available: info.group === 'google' ? !!google : info.available, recommended: RECOMMENDED_SCOPES[id] ?? ['read'] };
      }),
    };
  });

  // ---------- easy setup ----------

  /** Status for the in-app "Set up Google" guide. */
  app.get('/v1/setup/google', auth, async (req) => {
    const g = await googleApp(ctx(req.user!.id));
    return {
      configured: !!g,
      source: g?.source ?? null,
      clientIdHint: g ? `${g.clientId.slice(0, 8)}…${g.clientId.slice(-28)}` : null,
      redirectUri: redirectUri(d.cfg),
      javascriptOrigin: d.cfg.publicUrl,
    };
  });

  /** Save the user's own Google OAuth client (encrypted in their vault), so no server restart or env vars are needed. */
  app.put('/v1/setup/google', auth, async (req, reply) => {
    const userId = req.user!.id;
    const { clientId, clientSecret } = (req.body ?? {}) as { clientId?: string; clientSecret?: string };
    const id = String(clientId ?? '').trim();
    const secret = String(clientSecret ?? '').trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) return reply.code(400).send({ code: 'invalid', message: 'The Client ID should end with .apps.googleusercontent.com' });
    if (secret.length < 10 || secret.length > 200 || /\s/.test(secret)) return reply.code(400).send({ code: 'invalid', message: 'Please paste the Client secret (it usually starts with GOCSPX-)' });
    const ok = await verifyGoogleClient(d.cfg, id, secret);
    if (ok === false) return reply.code(400).send({ code: 'invalid_client', message: 'Google says this Client ID / secret pair is not valid. Check you copied both from the same OAuth client.' });
    await d.vault.put(userId, 'oauth', GOOGLE_APP_SERVICE, 'client', { clientId: id, clientSecret: secret });
    await d.db.tx((c) => appendAudit(c, { userId, kind: 'setup.google', actor: 'user', summary: 'Saved a Google OAuth client for connections' }));
    return { ok: true, verified: ok === true };
  });

  app.delete('/v1/setup/google', auth, async (req) => {
    const userId = req.user!.id;
    const id = await d.vault.findId(userId, 'oauth', GOOGLE_APP_SERVICE);
    if (id) await d.vault.remove(userId, id);
    await d.db.tx((c) => appendAudit(c, { userId, kind: 'setup.google', actor: 'user', summary: 'Removed the saved Google OAuth client' }));
    return { ok: true };
  });

  /**
   * One-tap connect with recommended permissions:
   *  - preset "google": Gmail, Calendar and Drive (or a subset) behind ONE Google consent screen.
   */
  app.post('/v1/connect/quick', auth, async (req, reply) => {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as { preset?: string; connectors?: string[] };
    if (body.preset === 'google') {
      const wanted = GOOGLE_CONNECTORS.filter((c) => !body.connectors?.length || body.connectors.includes(c));
      if (!wanted.length) return reply.code(400).send({ code: 'invalid', message: 'Pick at least one Google service' });
      const scopes = wanted.flatMap((c) => RECOMMENDED_SCOPES[c]!.map((s) => `${c}:${s}`));
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(24).toString('base64url');
      try {
        const url = await googleAuthorizeUrl(ctx(userId), wanted.flatMap((c) => googleScopes(c, RECOMMENDED_SCOPES[c]!)), state, createHash('sha256').update(verifier).digest('base64url'));
        await d.db.q('INSERT INTO oauth_states(state, user_id, connector, scopes, code_verifier) VALUES ($1,$2,$3,$4,$5)', [state, userId, 'google', scopes, verifier]);
        return { authorizeUrl: url };
      } catch (e) {
        if (e instanceof ConnectorError) return reply.code(400).send({ code: e.code, message: e.message });
        throw e;
      }
    }
    return reply.code(400).send({ code: 'invalid', message: 'Unknown preset' });
  });

  app.get('/v1/connections', auth, async (req) => {
    const connections = await listConnections(d.db, req.user!.id);
    if (process.env.ALLOW_DEMO_CONNECTORS === '1') return { connections };
    const hidden = new Set<string>(DEMO_CONNECTORS);
    return { connections: connections.filter((c) => !hidden.has(c.connector)) };
  });

  app.post('/v1/connectors/:id/connect', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    // Demo mail/calendar are not product connections. The automated suite opts in with
    // ALLOW_DEMO_CONNECTORS=1 so it can still exercise approvals against a local mailbox.
    const demoForTests = process.env.ALLOW_DEMO_CONNECTORS === '1' && (DEMO_CONNECTORS as readonly string[]).includes(id);
    const impl = (USER_CONNECTORS.includes(id) || demoForTests) ? d.registry.get(id) : undefined;
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
      if (st.connector === 'google') {
        // One consent for several Google services: one token, shared by each connection.
        const r = await googleExchange(ctx(st.user_id), 'google', code, st.code_verifier);
        const byConnector = new Map<string, string[]>();
        for (const s of st.scopes as string[]) {
          const [c, scope] = s.split(':');
          if (c && scope) byConnector.set(c, [...(byConnector.get(c) ?? []), scope]);
        }
        for (const [c, scopes] of byConnector) await saveConnection(d, st.user_id, c, scopes, r.account, r.vaultId);
        return reply.redirect(`${web}/connections?connected=Google`);
      }
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
    // A token shared with other connections (one Google consent for several services) stays until the last one goes.
    const shared = row.vault_id ? await d.db.one("SELECT 1 FROM connections WHERE user_id=$1 AND vault_id=$2 AND id<>$3 AND status='active' LIMIT 1", [userId, row.vault_id, id]) : null;
    if (!shared) await d.registry.get(row.connector)?.revoke?.({ ...ctx(userId), vaultId: row.vault_id }).catch(() => {});
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
