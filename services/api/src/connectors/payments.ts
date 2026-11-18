/**
 * Payments: never touches real card data. Every purchase requires user approval (enforced by Sentinel + executor).
 *  - virtual-card-stub (default): issues a fake single-use card (test data only).
 *  - stripe-test: creates and confirms a PaymentIntent in Stripe TEST mode (requires an sk_test_ key; live keys refused).
 */
import { randomInt } from 'node:crypto';
import { ConnectorError, type ConnectorImpl } from './types.js';

export interface PaymentRequest { amountCents: number; currency: string; merchant: string; description: string }
export interface PaymentResult { provider: string; status: 'authorized' | 'succeeded'; last4: string; reference: string; testMode: true }

export interface PaymentProvider {
  readonly name: string;
  pay(req: PaymentRequest): Promise<PaymentResult>;
}

export class VirtualCardStub implements PaymentProvider {
  readonly name = 'virtual-card-stub';
  async pay(req: PaymentRequest): Promise<PaymentResult> {
    const last4 = String(randomInt(0, 10_000)).padStart(4, '0');
    return { provider: this.name, status: 'authorized', last4, reference: `vc_test_${Date.now().toString(36)}_${req.amountCents}`, testMode: true };
  }
}

export class StripeTestProvider implements PaymentProvider {
  readonly name = 'stripe-test';
  constructor(private key: string) {
    if (!key.startsWith('sk_test_')) throw new Error('stripe-test provider only accepts sk_test_ keys (no real money in dev)');
  }
  async pay(req: PaymentRequest): Promise<PaymentResult> {
    const body = new URLSearchParams({
      amount: String(req.amountCents), currency: req.currency.toLowerCase(), payment_method: 'pm_card_visa', confirm: 'true',
      description: `${req.merchant}: ${req.description}`.slice(0, 300), 'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
    });
    const r = await fetch('https://api.stripe.com/v1/payment_intents', { method: 'POST', headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
    const j: any = await r.json();
    if (!r.ok) throw new ConnectorError('payment_failed', j.error?.message ?? `Stripe ${r.status}`);
    return { provider: this.name, status: j.status === 'succeeded' ? 'succeeded' : 'authorized', last4: '4242', reference: j.id, testMode: true };
  }
}

export function createPaymentProvider(name: string, stripeKey?: string): PaymentProvider {
  if (name === 'stripe-test') {
    if (!stripeKey) throw new Error('STRIPE_TEST_SECRET_KEY is required for stripe-test');
    return new StripeTestProvider(stripeKey);
  }
  return new VirtualCardStub();
}

export function paymentsConnector(provider: PaymentProvider): ConnectorImpl {
  return {
    id: 'payments',
    info: () => ({ id: 'payments', name: 'Payments (test mode)', description: 'Single-use virtual cards. Every purchase needs your approval. No real money in this build.', kind: 'demo', available: true, scopes: [] }),
    async connect() { return { account: provider.name }; },
    async execute(ctx, op, p) {
      if (op !== 'purchase') throw new ConnectorError('unknown_operation', op);
      const amountCents = Math.round(Number(p.amountCents));
      if (!Number.isFinite(amountCents) || amountCents <= 0) throw new ConnectorError('bad_request', 'Invalid amount');
      const req: PaymentRequest = { amountCents, currency: String(p.currency ?? 'EUR').slice(0, 3).toUpperCase(), merchant: String(p.merchant ?? '').slice(0, 200), description: String(p.item ?? p.description ?? '').slice(0, 300) };
      const res = await provider.pay(req);
      await ctx.db.q(
        'INSERT INTO purchases(user_id, approval_id, provider, merchant, description, amount_cents, currency, card_last4, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [ctx.userId, ctx.approvalId ?? null, res.provider, req.merchant, req.description, req.amountCents, req.currency, res.last4, res.status],
      );
      return { ...res, merchant: req.merchant, amount: `${(req.amountCents / 100).toFixed(2)} ${req.currency}`, note: 'Test mode: no real money moved.' };
    },
  };
}
