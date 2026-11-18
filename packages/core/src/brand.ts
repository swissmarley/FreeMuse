/**
 * All user-visible brand strings live here so the app can be renamed in one place.
 * Do not add third-party logos or trademarks.
 */
export const BRAND = {
  appName: 'Muse Clone (personal)',
  shortName: 'Muse Clone',
  tagline: 'Your personal agent that gets things done, with you in control.',
  /** EU AI Act transparency: shown on every chat screen and in onboarding. */
  aiDisclosure: 'You are chatting with an AI agent. It can make mistakes and always asks before sensitive actions.',
  supportEmail: 'privacy@localhost',
} as const;
export type Brand = typeof BRAND;
