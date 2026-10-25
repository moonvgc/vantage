import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This test runs the REAL main-process path end to end: Riot storefront -> parse store ->
// decorate through the content index -> payload the renderer receives. Only the account files and
// the Riot Client lockfile are mocked; the HTTP requests are not, because that connection was never tested.
//
// Why this exists: `nightMarket` was added as the fourth field in the store payload, and if its name
// is misspelled or left un-awaited everything stays green — the only loss is a feature that never shows.
vi.mock('./accountStore.js', () => ({
  captureLiveCredentials: vi.fn(async () => ({ cookie: 'mock' })),
  getActiveAccountId: vi.fn(async () => 'id-main'),
  listAccounts: vi.fn(async () => []),
  loadAccount: vi.fn(async () => ({ apiSession: null })),
  saveAccount: vi.fn(async () => ({ id: 'id-main' })),
  updateAccountSession: vi.fn(async () => undefined),
  loginPuuid: vi.fn(() => 'puuid-main'),
  syncLiveLoginIntoSavedAccount: vi.fn(async () => null)
}));
vi.mock('../riot/auth.js', () => ({
  getSessionTokens: vi.fn(async () => ({ puuid: null })),
  resolveShard: vi.fn(async () => 'na')
}));

const PREMIUM_TIER_UUID = 'tier-premium';
const REAVER_LEVEL = 'level-reaver';
const ONI_LEVEL = 'level-oni';
const PUUID = 'puuid-main';
// Elderflame-shaped bundle: the bundle id and three accessory ids, deliberately in a DIFFERENT
// namespace from the skin ids (bundle via /v1/bundles[].uuid, accessories via their own entry uuid)
// so this test can prove the three maps in the content index are truly separate and do not shadow.
const BUNDLE_UUID = 'bundle-elderflame';
const BUDDY_LEVEL = 'buddy-elderflame';
const SPRAY_LEVEL = 'spray-elderflame';
const CARD_LEVEL = 'card-elderflame';

// Two weeks in seconds, the way Riot sends it for Night Market.
const MARKET_SECONDS = 12 * 24 * 3600 + 22 * 3600;
// Four days, the way Riot sends it for a bundle that is currently on sale.
const BUNDLE_SECONDS = 4 * 24 * 3600;
// The second bundle Riot runs alongside the first, on a SHORTER window — measured live, and the
// reason each bundle carries its own countdown instead of one shared figure.
const PROMO_UUID = 'bundle-warden';
const PROMO_SECONDS = 2 * 24 * 3600;

function bonusOffer(levelId, { cost, discounted, percent, seen }) {
  return {
    BonusOfferID: `bonus-${levelId}`,
    Offer: { OfferID: `offer-${levelId}`, Cost: { '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741': cost }, Rewards: [{ ItemID: levelId, ItemTypeID: 'type' }] },
    DiscountCosts: { '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741': discounted },
    DiscountPercent: percent,
    IsSeen: seen
  };
}

const storefrontWith = (extra = {}) => ({
  SkinsPanelLayout: {
    SingleItemOffers: [REAVER_LEVEL],
    SingleItemStoreOffers: [{ OfferID: REAVER_LEVEL, Cost: { vp: 1775 } }],
    SingleItemOffersRemainingDurationInSeconds: 52_337
  },
  ...extra
});

