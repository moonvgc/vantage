import { afterEach, describe, expect, it, vi } from 'vitest';

// The version is one value shared by every account but used to be fetched per request: the two loaders
// pulled it in parallel, so five accounts made ten identical calls. These tests pin the memo AND the fact
// that a failure is not remembered — a cached rejection would break every later account.
const SESSION = { accessToken: 'access.token.sig', entitlementsToken: 'ent', puuid: 'puuid-1', shard: 'ap' };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function stubNetwork({ versionStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/v1/version')) {
      return versionStatus === 200
        ? jsonResponse({ data: { riotClientVersion: 'release-11.0-test' } })
        : jsonResponse({}, versionStatus);
    }
    if (target.includes('/storefront/')) {
      return jsonResponse({
        SkinsPanelLayout: {
          SingleItemOffers: ['skin-a'],
          SingleItemStoreOffers: [{ OfferID: 'skin-a', Cost: { valorantPoints: 1775 } }],
          SingleItemOffersRemainingDurationInSeconds: 3600
        }
      });
    }
    if (target.includes('/account-xp/')) return jsonResponse({ Progress: { Level: 121 } });
    if (target.includes('/mmr/')) return jsonResponse({ QueueSkills: {} });
    return jsonResponse({});
  });
  return calls;
}

// clientVersionPromise is module state, so every test needs a fresh graph.
async function loadStore() {
  vi.resetModules();
  return import('./store.js');
}

const versionCalls = (calls) => calls.filter((url) => url.includes('valorant-api.com/v1/version')).length;

afterEach(() => { vi.restoreAllMocks(); });

describe('client version memo', () => {
  it('fetches the version once for a whole account load', async () => {
    const calls = stubNetwork();
    const store = await loadStore();

    // This is exactly how accountService loads one account: in parallel.
    await Promise.all([store.fetchStorefront(SESSION), store.fetchAccountProfile(SESSION)]);

    expect(versionCalls(calls)).toBe(1);
  });

  it('fetches the version once for five accounts instead of ten times', async () => {
    const calls = stubNetwork();
    const store = await loadStore();

    for (let index = 0; index < 5; index += 1) {
      await Promise.all([store.fetchStorefront(SESSION), store.fetchAccountProfile(SESSION)]);
    }

    expect(versionCalls(calls)).toBe(1);
    // 5 storefronts + 5 xp + 5 mmr + the single version call.
    expect(calls.length).toBe(16);
  });

  it('stamps the resolved version onto the Riot request', async () => {
    stubNetwork();
    const store = await loadStore();
    let sentVersion = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, options) => {
      if (String(url).includes('/storefront/')) sentVersion = options?.headers?.['X-Riot-ClientVersion'] ?? null;
      return realFetch(url, options);
    });

    await store.fetchStorefront(SESSION);

    expect(sentVersion).toBe('release-11.0-test');
  });

  it('does not remember a failed version fetch, so the next account retries', async () => {
    const failing = stubNetwork({ versionStatus: 503 });
    const store = await loadStore();
    await expect(store.fetchStorefront(SESSION)).rejects.toThrow(/client version/i);
    expect(versionCalls(failing)).toBe(1);

    const recovered = stubNetwork();
    const storefront = await store.fetchStorefront(SESSION);
    expect(versionCalls(recovered)).toBe(1);
    expect(storefront.SkinsPanelLayout.SingleItemOffers).toEqual(['skin-a']);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const calls = stubNetwork();
    const store = await loadStore();

    await Promise.all([
      store.fetchStorefront(SESSION),
      store.fetchAccountProfile(SESSION),
      store.fetchStorefront(SESSION),
      store.fetchAccountProfile(SESSION)
    ]);

    expect(versionCalls(calls)).toBe(1);
  });
});


