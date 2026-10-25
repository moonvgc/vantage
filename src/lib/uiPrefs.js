// Adapters over the single settings store (src/lib/settings.js). These used to own their own
// localStorage keys; they now translate to setting ids, and the store stays the only writer.

import { SORT_MODES } from './accountOrder.js';
import { getSetting, setSetting } from './settings.js';

export function getPreviewsHidden() { return Boolean(getSetting('previewsHidden')); }
export function setPreviewsHidden(hidden) { setSetting('previewsHidden', Boolean(hidden)); }

// Sort mode for the account list. 'active' is the default because the signed-in account must stay
// on top across restarts; the others only reorder the remaining accounts.
export function getSortMode() {
  const stored = getSetting('sortMode');
  return SORT_MODES.includes(stored) ? stored : 'active';
}
export function setSortMode(mode) { setSetting('sortMode', mode); }

// Pure helper, kept here because callers import it from this module.
export function nextSortMode(current) {
  const index = SORT_MODES.indexOf(current);
  return SORT_MODES[(index + 1) % SORT_MODES.length];
}