// Elderflame-shaped bundle from Riot's storefront shape: one skin at full price, one melee at full
// price but flagged promo, three accessories priced 0 — that difference is the discount. BasePrice is
// always per row and there is no bundle-level percent in the payload, so the header comes from here.
const featuredBundle = (extra = {}) => ({
  Bundle: {
    ID: 'bundle-row',
    DataAssetID: BUNDLE_UUID,
    CurrencyID: 'vp',
    Items: [
      { Item: { ItemTypeID: 'skin-type', ItemID: REAVER_LEVEL, Quantity: 1 }, BasePrice: 1775, DiscountedPrice: 1775, DiscountPercent: 0, IsPromoItem: false },
      { Item: { ItemTypeID: 'skin-type', ItemID: ONI_LEVEL, Quantity: 1 }, BasePrice: 2675, DiscountedPrice: 2675, DiscountPercent: 0, IsPromoItem: false },
      { Item: { ItemTypeID: 'buddy-type', ItemID: BUDDY_LEVEL, Quantity: 1 }, BasePrice: 475, DiscountedPrice: 0, DiscountPercent: 0, IsPromoItem: true },
      { Item: { ItemTypeID: 'spray-type', ItemID: SPRAY_LEVEL, Quantity: 1 }, BasePrice: 325, DiscountedPrice: 0, DiscountPercent: 0, IsPromoItem: true },
      { Item: { ItemTypeID: 'card-type', ItemID: CARD_LEVEL, Quantity: 1 }, BasePrice: 375, DiscountedPrice: 0, DiscountPercent: 0, IsPromoItem: true }
    ]
  },
  Bundles: [],
  BundleRemainingDurationInSeconds: BUNDLE_SECONDS,
  ...extra
});

function stubRiot({ storefront, contentOk = true, storefrontOk = true } = {}) {
  const skins = [
    {
      displayName: 'Reaver Vandal',
      displayIcon: 'reaver.png',
      contentTierUuid: PREMIUM_TIER_UUID,
      levels: [{ uuid: REAVER_LEVEL, displayName: 'Reaver Vandal', streamedVideo: 'reaver.mp4', displayIcon: 'reaver-level.png' }],
      chromas: []
    },
    {
      displayName: 'Oni Phantom',
      displayIcon: 'oni.png',
      contentTierUuid: null,
      levels: [{ uuid: ONI_LEVEL, displayName: 'Oni Phantom', streamedVideo: 'oni.mp4', displayIcon: 'oni-level.png' }],
      chromas: []
    }
  ];
  globalThis.fetch = vi.fn(async (url) => {
    const target = String(url);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (target.includes('/v1/version')) return json({ data: { riotClientVersion: 'release-11.02-shipping-9-3000000' } });
    if (target.includes('/store/v3/storefront/')) {
      return storefrontOk ? json(storefront) : json({}, 500);
    }
    if (target.includes('/account-xp/')) return json({ Progress: { Level: 42 } });
    if (target.includes('/mmr/')) return json({ QueueSkills: {}, LatestCompetitiveUpdate: null });
    if (target.includes('/contenttiers')) {
      return contentOk
        ? json({ data: [{ uuid: PREMIUM_TIER_UUID, rank: 2, displayName: 'Premium Edition', highlightColor: 'd1548d33' }] })
        : json({}, 503);
    }
    // Three accessory lists and the bundle list, one entry each. contentOk = false means the
    // whole content service is down, so they all go down together with skins.
    if (target.includes('/buddies')) return contentOk ? json({ data: [{ uuid: BUDDY_LEVEL, displayName: 'Elderflame Buddy', displayIcon: 'buddy.png' }] }) : json({}, 503);
    if (target.includes('/sprays')) return contentOk ? json({ data: [{ uuid: SPRAY_LEVEL, displayName: 'Elderflame Spray', displayIcon: 'spray-icon.png', fullIcon: 'spray-full.png' }] }) : json({}, 503);
    if (target.includes('/playercards')) return contentOk ? json({ data: [{ uuid: CARD_LEVEL, displayName: 'Elderflame Card', displayIcon: 'card-icon.png', largeArt: 'card-large.png' }] }) : json({}, 503);
    if (target.includes('/bundles')) {
      return contentOk
        ? json({ data: [{ uuid: BUNDLE_UUID, displayName: 'Elderflame', displayIcon2: 'bundle-wide.png', verticalPromoImage: 'bundle-tall.png', logoIcon: null }] })
        : json({}, 503);
    }
    // The rest: the content service (skins). contentOk = false means this service is down.
    return contentOk ? json({ data: skins }) : json({}, 503);
  });
}

// The account module caches the content index and the client-version promise, so each test needs a fresh module graph.
async function serviceWith(options) {
  vi.resetModules();
  stubRiot(options);
  return await import('./accountService.js');
}

