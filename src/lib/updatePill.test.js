import { describe, expect, it } from 'vitest';
import { downloadPercent, updateBusyLabel, updateInFlight, updatePillText } from './updatePill.js';

// The pill is the only update surface while the settings panel is shut: a press used to change nothing
// on screen for a whole 96 MB download, then the window closed before the change could be read.

describe('updatePillText', () => {
  it('offers the version before anything has started', () => {
    expect(updatePillText({ status: 'available', latestVersion: '0.1.6' })).toBe('UPDATE 0.1.6');
  });

  it('does not print a bare UPDATE when the version is missing', () => {
    expect(updatePillText({ status: 'available' })).toBe('UPDATE');
    expect(updatePillText({ status: 'available', latestVersion: null })).toBe('UPDATE');
  });

  it('reports download progress as a number', () => {
    expect(updatePillText({ status: 'downloading', progress: { received: 50, total: 200 }, latestVersion: '0.1.6' }))
      .toBe('DOWNLOADING 25%');
  });

  it('says it is working even with no length to divide by', () => {
    // A CDN that omits content-length must not produce "DOWNLOADING 0%", which reads as stuck.
    expect(updatePillText({ status: 'downloading', progress: null })).toBe('DOWNLOADING…');
    expect(updatePillText({ status: 'downloading', progress: { received: 10 } })).toBe('DOWNLOADING…');
    expect(updatePillText({ status: 'downloading', progress: { received: 10, total: 0 } })).toBe('DOWNLOADING…');
  });

  it('names the install step, which is the moment the window disappears', () => {
    expect(updatePillText({ status: 'installing', latestVersion: '0.1.6' })).toBe('INSTALLING…');
  });

  it('never claims a version is available once the app is quitting', () => {
    // The specific confusion this fixes: "UPDATE 0.1.6" is still on screen while the installer
    // runs and the window closes, so the press looks like it did nothing.
    expect(updatePillText({ status: 'installing', latestVersion: '0.1.6' })).not.toContain('UPDATE 0.1.6');
  });

  it('separates the downloaded step from the installing one', () => {
    expect(updatePillText({ status: 'ready' })).toBe('RESTARTING…');
    expect(updatePillText({ status: 'ready' })).not.toBe(updatePillText({ status: 'installing' }));
  });

  it('admits a failure instead of falling back to the offer', () => {
    // Falling through to "UPDATE 0.1.6" after a failed attempt reads as "press me again" with no
    // sign anything was tried, which is how a silent revert looked before.
    expect(updatePillText({ status: 'error', latestVersion: '0.1.6' })).toBe('UPDATE FAILED');
  });

  it('falls back to the offer for a status it does not know', () => {
    expect(updatePillText({ status: 'idle', latestVersion: '0.1.6' })).toBe('UPDATE 0.1.6');
    expect(updatePillText({ latestVersion: '0.1.6' })).toBe('UPDATE 0.1.6');
    expect(updatePillText()).toBe('UPDATE');
  });
});

describe('downloadPercent', () => {
  it('rounds to a whole percent', () => {
    expect(downloadPercent({ received: 1, total: 3 })).toBe(33);
    expect(downloadPercent({ received: 2, total: 3 })).toBe(67);
  });

  it('starts at zero and reaches a hundred', () => {
    expect(downloadPercent({ received: 0, total: 100 })).toBe(0);
    expect(downloadPercent({ received: 100, total: 100 })).toBe(100);
  });

  it('returns null when there is nothing to divide by', () => {
    expect(downloadPercent(null)).toBe(null);
    expect(downloadPercent(undefined)).toBe(null);
    expect(downloadPercent({})).toBe(null);
    expect(downloadPercent({ received: 5, total: null })).toBe(null);
    expect(downloadPercent({ received: 5, total: -1 })).toBe(null);
    expect(downloadPercent({ received: NaN, total: 10 })).toBe(null);
  });

  it('clamps a length that reports more than it promised', () => {
    // Chunked responses can overshoot the announced length; 118% on screen is a bug report.
    expect(downloadPercent({ received: 118, total: 100 })).toBe(100);
  });
});

describe('updateInFlight', () => {
  it('locks the pill and its dismiss cross while the update runs', () => {
    // A second press restarts the download, and dismissing hides the only progress readout.
    expect(updateInFlight('downloading')).toBe(true);
    expect(updateInFlight('ready')).toBe(true);
    expect(updateInFlight('installing')).toBe(true);
  });

  it('leaves the pill free before and after', () => {
    expect(updateInFlight('available')).toBe(false);
    expect(updateInFlight('idle')).toBe(false);
    expect(updateInFlight('error')).toBe(false);
    expect(updateInFlight(undefined)).toBe(false);
  });
});

describe('updateBusyLabel', () => {
  it('names the step the press is on, for the tooltip', () => {
    expect(updateBusyLabel('downloading')).toContain('downloading');
    expect(updateBusyLabel('installing')).toContain('installer');
    expect(updateBusyLabel('ready')).toContain('installer');
  });
});
