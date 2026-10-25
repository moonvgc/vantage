import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  COOLDOWN_SECONDS, cooldownRemainingMs, cooldownSeconds, isRateLimited,
  markRefreshed, isRefreshAllRateLimited, markRefreshAll, refreshAllCooldownSeconds
} from './rateLimit.js';

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const advance = (ms) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cooldown constants', () => {
  it('exposes a 30 second cooldown', () => {
    expect(COOLDOWN_SECONDS).toBe(30);
  });
});

describe('per-account cooldown', () => {
  it('treats a never-refreshed label as free', () => {
    expect(isRateLimited('never-seen')).toBe(false);
    expect(cooldownSeconds('never-seen')).toBe(0);
    expect(cooldownRemainingMs('never-seen')).toBe(0);
  });

  it('blocks immediately after a refresh', () => {
    markRefreshed('a');
    expect(isRateLimited('a')).toBe(true);
    expect(cooldownSeconds('a')).toBe(30);
  });

  it('counts down in whole seconds, rounded up', () => {
    markRefreshed('b');
    advance(10_000);
    expect(cooldownSeconds('b')).toBe(20);
    advance(19_500);
    expect(cooldownSeconds('b')).toBe(1); // 500ms left rounds up
  });

  it('releases exactly at the cooldown boundary', () => {
    markRefreshed('c');
    advance(30_000);
    expect(isRateLimited('c')).toBe(false);
    expect(cooldownSeconds('c')).toBe(0);
  });

  it('keeps accounts independent', () => {
    markRefreshed('d');
    expect(isRateLimited('d')).toBe(true);
    expect(isRateLimited('e')).toBe(false);
  });

  it('restarts the window when refreshed again', () => {
    markRefreshed('f');
    advance(29_000);
    markRefreshed('f');
    expect(cooldownSeconds('f')).toBe(30);
  });
});

describe('refresh-all cooldown', () => {
  it('is free before any refresh-all', () => {
    expect(isRefreshAllRateLimited()).toBe(false);
    expect(refreshAllCooldownSeconds()).toBe(0);
  });

  it('blocks right after a refresh-all', () => {
    markRefreshAll();
    expect(isRefreshAllRateLimited()).toBe(true);
    expect(refreshAllCooldownSeconds()).toBe(30);
  });

  it('releases at the boundary', () => {
    markRefreshAll();
    advance(30_000);
    expect(isRefreshAllRateLimited()).toBe(false);
    expect(refreshAllCooldownSeconds()).toBe(0);
  });

  it('claims the per-account cooldown for every account it touched', () => {
    // Otherwise a refresh-all could be used to sidestep the per-account gate.
    markRefreshed('g');
    markRefreshed('h');
    advance(31_000);
    expect(isRateLimited('g')).toBe(false);

    markRefreshAll();
    expect(isRateLimited('g')).toBe(true);
    expect(isRateLimited('h')).toBe(true);
    expect(cooldownSeconds('g')).toBe(30);
  });

  it('never reports a negative countdown', () => {
    markRefreshAll();
    advance(60_000);
    expect(refreshAllCooldownSeconds()).toBe(0);
  });
});