// One saved account whose session is still valid: what getDashboard needs to actually
// fetch a store instead of stopping as 'expired'.
const savedAccount = () => ({
  label: 'main',
  id: 'id-main',
  puuid: PUUID,
  apiSession: { accessToken: 'a.b.c', entitlementsToken: 'ent', puuid: PUUID, shard: 'na', expiresAt: Date.now() + 3_600_000 }
});

function useAccount(account) {
  const store = { listAccounts: [ { label: account.label, id: account.id, puuid: account.puuid } ], saved: account };
  globalThis.__accountStore = store;
  return store;
}

beforeEach(() => {
  vi.doMock('./accountStore.js', () => ({
    captureLiveCredentials: vi.fn(async () => ({ cookie: 'mock' })),
    getActiveAccountId: vi.fn(async () => 'id-main'),
    listAccounts: vi.fn(async () => globalThis.__accountStore?.listAccounts ?? []),
    loadAccount: vi.fn(async () => globalThis.__accountStore?.saved ?? { apiSession: null }),
    saveAccount: vi.fn(async () => ({ id: 'id-main' })),
    updateAccountSession: vi.fn(async () => undefined),
    loginPuuid: vi.fn(() => null),
    syncLiveLoginIntoSavedAccount: vi.fn(async () => null)
  }));
  vi.doMock('../riot/auth.js', () => ({
    getSessionTokens: vi.fn(async () => ({ puuid: null })),
    resolveShard: vi.fn(async () => 'na')
  }));
});

afterEach(() => { vi.restoreAllMocks(); delete globalThis.__accountStore; });

describe('getDashboard dengan Night Market', () => {
  it('mengirim nightMarket ke renderer, sudah dihias nama, gambar dan tier-nya', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({
      storefront: storefrontWith({
        BonusStore: {
          BonusStoreRemainingDurationInSeconds: MARKET_SECONDS,
          BonusStoreOffers: [
            bonusOffer(REAVER_LEVEL, { cost: 1775, discounted: 1172, percent: 34, seen: false }),
            bonusOffer(ONI_LEVEL, { cost: 875, discounted: 613, percent: 30, seen: true })
          ]
        }
      })
    });

    const { accounts } = await service.getDashboard();
    expect(accounts[0].status).toBe('ready');
    const market = accounts[0].store.nightMarket;

    expect(market).not.toBeNull();
    expect(market.offers).toHaveLength(2);
    expect(market.offers[0]).toMatchObject({
      id: REAVER_LEVEL, name: 'Reaver Vandal', image: 'reaver-level.png',
      price: 1172, originalPrice: 1775, discountPercent: 34, seen: false,
      tier: { color: '#D1548D', label: 'Premium Edition', rank: 2 }
    });
    // A skin with no Riot tier still shows, just without a colour — and its discount does not go missing.
    expect(market.offers[1]).toMatchObject({ name: 'Oni Phantom', tier: null, discountPercent: 30, seen: true });
  });

  it('mengubah durasi Riot menjadi instant absolut, bukan durasi yang mulai basi saat itu juga', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({
      storefront: storefrontWith({
        BonusStore: {
          BonusStoreRemainingDurationInSeconds: MARKET_SECONDS,
          BonusStoreOffers: [bonusOffer(REAVER_LEVEL, { cost: 1775, discounted: 1172, percent: 34, seen: false })]
        }
      })
    });

    const before = Date.now();
    const { accounts } = await service.getDashboard();
    const after = Date.now();
    const endsAt = accounts[0].store.nightMarket.endsAt;

    // A range, not an exact value: what is wrong if this fails is the shape (the duration carried
    // as-is), whereas a few milliseconds of difference is just the time spent fetching the data.
    expect(endsAt).toBeGreaterThanOrEqual(before + MARKET_SECONDS * 1000);
    expect(endsAt).toBeLessThanOrEqual(after + MARKET_SECONDS * 1000);
  });

  it('nightMarket null ketika Riot tidak sedang mengadakan event, dan akunnya tetap ready', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({ storefront: storefrontWith() });

    const { accounts } = await service.getDashboard();
    expect(accounts[0].status).toBe('ready');
    expect(accounts[0].store.nightMarket).toBeNull();
    // The daily store must not be affected either: this is the state for most of the year.
    expect(accounts[0].store.offers).toHaveLength(1);
  });

  it('layanan konten mati: nama hilang dari dua-duanya, tapi angka diskon Night Market bertahan', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({
      contentOk: false,
      storefront: storefrontWith({
        BonusStore: {
          BonusStoreRemainingDurationInSeconds: MARKET_SECONDS,
          BonusStoreOffers: [bonusOffer(REAVER_LEVEL, { cost: 1775, discounted: 1172, percent: 34, seen: false })]
        }
      })
    });

    const { accounts } = await service.getDashboard();
    const store = accounts[0].store;
    // A third-party failure must not turn an account Riot served fine into an error.
    expect(accounts[0].status).toBe('ready');
    expect(store.contentUnavailable).toBe(true);
    expect(store.nightMarket.contentUnavailable).toBe(true);
    expect(store.nightMarket.offers[0]).toMatchObject({ name: 'Unknown skin', image: null, discountPercent: 34, price: 1172, originalPrice: 1775 });
  });

  it('storefront yang gagal tetap menggagalkan akunnya seperti sebelumnya', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({ storefront: storefrontWith(), storefrontOk: false });

    const { accounts } = await service.getDashboard();
    expect(accounts[0].status).toBe('error');
    expect(accounts[0].store).toBeUndefined();
  });

  it('tidak ada akun tersimpan: payload kosong, bukan array berisi undefined', async () => {
    globalThis.__accountStore = { listAccounts: [], saved: { apiSession: null } };
    const service = await serviceWith({ storefront: storefrontWith() });

    const { accounts, session } = await service.getDashboard();
    expect(accounts).toEqual([]);
    expect(session.live).toBe(false);
  });
});

