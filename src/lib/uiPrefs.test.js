import { describe, it, expect, beforeEach } from 'vitest';
import { getPreviewsHidden, setPreviewsHidden, getSortMode, setSortMode, nextSortMode } from './uiPrefs.js';
import { SORT_MODES } from './accountOrder.js';

// Minimal localStorage stand-in: jsdom is not configured for this project and
// the module's contract is only "persists, survives absence of storage".
class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

describe('uiPrefs previewsHidden', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
  });

  it('defaults to false with empty storage', () => {
    expect(getPreviewsHidden()).toBe(false);
  });

  it('round-trips true and back to false', () => {
    setPreviewsHidden(true);
    expect(getPreviewsHidden()).toBe(true);
    setPreviewsHidden(false);
    expect(getPreviewsHidden()).toBe(false);
  });

  it('removes the key entirely when set to false (no "0" residue)', () => {
    setPreviewsHidden(true);
    setPreviewsHidden(false);
    expect(globalThis.localStorage.getItem('vlr.ui.previewsHidden')).toBeNull();
  });

  it('falls back to false when storage is unavailable', () => {
    globalThis.localStorage = undefined;
    expect(() => setPreviewsHidden(true)).not.toThrow();
    expect(getPreviewsHidden()).toBe(false);
  });

  it('reads back a value written by a previous session', () => {
    // Simulates restart: fresh module instance, same storage contents.
    globalThis.localStorage.setItem('vlr.ui.previewsHidden', '1');
    expect(getPreviewsHidden()).toBe(true);
  });
});

describe('uiPrefs sortMode', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
  });

  it('defaults to the active-first mode', () => {
    expect(getSortMode()).toBe('active');
  });

  it('round-trips every supported mode', () => {
    for (const mode of SORT_MODES) {
      setSortMode(mode);
      expect(getSortMode()).toBe(mode);
    }
  });

  it('stores nothing for the default, so a reset needs no cleanup', () => {
    setSortMode('level');
    setSortMode('active');
    expect(globalThis.localStorage.getItem('vlr.ui.sortMode')).toBeNull();
  });

  it('ignores an unknown stored value instead of trusting it', () => {
    globalThis.localStorage.setItem('vlr.ui.sortMode', 'nonsense');
    expect(getSortMode()).toBe('active');
  });

  it('refuses to persist an unknown mode', () => {
    setSortMode('nonsense');
    expect(getSortMode()).toBe('active');
  });

  it('falls back to the default when storage is unavailable', () => {
    globalThis.localStorage = undefined;
    expect(() => setSortMode('label')).not.toThrow();
    expect(getSortMode()).toBe('active');
  });
});

describe('nextSortMode', () => {
  it('cycles through every mode and wraps around', () => {
    const seen = [];
    let mode = getSortMode();
    for (let i = 0; i < SORT_MODES.length; i += 1) {
      seen.push(mode);
      mode = nextSortMode(mode);
    }
    expect(seen).toEqual(SORT_MODES);
    expect(mode).toBe(SORT_MODES[0]);
  });

  it('moves on from an unrecognised mode rather than sticking', () => {
    expect(SORT_MODES).toContain(nextSortMode('nonsense'));
  });
});
