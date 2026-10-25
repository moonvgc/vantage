import { describe, expect, it } from 'vitest';
import { tierRgb } from './tierColor.js';

// The tier colour comes from Riot as hex, but is used to build rgba(): the border, glow and wash need
// its components separately, so one colour per tier is enough for all of them — without five extra
// constants that could be forgotten when Riot adds a new tier.
describe('tierRgb', () => {
  it('turns a tier hex into the "r, g, b" rgba() needs', () => {
    expect(tierRgb('#D1548D')).toBe('209, 84, 141'); // Premium
    expect(tierRgb('#FAD663')).toBe('250, 214, 99'); // Ultra
  });

  it('accepts the colour without the leading hash, and in lower case', () => {
    expect(tierRgb('d1548d')).toBe('209, 84, 141');
    expect(tierRgb('  #009587  ')).toBe('0, 149, 135'); // Deluxe — and it is dark, but still valid
  });

  it('returns null instead of inventing a colour', () => {
    // Null is a real state: 40 of Riot's 1405 skins have no tier, and the tier service can go down.
    // The card must still render, just without a colour.
    expect(tierRgb(null)).toBeNull();
    expect(tierRgb(undefined)).toBeNull();
    expect(tierRgb('')).toBeNull();
    expect(tierRgb('rebeccapurple')).toBeNull();
    expect(tierRgb('#12345')).toBeNull();
    // Eight digits = Riot's RAW form (RRGGBBAA); reaching here means a bug in the caller.
    expect(tierRgb('#D1548D33')).toBeNull();
  });
});