// `bundles` is the FIFTH field in the store payload, same reason as the Night Market block above:
// if its name is misspelled or left un-awaited, every other test stays green and the only loss is a
// feature that never appears on screen.
describe('getDashboard dengan Featured Bundle', () => {
  it('mengirim bundle ke renderer, sudah dihias nama item dan tier-nya', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({ storefront: storefrontWith({ FeaturedBundle: featuredBundle() }) });

    const { accounts } = await service.getDashboard();
    expect(accounts[0].status).toBe('ready');
    const bundle = accounts[0].store.bundles[0];

    expect(bundle).not.toBeNull();
    expect(bundle).toMatchObject({ id: BUNDLE_UUID, name: 'Elderflame' });
    expect(bundle.art).toEqual({ wide: 'bundle-wide.png', tall: 'bundle-tall.png', logo: null });
    // A skin takes its label, image and tier from the skin index — the fields the showcase modal reads.
    expect(bundle.items[0]).toMatchObject({
      id: REAVER_LEVEL, kind: 'skin', name: 'Reaver Vandal', image: 'reaver-level.png', video: 'reaver.mp4',
      price: 1775, basePrice: 1775, included: false, tier: { color: '#D1548D', label: 'Premium Edition', rank: 2 }
    });
    // Accessories come from the second map: their kind names the item type, and they have no tier.
    expect(bundle.items[2]).toMatchObject({ id: BUDDY_LEVEL, kind: 'buddy', name: 'Elderflame Buddy', image: 'buddy.png', price: 0, included: true, tier: null });
    expect(bundle.items[3]).toMatchObject({ kind: 'spray', image: 'spray-full.png', included: true });
    expect(bundle.items[4]).toMatchObject({ kind: 'card', image: 'card-large.png', included: true });
  });

  it('menghitung total dan diskon dari harga yang Riot kirim, bukan dari persen', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({ storefront: storefrontWith({ FeaturedBundle: featuredBundle() }) });

    const { accounts } = await service.getDashboard();
    const bundle = accounts[0].store.bundles[0];
    // Promo items still carry their full BasePrice; that difference is exactly the bundle's discount.
    expect(bundle.baseTotal).toBe(1775 + 2675 + 475 + 325 + 375);
    expect(bundle.price).toBe(1775 + 2675);
    expect(bundle.discountPercent).toBe(Math.round((1 - 4450 / 5625) * 100));
  });

  it('mengubah durasi Riot menjadi instant absolut, seperti Night Market', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({ storefront: storefrontWith({ FeaturedBundle: featuredBundle() }) });

    const before = Date.now();
    const { accounts } = await service.getDashboard();
    const after = Date.now();
    const endsAt = accounts[0].store.bundles[0].endsAt;

    expect(endsAt).toBeGreaterThanOrEqual(before + BUNDLE_SECONDS * 1000);
    expect(endsAt).toBeLessThanOrEqual(after + BUNDLE_SECONDS * 1000);
  });

  it('bundles kosong ketika Riot tidak sedang menjual bundle, dan akunnya tetap ready', async () => {
    // The normal state outside a bundle sale: the list is simply empty, the store is unaffected.
    useAccount(savedAccount());
    const service = await serviceWith({ storefront: storefrontWith() });

    const { accounts } = await service.getDashboard();
    expect(accounts[0].status).toBe('ready');
    expect(accounts[0].store.bundles).toEqual([]);
    expect(accounts[0].store.offers).toHaveLength(1);
  });

  it('mengirim SEMUA bundle yang dijual, bukan cuma yang pertama', async () => {
    // Measured live: Riot ran a second promo bundle beside the main one, and reading only the primary
    // hid its discount entirely. The renderer draws one door per entry, so the list has to carry both.
    useAccount(savedAccount());
    const service = await serviceWith({ storefront: storefrontWith({ FeaturedBundle: featuredBundle({
      Bundles: [{
        ID: 'promo-row',
        DataAssetID: PROMO_UUID,
        CurrencyID: 'vp',
        DurationRemainingInSeconds: PROMO_SECONDS,
        Items: [{ Item: { ItemTypeID: 'skin-type', ItemID: ONI_LEVEL, Quantity: 1 }, BasePrice: 875, DiscountedPrice: 525, DiscountPercent: 0.4, IsPromoItem: false }]
      }]
    }) }) });

    const { accounts } = await service.getDashboard();
    const bundles = accounts[0].store.bundles;

    expect(bundles.map((bundle) => bundle.id)).toEqual([BUNDLE_UUID, PROMO_UUID]);
    expect(bundles[0].name).toBe('Elderflame');
    expect(bundles[1]).toMatchObject({ id: PROMO_UUID, price: 525, baseTotal: 875, discountPercent: 40 });
    // Each keeps its OWN window: the promo's own field wins over the payload's shared one.
    expect(bundles[1].endsInSeconds).toBe(PROMO_SECONDS);
    expect(bundles[0].endsInSeconds).toBe(BUNDLE_SECONDS);
  });

  it('layanan konten mati: label hilang, tapi harga, total dan jendela bundle tetap utuh', async () => {
    useAccount(savedAccount());
    const service = await serviceWith({
      contentOk: false,
      storefront: storefrontWith({ FeaturedBundle: featuredBundle() })
    });

    const { accounts } = await service.getDashboard();
    const store = accounts[0].store;
    // A third-party failure must not turn an account Riot served fine into an error.
    expect(accounts[0].status).toBe('ready');
    expect(store.bundles[0].contentUnavailable).toBe(true);
    expect(store.bundles[0].name).toBe('Unknown bundle');
    expect(store.bundles[0].items.map((entry) => entry.id)).toEqual([REAVER_LEVEL, ONI_LEVEL, BUDDY_LEVEL, SPRAY_LEVEL, CARD_LEVEL]);
    expect(store.bundles[0].baseTotal).toBe(5625);
    expect(store.bundles[0].price).toBe(4450);
    expect(store.bundles[0].endsInSeconds).toBe(BUNDLE_SECONDS);
  });
});
