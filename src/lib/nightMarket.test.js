import { describe, expect, it } from 'vitest';
import {
  isNewNightMarket, nightMarketCountdown, nightMarketOpen, nightMarketSignature, sortNightMarketOffers
} from './nightMarket.js';

const market = (ids, endsAt = null) => ({ offers: ids.map((id) => ({ id })), endsAt });

describe('nightMarketSignature', () => {
  it('identifies a window by the offers in it, in any order', () => {
    // Riot does not promise an order: a re-sync that shuffles the SAME window is not a new window.
    expect(nightMarketSignature(market(['a', 'b', 'c']))).toBe(nightMarketSignature(market(['c', 'a', 'b'])));
    expect(nightMarketSignature(market(['a', 'b']))).not.toBe(nightMarketSignature(market(['a', 'b', 'd'])));
  });

  it('is null when there is no window to identify', () => {
    expect(nightMarketSignature(null)).toBeNull();
    expect(nightMarketSignature(undefined)).toBeNull();
    expect(nightMarketSignature(market([]))).toBeNull();
  });
});

describe('isNewNightMarket', () => {
  it('treats an unannounced window as new, including the very first one', () => {
    expect(isNewNightMarket('a|b', undefined)).toBe(true);
    expect(isNewNightMarket('a|b', null)).toBe(true);
  });

  it('does not re-announce a window already seen', () => {
    expect(isNewNightMarket('a|b', 'a|b')).toBe(false);
  });

  it('never announces the absence of a market', () => {
    // The most important guard: without it, every time the market closes the app announces
    // "no market" as something new.
    expect(isNewNightMarket(null, null)).toBe(false);
    expect(isNewNightMarket(null, 'a|b')).toBe(false);
  });
});

describe('nightMarketCountdown / nightMarketOpen', () => {
  it('is open while the countdown has time left', () => {
    expect(nightMarketOpen(market(['a'], 10_000), 9_000)).toBe(true);
    expect(nightMarketOpen(market(['a'], 10_000), 11_000)).toBe(false);
  });

  it('is open with no known end, and closed with no offers', () => {
    // A window with no duration from Riot must still be shown: the offers are real and can be bought.
    expect(nightMarketOpen(market(['a'], null), 9_000)).toBe(true);
    expect(nightMarketOpen(market([], 10_000), 9_000)).toBe(false);
    expect(nightMarketOpen(null, 9_000)).toBe(false);
  });

  it('returns seconds remaining, or null when there is no end', () => {
    expect(nightMarketCountdown(10_000, 1_000)).toBe(9);
    expect(nightMarketCountdown(null, 1_000)).toBeNull();
    expect(nightMarketCountdown(10_000, 99_000)).toBe(0);
  });
});

describe('sortNightMarketOffers', () => {
  const offer = (id, rank, discount) => ({ id, discountPercent: discount, tier: rank === null ? null : { rank, color: '#FFF' } });

  it('puts the highest tier first, and the biggest discount first inside a tier', () => {
    // Tier before discount: 20% on an Ultra skin is worth more than 50% on a Select skin.
    const sorted = sortNightMarketOffers([
      offer('a', 0, 50), offer('b', 2, 34), offer('c', 4, 25), offer('d', 2, 40)
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('sorts a tierless skin last instead of dropping it', () => {
    const sorted = sortNightMarketOffers([offer('none', null, 99), offer('select', 0, 10)]);
    expect(sorted.map((o) => o.id)).toEqual(['select', 'none']);
  });

  it('does not mutate the array it is given', () => {
    // The array belongs to the account payload: sorting in place would change the account state and
    // make the next render differ from the previous one.
    const input = [offer('a', 0, 10), offer('b', 4, 10)];
    sortNightMarketOffers(input);
    expect(input.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('survives an empty or missing list', () => {
    expect(sortNightMarketOffers([])).toEqual([]);
    expect(sortNightMarketOffers(undefined)).toEqual([]);
  });
});
