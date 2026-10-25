// Dev-only mock of the electron/preload.cjs bridge, installed by main.jsx only when
// import.meta.env.DEV and window.valorant is absent — tree-shaken out of production builds.

import { mockLocker, mockStats } from './devMockProfile.js';

const DASHBOARD_DELAY_MS = 0; // raise to e.g. 1500 to inspect the loading skeleton

// Tier: real values from valorant-api /v1/contenttiers. A null tier is a real state (40 of 1405 Riot
// skins without contentTierUuid), so one offer is deliberately left without a tier to exercise that path.
const TIERS = {
  ultra: { rank: 4, label: 'Ultra Edition', color: '#FAD663' },
  exclusive: { rank: 3, label: 'Exclusive Edition', color: '#F5955B' },
  premium: { rank: 2, label: 'Premium Edition', color: '#D1548D' },
  deluxe: { rank: 1, label: 'Deluxe Edition', color: '#009587' },
  select: { rank: 0, label: 'Select Edition', color: '#5A9FE2' }
};

const OFFERS = [
  { id: 'mock-offer-1', name: 'Prime Vandal', image: null, price: 1775, tier: TIERS.premium },
  { id: 'mock-offer-2', name: 'Oni Phantom', image: null, price: 1775, tier: TIERS.exclusive },
  { id: 'mock-offer-3', name: 'Elderflame Operator', image: null, price: 2475, tier: TIERS.ultra },
  { id: 'mock-offer-4', name: 'Glitchpop Phantom', image: null, price: 2175, tier: null }
];

