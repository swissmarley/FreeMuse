import type { ApiConfig } from '../config.js';
import { browserConnector } from './browser.js';
import { demoCalendar, demoMail } from './demo.js';
import { gcal, gdrive, gmail } from './google.js';
import { createPaymentProvider, paymentsConnector } from './payments.js';
import type { ConnectorImpl } from './types.js';

export * from './types.js';

export function buildRegistry(cfg: ApiConfig): Map<string, ConnectorImpl> {
  const all = [gmail, gcal, gdrive, demoMail, demoCalendar, browserConnector, paymentsConnector(createPaymentProvider(cfg.paymentProvider, cfg.stripeTestKey))];
  return new Map(all.map((c) => [c.id, c]));
}

/** Connectors shown on the Connections screen (internal ones like browser/payments are always on). */
export const USER_CONNECTORS = ['gmail', 'gcal', 'gdrive'];

/** Permissions pre-selected for one-tap connect. Sending/creating still always needs your approval per action. */
export const RECOMMENDED_SCOPES: Record<string, string[]> = {
  gmail: ['read', 'compose', 'send'],
  gcal: ['read', 'write'],
  gdrive: ['read'],
  demo_mail: ['read', 'compose', 'send'],
  demo_calendar: ['read', 'write'],
};

export const GOOGLE_CONNECTORS = ['gmail', 'gcal', 'gdrive'] as const;
export const DEMO_CONNECTORS = ['demo_mail', 'demo_calendar'] as const;
