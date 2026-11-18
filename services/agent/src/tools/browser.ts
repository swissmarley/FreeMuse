/**
 * Browser tools drive the user's sandbox. Page text is untrusted. Sensitive clicks (submit/buy/send) are refused by
 * the sandbox itself unless the executor attaches a grant, so they are routed through Sentinel + approval here.
 */
import { wrapUntrusted } from '@muse/security';
import { markUntrusted, type RunContext } from '../context.js';
import { performAction } from '../gateway.js';
import { fn, N, S, type Tool } from './types.js';

async function snapResult(ctx: RunContext, r: { url: string; title: string; text: string }): Promise<string> {
  const src = `web:${r.url}`;
  markUntrusted(ctx, src, r.text);
  return wrapUntrusted(src, `URL: ${r.url}\nTITLE: ${r.title}\n\n${r.text}`);
}

async function call(ctx: RunContext, op: string, args: Record<string, unknown>) {
  try {
    return { ok: true as const, body: await ctx.sandbox.call(ctx.userId, op, args) };
  } catch (e) {
    const err = e as Error & { code?: string; status?: number };
    return { ok: false as const, code: err.code ?? 'error', message: err.message };
  }
}

export const browserTools: Tool[] = [
  {
    def: fn('browser_open', 'Open a web page in your private sandbox browser and get a text snapshot with element refs.', { url: S('Full http(s) URL') }, ['url']),
    label: (a) => { try { return `Opening ${new URL(a.url).hostname}`; } catch { return 'Opening a page'; } },
    async run(ctx, a) {
      await ctx.audit({ kind: 'browser.open', actor: ctx.isSubagent ? 'subagent' : 'agent', summary: `Opened ${String(a.url).slice(0, 200)}`, data: { url: a.url } });
      const r = await call(ctx, 'open', { url: String(a.url) });
      return r.ok ? snapResult(ctx, r.body) : `ERROR: ${r.message}`;
    },
  },
  {
    def: fn('browser_snapshot', 'Get a fresh text snapshot of the current page.', {}),
    label: () => 'Looking at the page',
    async run(ctx) {
      const r = await call(ctx, 'snapshot', {});
      return r.ok ? snapResult(ctx, r.body) : `ERROR: ${r.message}`;
    },
  },
  {
    def: fn('browser_click', 'Click an element by ref. Buttons that submit forms, buy, send or sign up need the user\'s approval (handled automatically).', { ref: S('Element ref like r12'), why: S('One short sentence: what this click does, for the user') }, ['ref', 'why']),
    label: (a) => a.why ? String(a.why).slice(0, 80) : 'Clicking',
    async run(ctx, a, callId) {
      const r = await call(ctx, 'click', { ref: String(a.ref) });
      if (r.ok) return snapResult(ctx, r.body);
      if (r.code === 'needs_approval' || /approval/.test(r.message)) {
        const page = await call(ctx, 'current', {});
        const url = page.ok ? String(page.body.url) : '';
        return performAction(ctx, {
          actionClass: 'send', connector: 'browser', operation: 'submit', callId,
          payload: { ref: String(a.ref), url }, preview: { page: url, action: String(a.why ?? 'Submit form') },
          title: `On ${url ? new URL(url).hostname : 'a website'}: ${String(a.why ?? 'submit a form').slice(0, 120)}`,
        });
      }
      return `ERROR: ${r.message}`;
    },
  },
  {
    def: fn('browser_type', 'Type text into a textbox (never passwords; use browser_login).', { ref: S('Element ref'), text: S('Text to type') }, ['ref', 'text']),
    label: () => 'Filling in a form',
    async run(ctx, a) {
      const r = await call(ctx, 'type', { ref: String(a.ref), text: String(a.text) });
      return r.ok ? 'Typed.' : `ERROR: ${r.message}`;
    },
  },
  {
    def: fn('browser_select', 'Choose an option in a select box by its visible label.', { ref: S('Element ref'), value: S('Option label') }, ['ref', 'value']),
    label: () => 'Choosing an option',
    async run(ctx, a) {
      const r = await call(ctx, 'select', { ref: String(a.ref), value: String(a.value) });
      return r.ok ? snapResult(ctx, r.body) : `ERROR: ${r.message}`;
    },
  },
  {
    def: fn('browser_scroll', 'Scroll the page.', { direction: { type: 'string', enum: ['up', 'down'] } }, ['direction']),
    label: () => 'Scrolling',
    async run(ctx, a) {
      const r = await call(ctx, 'scroll', { direction: a.direction });
      return r.ok ? snapResult(ctx, r.body) : `ERROR: ${r.message}`;
    },
  },
  {
    def: fn('browser_back', 'Go back to the previous page.', {}),
    label: () => 'Going back',
    async run(ctx) {
      const r = await call(ctx, 'back', {});
      return r.ok ? snapResult(ctx, r.body) : `ERROR: ${r.message}`;
    },
  },
  {
    def: fn('browser_login', 'Log in on the current page using the user\'s saved login from the vault. You never see the password. Needs approval.', { reason: S('Why logging in is needed') }, ['reason']),
    label: () => 'Signing in with your saved login',
    async run(ctx, a, callId) {
      const page = await call(ctx, 'current', {});
      if (!page.ok) return `ERROR: ${page.message}`;
      const host = new URL(String(page.body.url)).hostname;
      return performAction(ctx, { actionClass: 'login', connector: 'browser', operation: 'login', callId, payload: { service: host, url: page.body.url }, preview: { site: host, reason: String(a.reason) }, title: `Sign in to ${host} with your saved login` });
    },
  },
];

export const shoppingTools: Tool[] = [
  {
    def: fn('checkout', 'Pay for an item with a single-use virtual card. ALWAYS requires the user\'s approval. Use the exact total incl. shipping.', { merchant: S('Store name or domain'), item: S('What is being bought'), amountCents: N('Total in cents'), currency: S('ISO currency, e.g. EUR'), url: S('Product or checkout page URL') }, ['merchant', 'item', 'amountCents', 'currency']),
    label: (a) => `Preparing purchase: ${a.item}`,
    async run(ctx, a, callId) {
      const payload = { merchant: String(a.merchant), item: String(a.item), amountCents: Math.round(Number(a.amountCents)), currency: String(a.currency ?? 'EUR').toUpperCase(), url: String(a.url ?? '') };
      return performAction(ctx, {
        actionClass: 'spend', connector: 'payments', operation: 'purchase', callId, payload,
        preview: { merchant: payload.merchant, item: payload.item, total: `${(payload.amountCents / 100).toFixed(2)} ${payload.currency}`, page: payload.url },
        title: `Buy ${payload.item} from ${payload.merchant} for ${(payload.amountCents / 100).toFixed(2)} ${payload.currency}`,
      });
    },
  },
];
