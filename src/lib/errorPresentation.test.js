import { describe, expect, it } from 'vitest';
import { canLaunch, presentError } from './errorPresentation.js';

// PLAY's visibility rule (owned by playGate.js). It is not "did the store load": an expired API token
// is the ordinary result of Riot rotating sessions, and the Riot Client credentials a switch writes are
// a different store, so such an account can still be switched to and launched. What rules PLAY out is
// an entry unusable AS AN ENTRY — another entry's account, or files that could not be read.

describe('canLaunch', () => {
  it('offers PLAY for an account with no error at all', () => {
    expect(canLaunch(undefined)).toBe(true);
    expect(canLaunch(null)).toBe(true);
    expect(canLaunch('')).toBe(true);
  });

  it('offers PLAY for an expired session, because only the store token expired', () => {
    expect(canLaunch('expired')).toBe(true);
  });

  it('offers PLAY when Riot was unreachable — the credentials were never in question', () => {
    expect(canLaunch('network')).toBe(true);
  });

  it('offers PLAY when only the storefront request failed', () => {
    expect(canLaunch('store')).toBe(true);
  });

  it('withholds PLAY from a duplicate entry, which points at another entry account', () => {
    expect(canLaunch('duplicate')).toBe(false);
  });

  it('withholds PLAY when the account files could not be read', () => {
    expect(canLaunch('fs-error')).toBe(false);
  });

  it('withholds PLAY for an unclassified failure', () => {
    // A kind the table does not know means we cannot say the entry is usable.
    expect(canLaunch('unknown')).toBe(false);
    expect(canLaunch('something-nobody-classified')).toBe(false);
  });
});

describe('the presentation table', () => {
  it('decides launchability for every error kind it knows', () => {
    // A guard, not a behaviour test: a kind added without answering "can we launch from this?"
    // would otherwise inherit whatever the fallback happens to be.
    const kinds = ['expired', 'riot-missing', 'fs-error', 'network', 'duplicate', 'store', 'unknown'];
    for (const kind of kinds) {
      expect(typeof presentError('boom', kind).launchable, kind).toBe('boolean');
    }
  });

  it('keeps the recovery copy that justifies the rule', () => {
    // The expired entry tells the user to switch, and PLAY is a switch plus a launch.
    // If that copy ever changes, the reason for canLaunch('expired') went with it.
    expect(presentError('boom', 'expired').action).toBe('switch');
  });
});
