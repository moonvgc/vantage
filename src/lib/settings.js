// Single source of truth for every persisted user preference.
//
// A REGISTRY, not a pile of getters: SettingsPanel renders itself from SETTINGS, so a new preference
// is one entry here and zero UI code.
//
// THE REGISTRY IS THE SCHEMA, NOT THE PANEL'S ROW LIST: removing an entry does not just hide a row —
// setSetting() throws 'Unknown setting' for an id that is gone, and read()/DEFAULTS are built from
// this list, so the value stops persisting, silently. A `panel: false` entry stays persisted and
// sanitised, just not rendered; it has a home elsewhere (a keybind, an in-context control).
//
// One storage key ('vlr.settings'); older per-feature keys migrate once on first load, and uiPrefs.js
// and audioPrefs.js must NOT keep writing their own keys. STORAGE IS THE ONLY SOURCE OF TRUTH — no
// cache, which would drift when anything writes the blob out of band and leak state between tests
// sharing one module instance.

import { SORT_MODES, SORT_LABELS } from './accountOrder.js';

const KEY = 'vlr.settings';

const GAME_OPTIONS = [
  { value: 'valorant', label: 'VALORANT' },
  { value: 'lol', label: 'LEAGUE' }
];

export const SETTINGS = [
  {
    id: 'playGame',
    label: 'PLAY LAUNCHES',
    hint: 'Which Riot game the PLAY buttons start. The game switch above the account list sets the same value.',
    kind: 'choice',
    default: 'valorant',
    options: GAME_OPTIONS
  },
  {
    id: 'previewsHidden',
    label: 'HIDE SKIN PREVIEWS',
    hint: 'Replaces the store cards with a one-line summary. The [H] key still toggles this.',
    kind: 'toggle',
    default: false,
    // Panel-excluded: the [H] key owns it.
    panel: false
  },
  {
    id: 'sortMode',
    label: 'ACCOUNT SORT',
    hint: 'The signed-in account is always first; this orders the rest. The [O] key still cycles it.',
    kind: 'choice',
    default: 'active',
    options: SORT_MODES.map((mode) => ({ value: mode, label: SORT_LABELS[mode] })),
    // Panel-excluded: the [O] key and the sidebar sort button already own it; two controls for one value.
    panel: false
  },
  {
    id: 'showcaseSound',
    label: 'SHOWCASE SOUND',
    hint: 'Play audio in the skin showcase video.',
    kind: 'toggle',
    default: false,
    // Panel-excluded: the showcase overlay has its own sound button.
    panel: false
  },
  {
    id: 'showcaseVolume',
    label: 'SHOWCASE VOLUME',
    hint: 'Playback volume for the showcase video.',
    kind: 'range',
    default: 70, min: 0, max: 100, step: 5,
    format: (value) => `${value}%`,
    // Panel-excluded: the showcase overlay's own slider is the better place — you set it while listening.
    panel: false
  },
  {
    id: 'notifyOnRotation',
    label: 'STORE ROTATION NOTICE',
    hint: 'Windows notification when the daily store resets at 00:00 UTC.',
    kind: 'toggle',
    default: true
  },
  {
    id: 'autoSyncOnRotation',
    label: 'AUTO-SYNC ON ROTATION',
    hint: 'Pull every account automatically when the store resets.',
    kind: 'toggle',
    default: true
  },
  {
    id: 'notifyNightMarket',
    label: 'NIGHT MARKET NOTICE',
    hint: 'One Windows notification when a Night Market opens for a saved account.',
    kind: 'toggle',
    // Default ON like STORE ROTATION NOTICE: this window only opens ~once every 2 weeks per act.
    default: true
  },
  {
    id: 'confirmDestructive',
    label: 'CONFIRM SWITCH & DELETE',
    hint: 'Ask before restarting the Riot Client or deleting a saved account.',
    kind: 'toggle',
    default: true
  },
  {
    id: 'restoreLastSelection',
    label: 'REOPEN LAST ACCOUNT',
    hint: 'Select the account you were viewing last, instead of the signed-in one.',
    kind: 'toggle',
    default: false
  },
  {
    id: 'closeToTray',
    label: 'RUN IN BACKGROUND',
    hint: 'Closing the window keeps the app in the system tray: store and Night Market notices keep coming, and the tray menu can launch any account.',
    kind: 'toggle',
    default: true
  },
  {
    id: 'launchAtLogin',
    label: 'START WITH WINDOWS',
    hint: 'Start minimised to the tray when you sign in to Windows.',
    kind: 'toggle',
    default: false
  },
  {
    id: 'autoCheckUpdates',
    label: 'CHECK UPDATES ON LAUNCH',
    hint: 'Checks the ORIGINAL Sapphire project on GitHub. Installing an update from there replaces this customised Vantage build.',
    kind: 'toggle',
    // Default OFF since the Vantage rebrand: the updater still points at upstream Sapphire releases,
    // and installing one would silently replace this build's design and features.
    default: false
  }
];