// ── Night Market ────────────────────────────────────────────────────────────────
// Riot opens the Night Market per act and otherwise simply OMITS the BonusStore field, so nothing
// can be predicted and there is no schedule to store. The tests below pin two things that are wrong in
// the public documentation: BonusStoreOffers is an array, and BonusStoreRemainingDurationInSeconds is not listed
// at all even though it is in a real response.
const BONUS_STORE = {
  BonusStoreOffers: [
    {
      BonusOfferID: 'bonus-1',
      Offer: {
        OfferID: 'offer-1', IsDirectPurchase: false, StartDate: '2026-09-18T00:00:00Z',
        Cost: { valorantPoints: 1775 }, Rewards: [{ ItemTypeID: 'type', ItemID: 'level-1', Quantity: 1 }]
      },
      DiscountPercent: 34,
      DiscountCosts: { valorantPoints: 1172 },
      IsSeen: false
    },
    {
      BonusOfferID: 'bonus-2',
      Offer: { Cost: { valorantPoints: 2675 }, Rewards: [{ ItemTypeID: 'type', ItemID: 'level-2', Quantity: 1 }] },
      DiscountPercent: 12,
      DiscountCosts: { valorantPoints: 2354 },
      IsSeen: true
    }
  ],
  BonusStoreRemainingDurationInSeconds: 1209600
};

describe('getNightMarket', () => {
  it('reads the discount, both prices, the seen flag and the skin level id', async () => {
    const { getNightMarket } = await loadStore();
    expect(getNightMarket({ BonusStore: BONUS_STORE })).toEqual({
      offers: [
        { offerId: 'level-1', price: 1172, originalPrice: 1775, discountPercent: 34, seen: false },
        { offerId: 'level-2', price: 2354, originalPrice: 2675, discountPercent: 12, seen: true }
      ],
      endsInSeconds: 1209600
    });
  });

  it('keys on the skin LEVEL id, which is the namespace the content index is built on', async () => {
    // Keying on BonusOfferID would resolve no names and no images, and the failure would look like a content-service outage.
    const { getNightMarket } = await loadStore();
    expect(getNightMarket({ BonusStore: BONUS_STORE }).offers.map((offer) => offer.offerId))
      .toEqual(['level-1', 'level-2']);
  });

  it('returns null when Riot sends no BonusStore at all', async () => {
    // The normal case for most of the year: the key is simply absent.
    const { getNightMarket } = await loadStore();
    expect(getNightMarket({ SkinsPanelLayout: {} })).toBeNull();
    expect(getNightMarket({ BonusStore: null })).toBeNull();
    expect(getNightMarket(undefined)).toBeNull();
  });

  it('returns null for an empty BonusStore rather than rendering an empty market', async () => {
    const { getNightMarket } = await loadStore();
    expect(getNightMarket({ BonusStore: { BonusStoreOffers: [], BonusStoreRemainingDurationInSeconds: 60 } })).toBeNull();
  });

  it('falls back to the full price when no discounted cost was sent', async () => {
    const { getNightMarket } = await loadStore();
    const market = getNightMarket({ BonusStore: { BonusStoreOffers: [
      { Offer: { Cost: { valorantPoints: 875 }, Rewards: [{ ItemID: 'level-3' }] }, DiscountPercent: 20, IsSeen: false }
    ] } });
    expect(market.offers[0]).toEqual({ offerId: 'level-3', price: 875, originalPrice: 875, discountPercent: 20, seen: false });
  });

  it('reports a missing duration as null instead of NaN', async () => {
    // NaN would reach the countdown and print '--:--:--' forever; null means "open, end unknown", and the offers are still buyable.
    const { getNightMarket } = await loadStore();
    const market = getNightMarket({ BonusStore: { BonusStoreOffers: [
      { Offer: { Cost: { vp: 100 }, Rewards: [{ ItemID: 'level-4' }] } }
    ] } });
    expect(market.endsInSeconds).toBeNull();
    expect(market.offers[0].discountPercent).toBeNull();
    expect(market.offers[0].seen).toBe(false);
  });

  it('drops an offer with no identifiable skin and keeps the rest', async () => {
    const { getNightMarket } = await loadStore();
    const market = getNightMarket({ BonusStore: { BonusStoreOffers: [
      { Offer: { Cost: { vp: 1 } } },
      { Offer: { Cost: { vp: 2 }, Rewards: [{ ItemID: 'level-5' }] } }
    ] } });
    expect(market.offers.map((offer) => offer.offerId)).toEqual(['level-5']);
  });
});

