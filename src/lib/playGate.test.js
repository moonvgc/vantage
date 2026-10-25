import { describe, expect, it } from 'vitest';
import { canPlay, playTitle } from './playGate.js';

// Whether PLAY may be pressed for one row; the rule itself is owned by playGate.js. PLAY is not
// disabled on a row that is merely not signed in (a press switches first), only on an entry that is
// unusable as an entry — another entry's account, or files that could not be read.

const signedIn = { label: 'main', active: true };
const other = { label: 'alt', active: false };

describe('canPlay', () => {
  it('allows PLAY for the account that owns the signed-in session', () => {
    expect(canPlay(signedIn)).toBe(true);
  });

  it('allows PLAY for every other row too, because a press switches first', () => {
    expect(canPlay(other)).toBe(true);
  });

  it('allows PLAY while no session is readable at all', () => {
    // The ordinary state of a saved account not opened for a while — the state the whole list sat
    // in on the machine that prompted the rewrite.
    expect(canPlay({ label: 'alt', active: false })).toBe(true);
  });

  it('allows PLAY for an account whose STORE session expired', () => {
    // The store token expiring says nothing about the Riot Client credentials a switch writes —
    // those are a separate store, still on disk.
    expect(canPlay({ ...other, errorKind: 'expired' })).toBe(true);
  });

  it('allows PLAY for an entry whose store merely failed to load', () => {
    expect(canPlay({ ...other, errorKind: 'network' })).toBe(true);
    expect(canPlay({ ...other, errorKind: 'store' })).toBe(true);
  });

  it('refuses for an entry that is unusable as an entry, even when flagged active', () => {
    // Files that could not be read, or an entry pointing at another account's record: switching to
    // one of these cannot work, so offering a launch through it would lie.
    expect(canPlay({ ...signedIn, errorKind: 'fs-error' })).toBe(false);
    expect(canPlay({ ...signedIn, errorKind: 'duplicate' })).toBe(false);
    expect(canPlay({ ...signedIn, errorKind: 'unknown' })).toBe(false);
  });

  it('refuses when there is no account to act on', () => {
    expect(canPlay(null)).toBe(false);
    expect(canPlay(undefined)).toBe(false);
  });
});

describe('playTitle', () => {
  it('says the press is a plain launch when the account is already signed in', () => {
    expect(playTitle(signedIn)).toBe('Launch Valorant — main is signed in');
  });

  it('says the press switches first when the account is not signed in', () => {
    expect(playTitle(other)).toBe('Launch Valorant with alt — switches the Riot Client first');
  });

  it('explains the refusal rather than leaving a muted button unexplained', () => {
    expect(playTitle({ label: 'broken', errorKind: 'fs-error' }))
      .toBe('PLAY is off for broken — its saved login cannot be used to switch');
  });

  it('does not claim a disabled control is launchable', () => {
    // The readable half of the same rule: a title that promises a launch on a row whose button is
    // muted is worse than no title at all.
    expect(playTitle({ label: 'broken', errorKind: 'duplicate' })).toContain('PLAY is off');
  });
});