const DEFAULTS = Object.fromEntries(SETTINGS.map((setting) => [setting.id, setting.default]));
const listeners = new Set();

function readStorage() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

function persist(value) {
  try {
    // Merge over the raw blob rather than replacing it: the remembered last account lives in this same
    // blob, and a wholesale replace would silently forget it the moment any setting changed.
    localStorage.setItem(KEY, JSON.stringify({ ...(readStorage() ?? {}), ...value }));
    return true;
  } catch {
    // Storage unavailable (blocked, private mode): the write does not stick, so callers see the defaults.
    return false;
  }
}

// Read the legacy keys once, because 'vlr.settings' was absent; after that the new key is the only source.
function legacySeed() {
  const seeded = {};
  try {
    const hidden = localStorage.getItem('vlr.ui.previewsHidden');
    if (hidden !== null) seeded.previewsHidden = hidden === '1';
    const sort = localStorage.getItem('vlr.ui.sortMode');
    if (sort !== null) seeded.sortMode = sort;
    const raw = localStorage.getItem('vlr.showcase.audio');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.soundOn === 'boolean') seeded.showcaseSound = parsed.soundOn;
      if (Number.isFinite(Number(parsed.volume))) seeded.showcaseVolume = Number(parsed.volume);
    }
    // Migration is a MOVE, not a copy: leftovers would resurrect on the first resetSettings(), which
    // removes the new key — a reset would silently undo itself (and a rollback starts from the defaults).
    localStorage.removeItem('vlr.ui.previewsHidden');
    localStorage.removeItem('vlr.ui.sortMode');
    localStorage.removeItem('vlr.showcase.audio');
  } catch { /* storage unavailable: defaults are fine */ }

  // Persist what was migrated immediately: the legacy keys are gone and there is no cache, so returning
  // the seeded values alone would leave the next read falling back to the defaults.
  const migrated = sanitise(seeded);
  if (Object.keys(migrated).length) persist({ ...DEFAULTS, ...migrated });
  return seeded;
}

// Unknown ids are dropped and every value is coerced to its declared shape, so a hand-edited or stale
// blob can never put a string where a boolean belongs, and a later version's setting is dropped.
function sanitise(input) {
  const output = {};
  if (!input || typeof input !== 'object') return output;
  for (const setting of SETTINGS) {
    if (!(setting.id in input)) continue;
    const value = input[setting.id];
    if (setting.kind === 'toggle') { if (typeof value === 'boolean') output[setting.id] = value; continue; }
    if (setting.kind === 'choice') {
      if (setting.options.some((option) => option.value === value)) output[setting.id] = value;
      continue;
    }
    if (setting.kind === 'range') {
      const number = Number(value);
      if (Number.isFinite(number)) output[setting.id] = Math.min(setting.max, Math.max(setting.min, number));
    }
  }
  return output;
}

function read() {
  const stored = readStorage();
  return { ...DEFAULTS, ...sanitise(stored ?? legacySeed()) };
}

function announce() {
  const snapshot = getSettings();
  for (const listener of listeners) listener(snapshot);
}

export function getSetting(id) { return read()[id]; }
export function getSettings() { return { ...read() }; }

// Returns the value now IN EFFECT, not the one attempted: the default when the write could not persist.
export function setSetting(id, value) {
  const setting = SETTINGS.find((entry) => entry.id === id);
  if (!setting) throw new Error(`Unknown setting: ${id}`);
  const accepted = sanitise({ [id]: value })[id];
  if (accepted === undefined) return getSetting(id);
  persist({ ...read(), [id]: accepted });
  const effective = getSetting(id);
  announce();
  return effective;
}

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  announce();
  return getSettings();
}

export function subscribeSettings(listener) {
  listeners.add(listener);
  listener(getSettings());
  return () => listeners.delete(listener);
}

// Not a user-facing setting: the label 'reopen last account' needs. In the same blob, so still one key.
export function getLastSelection() {
  const stored = readStorage();
  return typeof stored?.lastSelectedLabel === 'string' ? stored.lastSelectedLabel : null;
}

export function setLastSelection(label) {
  persist({ lastSelectedLabel: label });
}

// Not a user-facing setting: which Night Market has been announced, per account label. It rides in
// the same blob so there is still one storage key, and it is never sanitised (the value is a fingerprint).
// Written BEFORE the notice is sent: persist() is synchronous, so a re-render already sees the fingerprint.
export function getAnnouncedNightMarkets() {
  const stored = readStorage();
  return stored?.nightMarkets && typeof stored.nightMarkets === 'object' ? stored.nightMarkets : {};
}

export function setAnnouncedNightMarket(label, signature) {
  persist({ nightMarkets: { ...getAnnouncedNightMarkets(), [label]: signature } });
}