describe('nightMarketWindow', () => {
  it('turns the remaining duration into an absolute instant', async () => {
    // Riot sends a duration measured AT THIS REQUEST: stored or passed around, it is wrong the moment it is
    // measured (an account synced three days ago would restart its countdown at 14 days). The daily store does the same.
    const { nightMarketWindow } = await loadStore();
    const opened = nightMarketWindow({ BonusStore: BONUS_STORE }, 1_000_000);
    expect(opened.endsAt).toBe(1_000_000 + 1_209_600_000);
    expect(opened.offers).toHaveLength(2);
  });

  it('is null when there is no market, and has no end when Riot sent no duration', async () => {
    const { nightMarketWindow } = await loadStore();
    expect(nightMarketWindow({ SkinsPanelLayout: {} }, 1_000_000)).toBeNull();
    const open = nightMarketWindow({ BonusStore: { BonusStoreOffers: [
      { Offer: { Cost: { vp: 1 }, Rewards: [{ ItemID: 'l' }] } }
    ] } }, 1_000_000);
    expect(open.endsAt).toBeNull();
  });
});

// ── Featured Bundle ─────────────────────────────────────────────────────────────
// The cosmetic bundle lives inside the SAME storefront as the daily store, so it costs no extra request, but
// every item carries its own price, discount and promo flag, so not one price is reconstructed. The tests
// below pin that parsing and the null-not-NaN rule: a missing duration means "no known end" → 'NO END DATE'.
const FEATURED = {
  Bundle: {
    ID: 'bundle-row-id',
    DataAssetID: 'bundle-asset-id',
    CurrencyID: 'vp',
    Items: [
      {
        Item: { ItemTypeID: 'type-skin', ItemID: 'level-1', Quantity: 1 },
        BasePrice: 2475, CurrencyID: 'vp', DiscountPercent: 0, DiscountedPrice: 2475, IsPromoItem: false
      },
      {
        Item: { ItemTypeID: 'type-buddy', ItemID: 'buddy-1', Quantity: 1 },
        BasePrice: 475, CurrencyID: 'vp', DiscountPercent: 0, DiscountedPrice: 475, IsPromoItem: true
      }
    ]
  },
  Bundles: [],
  BundleRemainingDurationInSeconds: 345_600
};

