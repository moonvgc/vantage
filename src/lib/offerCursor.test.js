import { describe, expect, it } from 'vitest';
import { clampOfferCursor, stepOfferCursor } from './offerCursor.js';

// The daily store cursor is the index of the card being pointed at; `null` (a valid initial state, not
// a shortcoming) means nothing has been pointed at yet, because cards are not clickable — so there is
// no reason for one card to light up as soon as the app opens or the account changes.

describe('clampOfferCursor', () => {
  it('keeps a cursor that points inside the list', () => {
    expect(clampOfferCursor(0, 4)).toBe(0);
    expect(clampOfferCursor(3, 4)).toBe(3);
  });

  it('pulls a stale cursor back to the last offer', () => {
    // A refresh can return a shorter list: the old index must not point at empty space, or be thrown
    // as an error.
    expect(clampOfferCursor(9, 4)).toBe(3);
  });

  it('has nothing to point at when there is no offer', () => {
    expect(clampOfferCursor(2, 0)).toBeNull();
    expect(clampOfferCursor(null, 0)).toBeNull();
  });

  it('stays empty while nothing has been pointed at', () => {
    expect(clampOfferCursor(null, 4)).toBeNull();
    expect(clampOfferCursor(undefined, 4)).toBeNull();
  });
});

describe('stepOfferCursor', () => {
  it('enters the list from the end the arrow came from', () => {
    // Right arrow from empty lands on the first card, left on the last; without this the first key
    // pressed after opening the app jumps to the wrong end.
    expect(stepOfferCursor(null, 1, 4)).toBe(0);
    expect(stepOfferCursor(null, -1, 4)).toBe(3);
  });

  it('wraps around at both ends', () => {
    expect(stepOfferCursor(3, 1, 4)).toBe(0);
    expect(stepOfferCursor(0, -1, 4)).toBe(3);
  });

  it('moves from the offer actually shown, not from the stale index', () => {
    // 9 is no longer in the four-offer list: what is shown is the last offer, so step from there.
    expect(stepOfferCursor(9, 1, 4)).toBe(0);
    expect(stepOfferCursor(9, -1, 4)).toBe(2);
  });

  it('cannot move inside an empty list', () => {
    expect(stepOfferCursor(null, 1, 0)).toBeNull();
    expect(stepOfferCursor(1, 1, 0)).toBeNull();
    expect(stepOfferCursor(1, 1, undefined)).toBeNull();
  });
});
