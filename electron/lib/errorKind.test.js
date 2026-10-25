import { describe, it, expect } from 'vitest';
import { classifyError, isValidKind, fail } from './errorKind.js';

describe('classifyError', () => {
  it('classifies an expired session', () => {
    expect(classifyError('Saved API session expired. Switch to this account, then refresh and save it again.'))
      .toBe('expired');
  });

  it('classifies the real EPERM file-lock failure', () => {
    const real = "EPERM: operation not permitted, rename 'C:\\Users\\user\\AppData\\Roaming\\valorant-account-manager\\accounts\\index.vam.a1b2.tmp' -> 'C:\\Users\\user\\AppData\\Roaming\\valorant-account-manager\\accounts\\index.vam'";
    expect(classifyError(real)).toBe('fs-error');
  });

  it('classifies the other filesystem errno codes', () => {
    expect(classifyError('EACCES: permission denied')).toBe('fs-error');
    expect(classifyError('EBUSY: resource busy or locked')).toBe('fs-error');
    expect(classifyError('ENOENT: no such file or directory')).toBe('fs-error');
  });

  it('classifies network failures', () => {
    expect(classifyError('Request took too long.')).toBe('network');
    expect(classifyError('connect ECONNREFUSED 127.0.0.1:443')).toBe('network');
    expect(classifyError('fetch failed')).toBe('network');
    expect(classifyError('getaddrinfo EAI_AGAIN')).toBe('network');
  });

  it('classifies duplicate saved sessions', () => {
    expect(classifyError('This saved session duplicates “main”. It was not loaded as a second account.'))
      .toBe('duplicate');
    expect(classifyError('This Riot account is already saved as “main”.')).toBe('duplicate');
  });

  it('classifies a Riot Client that is not where it was looked for', () => {
    // Ahead of the filesystem rule on purpose: a missing client arrives as a message full of
    // ENOENT-style paths, which the fs-error rule claims and answers with "close the Riot
    // Client and any antivirus scan in progress" — advice that cannot fix a client installed
    // on another drive.
    expect(classifyError('Riot Client was not found on this PC. Looked in 2 place(s): C:\\Riot Games\\Riot Client\\RiotClientServices.exe. Install Riot Client, or start it once so Windows records where it lives.'))
      .toBe('riot-missing');
  });

  it('classifies storefront failures', () => {
    expect(classifyError('storefront unavailable')).toBe('store');
    expect(classifyError('daily skin offers request failed')).toBe('store');
  });

  it('falls back to unknown for unrecognised messages', () => {
    expect(classifyError('Something nobody predicted.')).toBe('unknown');
  });

  it('falls back to unknown for empty, null and undefined', () => {
    expect(classifyError('')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
  });

  it('honours rule order: the earlier rule wins on a multi-match message', () => {
    // Matches both /expired/ and the EPERM rule; `expired` is listed first, and
    // its recovery (switch & re-save) is the correct one to show.
    expect(classifyError('Saved API session expired after EPERM: operation not permitted'))
      .toBe('expired');
  });

  it('does not match substrings inside unrelated words', () => {
    // \bEPERM\b must not fire on e.g. "EPERMS" or "superperm".
    expect(classifyError('superpermission granted')).toBe('unknown');
  });
});

describe('isValidKind', () => {
  it('accepts every declared kind', () => {
    for (const kind of ['expired', 'riot-missing', 'fs-error', 'network', 'duplicate', 'store', 'unknown']) {
      expect(isValidKind(kind)).toBe(true);
    }
  });

  it('rejects unknown strings and empty values', () => {
    expect(isValidKind('nope')).toBe(false);
    expect(isValidKind('')).toBe(false);
    expect(isValidKind(null)).toBe(false);
    expect(isValidKind(undefined)).toBe(false);
  });
});

describe('fail', () => {
  it('throws an Error carrying the kind', () => {
    const error = fail('expired', 'session gone');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('session gone');
    expect(error.kind).toBe('expired');
  });

  it('degrades an unrecognised kind to unknown rather than passing it through', () => {
    expect(fail('bogus', 'x').kind).toBe('unknown');
  });

  it('preserves the kind for every declared value', () => {
    for (const kind of ['expired', 'riot-missing', 'fs-error', 'network', 'duplicate', 'store', 'unknown']) {
      expect(fail(kind, 'x').kind).toBe(kind);
    }
  });
});
