/**
 * Deterministic policy engine. Runs before (and independently of) the LLM review.
 * Rules (in order): unknown op → deny; scope missing → deny; blocked domain → deny; exfiltration → deny;
 * spend over hard limit → deny; send/spend/write/login → ask (mandatory approval); tainted → never auto-allow;
 * reads/navigation → allow; drafts → allow when the user enabled auto-drafts.
 */
import type { ActionClass, Decision, UserSettings } from '@muse/core';
import { type ActionRequest, domainsIn, emailsIn, findOperation, hostMatches } from '@muse/security';

export interface PolicyContext {
  settings: Pick<UserSettings, 'allowedDomains' | 'blockedDomains' | 'autoApproveDrafts'>;
  /** Scopes granted on the action's connector, or null if not connected. */
  grantedScopes: string[] | null;
  spendLimitCents: number;
  globalBlockedDomains: string[];
}

export interface PolicyResult { decision: Decision; reasons: string[]; risk: 'low' | 'medium' | 'high'; needsReview: boolean; exfiltration: boolean }

const MANDATORY_ASK: ActionClass[] = ['send', 'spend', 'write', 'login'];

function recipients(p: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['to', 'cc', 'bcc', 'attendees']) {
    const v = p[k];
    if (typeof v === 'string') out.push(...v.split(/[,;\s]+/));
    if (Array.isArray(v)) out.push(...v.map(String));
  }
  return out.map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
}

function urlHost(p: Record<string, unknown>): string | null {
  const u = (p.url ?? p.checkoutUrl ?? p.pageUrl) as string | undefined;
  if (!u) return null;
  try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
}

export function evaluatePolicy(a: ActionRequest, ctx: PolicyContext): PolicyResult {
  const reasons: string[] = [];
  const op = findOperation(a.connector, a.operation);
  if (!op || op.actionClass !== a.actionClass) {
    return { decision: 'deny', reasons: [`Unknown or mismatched operation ${a.connector}.${a.operation}`], risk: 'high', needsReview: false, exfiltration: false };
  }
  if (op.scope) {
    if (!ctx.grantedScopes) return { decision: 'deny', reasons: [`${a.connector} is not connected`], risk: 'medium', needsReview: false, exfiltration: false };
    if (!ctx.grantedScopes.includes(op.scope)) {
      return { decision: 'deny', reasons: [`Permission "${op.scope}" was not granted for ${a.connector}`], risk: 'medium', needsReview: false, exfiltration: false };
    }
  }
  const host = urlHost(a.payload);
  const blocked = [...ctx.globalBlockedDomains, ...ctx.settings.blockedDomains];
  if (host && hostMatches(host, blocked)) {
    return { decision: 'deny', reasons: [`${host} is on your blocked list`], risk: 'high', needsReview: false, exfiltration: false };
  }

  // Exfiltration: a recipient or destination that appears in untrusted content but never in the user's own words.
  const tainted = a.provenance.taintSources.length > 0;
  const userText = a.provenance.userRequest.toLowerCase();
  const untrusted = (a.provenance.untrustedText ?? '').toLowerCase();
  let exfiltration = false;
  const rcpts = recipients(a.payload);
  const untrustedEmails = new Set(emailsIn(untrusted));
  for (const r of rcpts) {
    if (untrustedEmails.has(r) && !userText.includes(r)) {
      exfiltration = true;
      reasons.push(`Recipient ${r} came from untrusted content, not from you`);
    }
  }
  if (host && domainsIn(untrusted).includes(host) && !userText.includes(host) && ['send', 'spend', 'login'].includes(a.actionClass)) {
    exfiltration = true;
    reasons.push(`Destination ${host} came from untrusted content, not from you`);
  }
  if (exfiltration && ['send', 'spend', 'login', 'write'].includes(a.actionClass)) {
    return { decision: 'deny', reasons, risk: 'high', needsReview: false, exfiltration };
  }

  if (a.actionClass === 'spend') {
    const amount = Number(a.payload.amountCents ?? NaN);
    if (!Number.isFinite(amount) || amount <= 0) return { decision: 'deny', reasons: ['Purchase amount missing or invalid'], risk: 'high', needsReview: false, exfiltration };
    if (amount > ctx.spendLimitCents) return { decision: 'deny', reasons: [`Amount exceeds your limit of ${(ctx.spendLimitCents / 100).toFixed(2)}`], risk: 'high', needsReview: false, exfiltration };
  }

  if (MANDATORY_ASK.includes(a.actionClass)) {
    reasons.push(`${op.label} always needs your approval`);
    if (tainted) reasons.push('This task read content from the web or email; double-check the details');
    const risk = a.actionClass === 'spend' || tainted ? 'high' : 'medium';
    return { decision: 'ask', reasons, risk, needsReview: true, exfiltration };
  }

  if (a.actionClass === 'draft') {
    if (tainted || !ctx.settings.autoApproveDrafts) {
      return { decision: 'ask', reasons: [tainted ? 'Draft based on untrusted content' : 'Auto-drafts are off'], risk: 'low', needsReview: true, exfiltration };
    }
    return { decision: 'allow', reasons: ['Drafts are reversible and auto-approved by your settings'], risk: 'low', needsReview: true, exfiltration };
  }

  // read / navigate
  return { decision: 'allow', reasons: ['Read-only action'], risk: 'low', needsReview: false, exfiltration };
}