describe('getFeaturedBundles', () => {
  it('reads the item ids, both prices, the promo flag and the percent', async () => {
    const { getFeaturedBundles } = await loadStore();
    expect(getFeaturedBundles({ FeaturedBundle: FEATURED }, 1_000_000)).toEqual([{
      id: 'bundle-asset-id',
      endsAt: 1_000_000 + 345_600_000,
      endsInSeconds: 345_600,
      items: [
        { itemTypeId: 'type-skin', itemId: 'level-1', quantity: 1, basePrice: 2475, discountedPrice: 2475, discountPercent: 0, isPromoItem: false },
        { itemTypeId: 'type-buddy', itemId: 'buddy-1', quantity: 1, basePrice: 475, discountedPrice: 475, discountPercent: 0, isPromoItem: true }
      ]
    }]);
  });

  it('keys on the item id, which is the namespace the content index is built on', async () => {
    // Keying on Bundle.ID or on the row id would resolve no names and no images, and the failure would look like a content outage.
    const { getFeaturedBundles } = await loadStore();
    const [bundle] = getFeaturedBundles({ FeaturedBundle: FEATURED });
    expect(bundle.items.map((item) => item.itemId)).toEqual(['level-1', 'buddy-1']);
  });

  it('carries quantity through without multiplying it into the price', async () => {
    // BasePrice is the line's own price, not a unit price: a bundle with Quantity 2 still reports the price Riot sent, not twice it.
    const { getFeaturedBundles } = await loadStore();
    const [bundle] = getFeaturedBundles({ FeaturedBundle: { Bundle: {
      DataAssetID: 'b', Items: [{ Item: { ItemID: 'level-1', Quantity: 2 }, BasePrice: 2475, DiscountedPrice: 1980 }]
    } } });
    expect(bundle.items[0]).toMatchObject({ quantity: 2, basePrice: 2475, discountedPrice: 1980 });
  });

  it('returns EVERY bundle on sale, not just the first', async () => {
    // Measured live: Riot ran Champions 2026 (7 items, 33% off) alongside Warden Launch (4 items, 51% off).
    // Reading only the primary hid the larger discount completely.
    const { getFeaturedBundles } = await loadStore();
    const bundles = getFeaturedBundles({ FeaturedBundle: {
      Bundle: { DataAssetID: 'primary', Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
      Bundles: [
        { DataAssetID: 'primary', Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
        { DataAssetID: 'promo', Items: [{ Item: { ItemID: 'level-2' }, BasePrice: 200 }] }
      ]
    } });
    expect(bundles.map((bundle) => bundle.id)).toEqual(['primary', 'promo']);
    expect(bundles[1].items.map((item) => item.itemId)).toEqual(['level-2']);
  });

  it('dedupes the repeat of the primary bundle that Bundles carries as its first entry', async () => {
    // The live payload repeats it verbatim. Without this the same bundle draws two doors and two pages.
    const { getFeaturedBundles } = await loadStore();
    const bundles = getFeaturedBundles({ FeaturedBundle: {
      Bundle: { DataAssetID: 'same', Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
      Bundles: [
        { DataAssetID: 'same', Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
        { DataAssetID: 'same', Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] }
      ]
    } });
    expect(bundles).toHaveLength(1);
    expect(bundles[0].id).toBe('same');
  });

  it('takes each bundle OWN duration, not the top-level one', async () => {
    // The top-level FeaturedBundle.BundleRemainingDurationInSeconds is NOT the primary bundle's window:
    // live, it held the SECOND bundle's value (7.5 days) while the primary's own field said 21.5 days,
    // so preferring it under-reported the main bundle by a fortnight.
    const { getFeaturedBundles } = await loadStore();
    const [primary, promo] = getFeaturedBundles({ FeaturedBundle: {
      BundleRemainingDurationInSeconds: 648_000,
      Bundle: { DataAssetID: 'primary', DurationRemainingInSeconds: 1_857_600, Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
      Bundles: [
        { DataAssetID: 'primary', DurationRemainingInSeconds: 1_857_600, Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
        { DataAssetID: 'promo', DurationRemainingInSeconds: 648_000, Items: [{ Item: { ItemID: 'level-2' }, BasePrice: 200 }] }
      ]
    } }, 0);
    expect(primary.endsInSeconds).toBe(1_857_600);
    expect(primary.endsAt).toBe(1_857_600_000);
    expect(promo.endsInSeconds).toBe(648_000);
  });

  it('falls back to the top-level duration for a bundle that omits its own', async () => {
    const { getFeaturedBundles } = await loadStore();
    const [bundle] = getFeaturedBundles({ FeaturedBundle: {
      Bundle: { DataAssetID: 'b', Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
      BundleRemainingDurationInSeconds: 60
    } }, 0);
    expect(bundle.endsInSeconds).toBe(60);
  });

  it('reads Bundles when Bundle is absent', async () => {
    // Some payloads carry `Bundles` instead of `Bundle`: without this those accounts would never see the page.
    const { getFeaturedBundles } = await loadStore();
    const [bundle] = getFeaturedBundles({ FeaturedBundle: {
      Bundles: [{ ...FEATURED.Bundle }],
      BundleRemainingDurationInSeconds: 60
    } });
    expect(bundle.id).toBe('bundle-asset-id');
    expect(bundle.items.map((item) => item.itemId)).toEqual(['level-1', 'buddy-1']);
  });

  it('turns the remaining duration into an absolute instant', async () => {
    const { getFeaturedBundles } = await loadStore();
    expect(getFeaturedBundles({ FeaturedBundle: FEATURED }, 1_000_000)[0].endsAt).toBe(1_000_000 + 345_600_000);
  });

  it('returns an empty list when Riot sends no bundle at all', async () => {
    // The normal state outside a bundle sale: [] means "nothing on sale", not a failure, and the renderer
    // draws no door.
    const { getFeaturedBundles } = await loadStore();
    expect(getFeaturedBundles({ SkinsPanelLayout: {} })).toEqual([]);
    expect(getFeaturedBundles({ FeaturedBundle: null })).toEqual([]);
    expect(getFeaturedBundles(undefined)).toEqual([]);
  });

  it('drops an empty bundle rather than rendering an empty page', async () => {
    const { getFeaturedBundles } = await loadStore();
    expect(getFeaturedBundles({ FeaturedBundle: { Bundle: { DataAssetID: 'b', Items: [] }, Bundles: [] } })).toEqual([]);
    expect(getFeaturedBundles({ FeaturedBundle: { Bundles: [{ DataAssetID: 'b', Items: [] }] } })).toEqual([]);
  });

  it('keeps a bundle that has items when a sibling is empty', async () => {
    // The empty one must not take the good one down with it.
    const { getFeaturedBundles } = await loadStore();
    const bundles = getFeaturedBundles({ FeaturedBundle: { Bundles: [
      { DataAssetID: 'empty', Items: [] },
      { DataAssetID: 'real', Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] }
    ] } });
    expect(bundles.map((bundle) => bundle.id)).toEqual(['real']);
  });

  it('drops a bundle with no DataAssetID', async () => {
    // The id is what the renderer keys the door and the page on; without it two bundles are indistinguishable.
    const { getFeaturedBundles } = await loadStore();
    const bundles = getFeaturedBundles({ FeaturedBundle: { Bundles: [
      { Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 100 }] },
      { DataAssetID: 'real', Items: [{ Item: { ItemID: 'level-2' }, BasePrice: 100 }] }
    ] } });
    expect(bundles.map((bundle) => bundle.id)).toEqual(['real']);
  });

  it('reports a missing duration as null instead of NaN', async () => {
    // NaN would reach the countdown and print '--:--:--' forever; null means "open, end unknown", and the contents are still readable.
    const { getFeaturedBundles } = await loadStore();
    const [bundle] = getFeaturedBundles({ FeaturedBundle: { ...FEATURED, BundleRemainingDurationInSeconds: undefined } });
    expect(bundle.endsInSeconds).toBeNull();
    expect(bundle.endsAt).toBeNull();
  });

  it('drops an entry with no identifiable item and keeps the rest', async () => {
    const { getFeaturedBundles } = await loadStore();
    const [bundle] = getFeaturedBundles({ FeaturedBundle: { Bundle: {
      DataAssetID: 'b',
      Items: [
        { Item: { ItemTypeID: 'type' }, BasePrice: 100 },
        { Item: { ItemID: '', ItemTypeID: 'type' }, BasePrice: 200 },
        { Item: { ItemID: 'level-9', ItemTypeID: 'type' }, BasePrice: 300 }
      ]
    } } });
    expect(bundle.items.map((item) => item.itemId)).toEqual(['level-9']);
  });

  it('reports a non-numeric price or percent as null instead of NaN', async () => {
    const { getFeaturedBundles } = await loadStore();
    const [bundle] = getFeaturedBundles({ FeaturedBundle: { Bundle: {
      DataAssetID: 'b',
      Items: [{ Item: { ItemID: 'level-1' }, BasePrice: 'free', DiscountedPrice: null, DiscountPercent: 'lots' }]
    } } });
    expect(bundle.items[0]).toEqual({
      itemTypeId: null, itemId: 'level-1', quantity: 1,
      basePrice: null, discountedPrice: null, discountPercent: null, isPromoItem: false
    });
  });

  it('normalises the FRACTION this endpoint sends into a whole percent', async () => {
    // Measured on a live Champions 2026 bundle: FeaturedBundle.DiscountPercent arrives as 0.34 / 0.3 / 0.29
    // while the Night Market sends 34 / 30 — stored raw, the field would mean two things depending on the path.
    const { getFeaturedBundles } = await loadStore();
    const percents = (values) => getFeaturedBundles({ FeaturedBundle: { Bundle: {
      DataAssetID: 'b',
      Items: values.map((v, i) => ({ Item: { ItemID: `level-${i}` }, BasePrice: 100, DiscountedPrice: 66, DiscountPercent: v }))
    } } })[0].items.map((item) => item.discountPercent);

    // Fractions, exactly as the live payload sends them.
    expect(percents([0.34, 0.3, 0.29, 0.32])).toEqual([34, 30, 29, 32]);
    // A whole percent is left alone, so the same parser is safe if Riot ever switches scales.
    expect(percents([34, 30])).toEqual([34, 30]);
    // The boundaries: 0 is 0%, and 1 is a full 100% — not a 1% discount.
    expect(percents([0, 1])).toEqual([0, 100]);
  });
});
