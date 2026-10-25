import { describe, expect, it } from 'vitest';
import { loginStateInfo, needsSignIn } from './loginState.js';

describe('loginState', () => {
  it('describes every state the dashboard sends', () => {
    for (const state of ['active', 'ok', 'unknown', 'expired', 'missing']) expect(loginStateInfo(state)?.label).toBeTruthy();
    expect(loginStateInfo('nonsense')).toBeNull();
  });

  it('asks for a sign-in only when the saved login cannot be used', () => {
    expect(needsSignIn('expired')).toBe(true);
    expect(needsSignIn('missing')).toBe(true);
    expect(needsSignIn('ok')).toBe(false);
    expect(needsSignIn('active')).toBe(false);
    expect(needsSignIn(undefined)).toBe(false);
  });
});
