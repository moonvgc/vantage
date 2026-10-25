// Daily store cursor on the renderer side.
//
// Daily store cards are NOT clickable — only the PREVIEW button — so this cursor is the "card being
// pointed at", not the "card the user selected"; it is pointed at with the mouse (hover) or the
// keyboard ([←][→], [P]). `null` is deliberately allowed: before the user touches anything no card
// is pointed at, and the first card lighting up on its own when the app opens reads as the app's
// choice, not the user's. Both functions below are pure — no state, no hidden clamping in the
// caller, and no index outside the list's range.

// The index that can actually be pointed at, or null when there is no offer. When the list shrinks (a
// refresh returns a shorter list), the last visible offer is used, not the old index.
export function clampOfferCursor(cursor, count) {
  if (!(count > 0)) return null;
  if (cursor === null || cursor === undefined) return null;
  return Math.min(Math.max(cursor, 0), count - 1);
}

// One arrow step. From empty, the arrow direction picks the landing end (forward = first card,
// backward = last card), so the first key after opening the app does not feel like a jump; from a
// card already pointed at, the step wraps at both ends.
export function stepOfferCursor(cursor, delta, count) {
  if (!(count > 0)) return null;
  const current = clampOfferCursor(cursor, count);
  if (current === null) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}