const RANKS = [
  { label: 'Rune', accountName: 'Rune#1337', level: 187, rank: 'Ascendant 2', rr: 42 },
  { label: 'Zyrox', accountName: 'Zyrox#6942', level: 143, rank: 'Diamond 1', rr: 78 },
  { label: 'Kaze', accountName: 'Kaze#2718', level: 221, rank: 'Immortal 3', rr: 156 },
  { label: 'Lynx', accountName: 'Lynx#8080', level: 96, rank: 'Gold 3', rr: 12 },
  { label: 'Sora', accountName: 'Sora#5555', level: 154, rank: 'Platinum 2', rr: 34 },
  { label: 'Neko', accountName: 'Neko#4201', level: 73, rank: 'Unranked', rr: null, placementsRemaining: 3 }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Featured bundle, the exact same shape as the main process. Elderflame-shaped: four skins (one
// WITHOUT showcase so the "no video" path is visible), one melee, three accessories priced 0.
// Totals are computed from the items, not literal — a literal total stays right even if the page miscounts.
//
// Videos use REAL Riot CDN URLs, not relative filenames like 'vandal.mp4': relative
// files do not exist, so the PREVIEW button opens a player that fails. Two items with video are enough to
// check the modal path.
const VANDAL_VIDEO = 'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/7cf0f6c2-af1e-47db-9d85-f1a130267cc7_default_universal.mp4';
const DAGGER_VIDEO = 'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/97510dc2-457c-4b55-8737-14646b3e05e9_default_universal.mp4';
const BUNDLE_ITEMS = [
  { id: 'bundle-vandal', kind: 'skin', name: 'Elderflame Vandal', image: null, video: VANDAL_VIDEO, levels: [{ name: 'Elderflame Vandal', item: null, video: VANDAL_VIDEO, icon: null }, { name: 'Elderflame Vandal Level 2', item: 'EEquippableSkinLevelItem::VFX', video: VANDAL_VIDEO, icon: null }], chromas: [], tier: TIERS.ultra, price: 2475, basePrice: 2475, discountPercent: 0, included: false, quantity: 1 },
  { id: 'bundle-operator', kind: 'skin', name: 'Elderflame Operator', image: null, video: null, levels: [], chromas: [], tier: TIERS.ultra, price: 2475, basePrice: 2475, discountPercent: 0, included: false, quantity: 1 },
  { id: 'bundle-judge', kind: 'skin', name: 'Elderflame Judge', image: null, video: null, levels: [], chromas: [], tier: TIERS.ultra, price: 2475, basePrice: 2475, discountPercent: 0, included: false, quantity: 1 },
  // No levels and no video: the card must print NO SHOWCASE VIDEO and NOT have a PREVIEW
  // button — a real state (827 of 1405 Riot skins), and the only path not visible
  // from an accessory card.
  { id: 'bundle-frenzy', kind: 'skin', name: 'Elderflame Frenzy', image: null, video: null, levels: [], chromas: [], tier: TIERS.ultra, price: 2475, basePrice: 2475, discountPercent: 0, included: false, quantity: 1 },
  // The melee's edition is DIFFERENT from the bundle's: an item's color always comes from that item's own tier.
  { id: 'bundle-dagger', kind: 'skin', name: 'Elderflame Dagger', image: null, video: DAGGER_VIDEO, levels: [{ name: 'Elderflame Dagger', item: null, video: DAGGER_VIDEO, icon: null }, { name: 'Elderflame Dagger Level 2', item: 'EEquippableSkinLevelItem::VFX', video: DAGGER_VIDEO, icon: null }], chromas: [], tier: TIERS.exclusive, price: 0, basePrice: 4950, discountPercent: 0, included: true, quantity: 1 },
  { id: 'bundle-buddy', kind: 'buddy', name: 'Elderflame Buddy', image: null, video: null, levels: [], chromas: [], tier: null, price: 0, basePrice: 475, discountPercent: 0, included: true, quantity: 1 },
  { id: 'bundle-spray', kind: 'spray', name: 'Elderflame Spray', image: null, video: null, levels: [], chromas: [], tier: null, price: 0, basePrice: 325, discountPercent: 0, included: true, quantity: 1 },
  { id: 'bundle-card', kind: 'card', name: 'Elderflame Card', image: null, video: null, levels: [], chromas: [], tier: null, price: 0, basePrice: 375, discountPercent: 0, included: true, quantity: 1 }
];

// Two bundles, because Riot runs a second promo bundle alongside the main one and one fixture would
// never exercise the doors or the page's bundle selection. The second is deliberately smaller and
// more heavily discounted, so a mix-up between them is visible rather than plausible.
function bundleFixture() {
  const items = BUNDLE_ITEMS.map((item) => ({ ...item }));
  const baseTotal = items.reduce((sum, item) => sum + (item.basePrice ?? 0), 0);
  const price = items.reduce((sum, item) => sum + (item.price ?? item.basePrice ?? 0), 0);
  return {
    id: 'mock-bundle-elderflame',
    name: 'Elderflame',
    art: { wide: null, tall: null, logo: null },
    items,
    baseTotal,
    price,
    discountPercent: baseTotal > 0 && price < baseTotal ? Math.round((1 - price / baseTotal) * 100) : null,
    // A few days ahead, recomputed every time a store is created — the page never starts out "already ended".
    endsAt: Date.now() + (4 * 24 * 3600_000) + (6 * 3600_000),
    endsInSeconds: 4 * 24 * 3600 + 6 * 3600,
    contentUnavailable: false
  };
}

function promoBundleFixture() {
  const items = [
    { id: 'promo-skin', kind: 'skin', name: 'Galleria Warden', image: null, video: null, levels: [], chromas: [], tier: TIERS.select, price: 525, basePrice: 875, discountPercent: 0, included: false, quantity: 1 },
    { id: 'promo-buddy', kind: 'buddy', name: 'Warden Buddy', image: null, video: null, levels: [], chromas: [], tier: null, price: 0, basePrice: 475, discountPercent: 0, included: true, quantity: 1 },
    { id: 'promo-spray', kind: 'spray', name: 'Warden Spray', image: null, video: null, levels: [], chromas: [], tier: null, price: 0, basePrice: 325, discountPercent: 0, included: true, quantity: 1 }
  ];
  const baseTotal = items.reduce((sum, item) => sum + (item.basePrice ?? 0), 0);
  const price = items.reduce((sum, item) => sum + (item.price ?? item.basePrice ?? 0), 0);
  return {
    id: 'mock-bundle-warden',
    name: 'Warden Launch',
    art: { wide: null, tall: null, logo: null },
    items,
    baseTotal,
    price,
    discountPercent: Math.round((1 - price / baseTotal) * 100),
    // A SHORTER window than the main bundle, which is what the live payload does — and it is the
    // reason the page prints each bundle's own countdown rather than one shared figure.
    endsAt: Date.now() + (2 * 24 * 3600_000),
    endsInSeconds: 2 * 24 * 3600,
    contentUnavailable: false
  };
}

let accounts = [];
let counter = 0;

function freshStore(accountName) {
  return {
    accountName,
    offers: OFFERS.map((offer) => ({ ...offer })),
    expiresIn: 52_337,
    // Night Market, the same shape as the main process. `seen` is spread so the OPENED marker and
    // the order within a tier are visible in dev.
    nightMarket: {
      endsAt: Date.now() + (12 * 24 * 3600_000) + (22 * 3600_000),
      contentUnavailable: false,
      offers: OFFERS.map((offer, index) => ({
        ...offer,
        originalPrice: offer.price,
        price: Math.round(offer.price * 0.6),
        discountPercent: 40,
        seen: index > 1
      }))
    },
    bundles: [bundleFixture(), promoBundleFixture()],
    profile: null
  };
}

function makeReadyAccount(spec) {
  counter += 1;
  return {
    id: `mock-${counter}`,
    label: spec.label,
    accountName: spec.accountName,
    lastCheckedAt: new Date(Date.now() - (counter * 7 + 3) * 60_000).toISOString(),
    active: Boolean(spec.active),
    // One account with a rejected login, so the LOGIN notice and the sidebar chip are visible in dev.
    loginState: spec.active ? 'active' : spec.label === 'Kaze' ? 'expired' : 'ok',
    status: 'ready',
    error: null,
    store: {
      accountName: spec.accountName,
      offers: OFFERS.map((offer) => ({ ...offer })),
      expiresIn: 52_337,
      bundles: [bundleFixture(), promoBundleFixture()],
      profile: {
        level: spec.level,
        rank: spec.rank,
        rr: spec.rr,
        placementsRemaining: spec.placementsRemaining ?? 0
      }
    }
  };
}

function makeErrorAccount() {
  counter += 1;
  return {
    id: `mock-${counter}`,
    label: 'Ghost',
    accountName: 'Ghost#0001',
    lastCheckedAt: new Date(Date.now() - 52 * 3600_000).toISOString(),
    active: false,
    status: 'error',
    error: 'The saved Riot session expired. Sign in to this account and sync again.',
    store: null
  };
}

function makeAccount(label) {
  return makeReadyAccount({ label, accountName: `${label}#0000`, level: 1, rank: 'Unranked', rr: null, placementsRemaining: 5 });
}

function respond(data = null) { return { ok: true, data }; }
function fail(error) { return { ok: false, error }; }
function findAccount(label) { return accounts.find((account) => account.label === label); }

function seed() {
  counter = 0;
  accounts = [
    ...RANKS.map((spec, index) => makeReadyAccount({ ...spec, active: index === 0 })),
    makeErrorAccount()
  ];
}

export function installDevMock() {
  if (typeof window === 'undefined' || window.valorant) return;
  seed();
  window.valorant = {
    getDashboard: async () => {
      if (DASHBOARD_DELAY_MS) await sleep(DASHBOARD_DELAY_MS);
      return respond({ accounts, session: { live: true } });
    },
    // Recorded so the headless harness can assert the rotation notice fired, or that it did
    // NOT: a call that returns true is indistinguishable from one never made.
    notifyStoreReset: async (payload) => { (window.__notifyCalls ??= []).push(payload ?? null); return respond(true); },
    // Update: dev never touches GitHub — fixed answers so the UI can be checked without network.
    getAppVersion: async () => '0.1.2-dev',
    checkForUpdates: async () => respond({ available: false, currentVersion: '0.1.2-dev', latestVersion: null, reason: 'no-releases', installer: null, notes: null, publishedAt: null }),
    downloadUpdate: async () => fail('Dev mock: download disabled.'),
    installUpdate: async () => fail('Dev mock: install disabled.'),
    onUpdateProgress: () => {},
    captureCurrentAccount: async (label) => {
      accounts = accounts.filter((account) => account.label !== label);
      accounts = [makeAccount(label), ...accounts];
      return respond();
    },
    addManualAccount: async (label) => {
      if (findAccount(label)) return fail(`An account named “${label}” already exists.`);
      accounts = [...accounts, makeAccount(label)];
      return respond();
    },
    refreshAccountMarket: async (label) => {
      const account = findAccount(label);
      if (!account || account.status === 'error') return fail(`No store available for “${label}”.`);
      return respond({ active: account.active, store: freshStore(account.accountName) });
    },
    deleteAccount: async (label) => {
      accounts = accounts.filter((account) => account.label !== label);
      return respond();
    },
    renameAccount: async (oldLabel, newLabel) => {
      const target = findAccount(oldLabel);
      if (!target) return fail(`No saved account “${oldLabel}”.`);
      const trimmed = String(newLabel ?? '').trim();
      if (!trimmed || trimmed.length > 64) return fail('Account labels must be between 1 and 64 characters.');
      if (findAccount(trimmed)) return fail(`An account named “${trimmed}” already exists.`);
      accounts = accounts.map((account) => account.label === oldLabel ? { ...account, label: trimmed } : account);
      return respond();
    },
    switchAccount: async (label) => {
      if (!findAccount(label)) return fail(`No saved account “${label}”.`);
      accounts = accounts.map((account) => ({ ...account, active: account.label === label }));
      // Mirrors the real backend's shape: `moved` on both paths, `refreshError` carrying the
      // store-read failure — a switch whose store could not be read has still moved the session.
      return respond({ label, store: null, moved: true, refreshError: null });
    },
    // PLAY, mirroring the real backend: launch only for the account that owns the session, report
    // not-signed-in otherwise. Recorded like notifyStoreReset — a launch is not observable from the
    // renderer, so a stub that silently succeeds is indistinguishable from one never invoked. The
    // mock never starts a game.
    //
    // The switch really moves the session: the renderer re-reads the dashboard after a PLAY that
    // switched, so a mock reporting only `switched` would hand it the previous account as active.
    playAccount: async (label) => {
      const target = findAccount(label);
      if (!target) return fail(`No saved account “${label}”.`);
      const running = Boolean(window.__valorantRunning);
      const switched = !target.active;
      (window.__playCalls ??= []).push({ label, active: Boolean(target.active), switched, running });
      if (target.active && running) return respond({ label, launched: false, switched: false, reason: 'already-running' });
      if (running) return respond({ label, launched: false, switched: false, reason: 'close-game-first' });
      if (switched) accounts = accounts.map((account) => ({ ...account, active: account.label === label }));
      return respond({ label, launched: true, switched, reason: null });
    },
    getLocker: async (label) => (findAccount(label)?.status === 'ready'
      ? respond(await mockLocker(label))
      : fail('Saved API session expired. Switch to this account, then refresh and save it again.')),
    getStats: async (label, options) => (findAccount(label)?.status === 'ready'
      ? respond(await mockStats(label, options))
      : fail('Saved API session expired. Switch to this account, then refresh and save it again.')),
    openTracker: async (url) => { window.open(url, '_blank', 'noopener'); return respond(true); },
    detectTcno: async () => respond({
      available: true,
      accounts: [
        { id: 'tcno-snapshot-1', name: 'TCNO Snapshot 1' },
        { id: 'tcno-snapshot-2', name: 'TCNO Snapshot 2' }
      ]
    }),
    importTcno: async (ids) => {
      const imported = (ids ?? []).map((id, index) => makeAccount(`TCNO ${index + 1}`));
      accounts = [...accounts, ...imported];
      return respond(ids ?? []);
    }
  };
}
