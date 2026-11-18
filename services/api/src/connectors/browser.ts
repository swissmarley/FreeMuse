/**
 * Sensitive browser actions executed by the API executor (never directly by the agent):
 *  - submit: click a submit/buy/send control in the sandbox page,
 *  - login: inject a saved credential from the vault into the current page's login form.
 * Credentials travel vault → executor → sandbox; they are never returned to the agent or logged.
 */
import { ConnectorError, type ConnectorImpl } from './types.js';

export const browserConnector: ConnectorImpl = {
  id: 'browser',
  info: () => ({ id: 'browser', name: 'Web browser', description: 'Your private sandbox browser.', kind: 'demo', available: true, scopes: [] }),
  async connect() { return { account: 'sandbox' }; },
  async execute(ctx, op, p) {
    if (op === 'submit') {
      const r = await ctx.sandbox.call(ctx.userId, 'click', { ref: String(p.ref), expectUrl: String(p.url ?? '') }, true);
      return { status: 'submitted', url: r.url, title: r.title };
    }
    if (op === 'login') {
      const page = await ctx.sandbox.call<{ url: string }>(ctx.userId, 'current', {});
      const host = new URL(page.url).hostname;
      const id = await ctx.vault.findLogin(ctx.userId, host);
      if (!id) throw new ConnectorError('no_login', `No saved login for ${host}. Add one under Connections → Saved logins.`);
      const item = await ctx.vault.get<{ password: string }>(ctx.userId, id);
      if (!item) throw new ConnectorError('no_login', 'Saved login missing');
      // Anti-phishing: only fill on the exact service domain the login was saved for.
      if (!(host === item.service || host.endsWith('.' + item.service))) throw new ConnectorError('domain_mismatch', 'Page domain does not match the saved login');
      const r = await ctx.sandbox.call(ctx.userId, 'fill_login', { username: item.username, password: item.secret.password, expectHost: item.service }, true);
      return { status: 'filled', service: item.service, url: r.url };
    }
    throw new ConnectorError('unknown_operation', op);
  },
};
