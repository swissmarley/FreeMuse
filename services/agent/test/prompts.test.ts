import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, DEFAULT_SETTINGS } from '@muse/core';
import { orchestratorPrompt } from '../src/prompts.js';
import { modelFor, type AgentDeps } from '../src/runtime.js';

const deps = (allow: boolean) => ({ model: 'muse-spark-1.3', allowContributorMode: allow }) as AgentDeps;

describe('contributor mode model selection', () => {
  it('uses Standard models unless the user consented and the server allows it', () => {
    expect(modelFor(deps(true), DEFAULT_SETTINGS)).toBe('muse-spark-1.3');
    expect(modelFor(deps(true), { ...DEFAULT_SETTINGS, contributorMode: true, contributorConsentAt: null })).toBe('muse-spark-1.3');
    expect(modelFor(deps(true), { ...DEFAULT_SETTINGS, contributorMode: true, contributorConsentAt: '2026-11-18T00:00:00Z', trainingOptOut: false })).toBe('muse-spark-1.3-contributor');
    expect(modelFor(deps(false), { ...DEFAULT_SETTINGS, contributorMode: true, contributorConsentAt: '2026-11-18T00:00:00Z' })).toBe('muse-spark-1.3');
    // The old opt-out flag alone never switches models.
    expect(modelFor(deps(true), { ...DEFAULT_SETTINGS, trainingOptOut: false })).toBe('muse-spark-1.3');
  });
});

describe('prompts', () => {
  it('replies in the chosen language and talks like a phone call on voice', () => {
    const base = { avatar: DEFAULT_AVATAR, connections: [], memories: [] };
    expect(orchestratorPrompt({ ...base, settings: { ...DEFAULT_SETTINGS, language: 'it' } })).toContain('Reply in Italian');
    expect(orchestratorPrompt({ ...base, settings: DEFAULT_SETTINGS })).not.toContain('live voice call');
    expect(orchestratorPrompt({ ...base, settings: DEFAULT_SETTINGS, channel: 'voice' })).toContain('live voice call');
  });
});
