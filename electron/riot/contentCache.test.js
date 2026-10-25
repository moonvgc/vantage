import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// contentCache memoises the skin index in a module-level promise: every test needs a fresh module graph AND fetch stub.
const LEVEL_UUID = 'level-uuid-reaver';
const OTHER_LEVEL_UUID = 'level-uuid-oni';
// The values below are copied verbatim from a real response: highlightColor is EIGHT digits, RRGGBBAA with alpha 33.
const PREMIUM_TIER_UUID = 'tier-premium';
// Bundle, buddy, spray and player card ids, deliberately in a different namespace from the skin level ids:
// a bundle is matched through /v1/bundles[].uuid, an accessory through its own entry uuid in its own list.
const BUNDLE_UUID = 'bundle-uuid-elderflame';
const BUDDY_UUID = 'buddy-uuid-elderflame';
// A bundle keys its buddy by the buddy's LEVEL uuid, not its own (measured on a live Champions 2026 bundle): the index needs both keys.
const BUDDY_LEVEL_UUID = 'buddy-level-uuid-elderflame';
const SPRAY_UUID = 'spray-uuid-elderflame';
const CARD_UUID = 'card-uuid-elderflame';

// The stub routes per URL: one shared body for all five endpoints would make every bundle test pass with
// no label resolved. `accessoriesOk` kills the three accessory lists together; `bundlesOk` is separate (different memo).
function stubContentApi({ tiersOk = true, accessoriesOk = true, bundlesOk = true, bundles: bundleList = null, bundlesMalformed = false, bundlesBody, skinsBody } = {}) {
  const skins = [
    {
      displayName: 'Reaver Vandal',
      displayIcon: 'reaver.png',
      contentTierUuid: PREMIUM_TIER_UUID,
      levels: [{ uuid: LEVEL_UUID, displayName: 'Reaver Vandal', streamedVideo: 'reaver.mp4', displayIcon: 'reaver-level.png' }],
      chromas: [{ displayName: 'Reaver Vandal (Variant 1)', swatch: 'reaver-swatch.png', streamedVideo: 'reaver-variant.mp4', fullRender: 'reaver-render.png' }]
    },
    {
      displayName: 'Oni Phantom',
      displayIcon: 'oni.png',
      // No tier: 40 of 1405 skins Riot lists are like this. The skin must still show up.
      contentTierUuid: null,
      levels: [{ uuid: OTHER_LEVEL_UUID, displayName: 'Oni Phantom', streamedVideo: 'oni.mp4', displayIcon: 'oni-level.png' }],
      chromas: []
    }
  ];
  const tiers = [
    { uuid: PREMIUM_TIER_UUID, rank: 2, displayName: 'Premium Edition', highlightColor: 'd1548d33' },
    { uuid: 'tier-ultra', rank: 4, displayName: 'Ultra Edition', highlightColor: 'fad66333' }
  ];
  const buddies = [{ uuid: BUDDY_UUID, displayName: 'Elderflame Buddy', displayIcon: 'buddy.png', levels: [{ uuid: BUDDY_LEVEL_UUID }] }];
  const sprays = [{ uuid: SPRAY_UUID, displayName: 'Elderflame Spray', displayIcon: 'spray-icon.png', fullIcon: 'spray-full.png' }];
  const cards = [{ uuid: CARD_UUID, displayName: 'Elderflame Card', displayIcon: 'card-icon.png', largeArt: 'card-large.png' }];
  const bundles = bundleList ?? [{
    uuid: BUNDLE_UUID, displayName: 'Elderflame', displayIcon: 'bundle-square.png',
    displayIcon2: 'bundle-wide.png', verticalPromoImage: 'bundle-tall.png', logoIcon: null
  }];
  globalThis.fetch = vi.fn(async (url) => {
    const target = String(url);
    const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
    const down = { ok: false, status: 503, json: async () => ({}) };
    if (target.includes('/contenttiers')) return tiersOk ? ok(tiers) : down;
    if (target.includes('/buddies')) return accessoriesOk ? ok(buddies) : down;
    if (target.includes('/sprays')) return accessoriesOk ? ok(sprays) : down;
    if (target.includes('/playercards')) return accessoriesOk ? ok(cards) : down;
    // A 200 whose body is not JSON: the parse throws, which must not be mistaken for the service being down.
    if (target.includes('/bundles')) {
      if (bundlesMalformed) return { ok: true, status: 200, json: async () => { throw new Error('Unexpected token < in JSON'); } };
      // `null`, `{}` and `{ data: null }` are all 200s carrying no list, and none may read as "not in the list".
      if (bundlesBody !== undefined) return { ok: true, status: 200, json: async () => bundlesBody };
      return bundlesOk ? ok(bundles) : down;
    }
    // The skins route is the fallthrough: `skinsBody` answers it with the wrong shape a `?? []` would accept as empty.
    if (skinsBody !== undefined) return { ok: true, status: 200, json: async () => skinsBody };
    return ok(skins);
  });
}

async function loadResolver() {
  vi.resetModules();
  stubContentApi();
  const module = await import('./contentCache.js');
  return module.resolveDailyOffers;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('resolveDailyOffers', () => {
  beforeEach(() => { stubContentApi(); });

  it('forwards the offerId as `id`, which the renderer uses as its React key', async () => {
    const resolveDailyOffers = await loadResolver();
    const [offer] = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    expect(offer.id).toBe(LEVEL_UUID);
  });

  it('keeps every offer id distinct so list keys never collide', async () => {
    const resolveDailyOffers = await loadResolver();
    const offers = await resolveDailyOffers([
      { offerId: LEVEL_UUID, price: 1775 },
      { offerId: OTHER_LEVEL_UUID, price: 2175 }
    ]);
    expect(offers.map((offer) => offer.id)).toEqual([LEVEL_UUID, OTHER_LEVEL_UUID]);
    expect(new Set(offers.map((offer) => offer.id)).size).toBe(2);
  });

  it('keeps the id even when the skin is unknown, so the key is never undefined', async () => {
    const resolveDailyOffers = await loadResolver();
    const [offer] = await resolveDailyOffers([{ offerId: 'not-in-content-index', price: 875 }]);
    expect(offer.id).toBe('not-in-content-index');
    expect(offer.name).toBe('Unknown skin');
  });

  it('resolves the skin payload and preserves the price', async () => {
    const resolveDailyOffers = await loadResolver();
    const [offer] = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    expect(offer).toMatchObject({
      name: 'Reaver Vandal',
      image: 'reaver-level.png',
      video: 'reaver.mp4',
      price: 1775
    });
  });

  it('returns an empty list for an empty store without fetching', async () => {
    const resolveDailyOffers = await loadResolver();
    expect(await resolveDailyOffers([])).toEqual([]);
  });
});

// One blip in the content service must not break every account for the rest of the session: the rejected
// promise used to be remembered, so each later account failed instantly without even making a request.
describe('a failed content fetch is not remembered', () => {
  it('retries on the next account and succeeds once the service is back', async () => {
    const resolveDailyOffers = await loadResolver();

    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }])).rejects.toThrow(/skin content/i);

    // Service recovers.
    stubContentApi();
    const calls = globalThis.fetch.mock.calls.length;
    const [offer] = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(calls);
    expect(offer.name).toBe('Reaver Vandal');
  });

  it('does not re-fetch while the cached index is still valid', async () => {
    const resolveDailyOffers = await loadResolver();
    await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    const callsAfterFirst = globalThis.fetch.mock.calls.length;
    await resolveDailyOffers([{ offerId: OTHER_LEVEL_UUID, price: 2175 }]);
    expect(globalThis.fetch.mock.calls.length).toBe(callsAfterFirst);
  });
});

// The same trap as the bundle list, on the route that feeds the daily store and the Night Market: these
// shapes are valid JSON, so nothing throws on its own, and a `?? []` would memoise a SUCCESSFUL empty skin
// index for the session — every card on two other screens reading "Unknown skin", with no note and no retry.
describe('a skin list in the wrong shape is a failure, not an empty store', () => {
  const skinsCalls = () => globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/weapons/skins')).length;

  it('degrades with the note, then retries and recovers', async () => {
    for (const body of [null, {}, { data: null }, { data: {} }, 'nope']) {
      vi.resetModules();
      stubContentApi();
      const working = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = vi.fn(async (url) => {
        if (String(url).includes('/weapons/skins')) {
          calls += 1;
          if (calls === 1) return { ok: true, status: 200, json: async () => body };
        }
        return working(url);
      });
      const { resolveDailyOffersOrFallback } = await import('./contentCache.js');
      const label = JSON.stringify(body);

      // Wrong shape: the account degrades the documented way — the note plus Riot's own offers and prices.
      const first = await resolveDailyOffersOrFallback([{ offerId: LEVEL_UUID, price: 1775 }]);
      expect(first.contentUnavailable, `contentUnavailable for ${label}`).toBe(true);
      expect(first.offers[0], `price for ${label}`).toMatchObject({ id: LEVEL_UUID, price: 1775, name: 'Unknown skin' });

      // A real list now, and it has to be REQUESTED again: a memoised empty index makes no second request.
      const second = await resolveDailyOffersOrFallback([{ offerId: LEVEL_UUID, price: 1775 }]);
      expect(calls, `retry after ${label}`).toBe(2);
      expect(second.contentUnavailable, `recovered for ${label}`).toBe(false);
      expect(second.offers[0].name, `recovered name for ${label}`).toBe('Reaver Vandal');
    }
  });

  it('still accepts an empty skin list as a real answer, and caches it', async () => {
    // The other side of the guard: `{ data: [] }` is a well-formed answer. Two resolves with a counted route prove it was cached, not retried.
    vi.resetModules();
    stubContentApi({ skinsBody: { data: [] } });
    const { resolveDailyOffers } = await import('./contentCache.js');

    const first = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    const second = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);

    expect(skinsCalls()).toBe(1);
    expect(first[0]).toMatchObject({ id: LEVEL_UUID, name: 'Unknown skin', price: 1775 });
    expect(second[0]).toMatchObject({ id: LEVEL_UUID, name: 'Unknown skin' });
  });
});

// Skin names and previews are decorative third-party data: losing them must not hide a store Riot served.
describe('resolveDailyOffersOrFallback', () => {
  it('keeps the store usable, with prices, when the content service is down', async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { resolveDailyOffersOrFallback } = await import('./contentCache.js');

    const result = await resolveDailyOffersOrFallback([
      { offerId: LEVEL_UUID, price: 1775 },
      { offerId: OTHER_LEVEL_UUID, price: 2175 }
    ]);

    expect(result.contentUnavailable).toBe(true);
    expect(result.offers.map((offer) => offer.id)).toEqual([LEVEL_UUID, OTHER_LEVEL_UUID]);
    expect(result.offers.map((offer) => offer.price)).toEqual([1775, 2175]);
    expect(result.offers.every((offer) => offer.name === 'Unknown skin')).toBe(true);
    expect(result.offers.every((offer) => offer.image === null && offer.video === null)).toBe(true);
  });

  it('flags nothing and names every skin when the content service works', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveDailyOffersOrFallback } = await import('./contentCache.js');

    const result = await resolveDailyOffersOrFallback([{ offerId: LEVEL_UUID, price: 1775 }]);

    expect(result.contentUnavailable).toBe(false);
    expect(result.offers[0].name).toBe('Reaver Vandal');
  });

  it('gives the fallback records the same shape as resolved ones', async () => {
    const resolveDailyOffers = await loadResolver();
    const [resolved] = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    const { unavailableDailyOffers } = await import('./contentCache.js');
    const [fallback] = unavailableDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    expect(Object.keys(fallback).sort()).toEqual(Object.keys(resolved).sort());
  });
});

// The tier is the skin's own colour — the same colour as the Select/Deluxe/Premium/Exclusive/Ultra markers
// in game — and its source is the SECOND endpoint of the same content service.
describe('skin tier', () => {
  it('attaches rank, label and colour to a resolved offer', async () => {
    const resolveDailyOffers = await loadResolver();
    const [offer] = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    expect(offer.tier).toEqual({ rank: 2, label: 'Premium Edition', color: '#D1548D' });
  });

  it('takes SIX hex digits out of the eight Riot sends', async () => {
    // highlightColor = RRGGBBAA with alpha 33. Handing 'd1548d33' straight to CSS produces a colour that is
    // 20% transparent, and that reads as "the tier is washed out" — not as a parsing bug.
    const resolveDailyOffers = await loadResolver();
    const [offer] = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    expect(offer.tier.color).toBe('#D1548D');
    expect(offer.tier.color).toHaveLength(7);
    expect(offer.tier.color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('keeps an offer whose skin Riot lists no tier for, with a null tier', async () => {
    // 40 of 1405 skins have no contentTierUuid. A skin without a tier is still something you can buy.
    const resolveDailyOffers = await loadResolver();
    const [offer] = await resolveDailyOffers([{ offerId: OTHER_LEVEL_UUID, price: 2175 }]);
    expect(offer.name).toBe('Oni Phantom');
    expect(offer.tier).toBeNull();
  });

  it('survives a failed tier fetch: names still resolve, tier is null', async () => {
    // The tier list is decoration on top of the store: if the service dies, the card only loses its colour, it does not disappear.
    vi.resetModules();
    stubContentApi({ tiersOk: false });
    const { resolveDailyOffers } = await import('./contentCache.js');
    const [offer] = await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    expect(offer.name).toBe('Reaver Vandal');
    expect(offer.tier).toBeNull();
  });

  it('reads the tier list once per session, not once per account', async () => {
    const resolveDailyOffers = await loadResolver();
    await resolveDailyOffers([{ offerId: LEVEL_UUID, price: 1775 }]);
    const tierCalls = () => globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/contenttiers')).length;
    expect(tierCalls()).toBe(1);
    await resolveDailyOffers([{ offerId: OTHER_LEVEL_UUID, price: 2175 }]);
    expect(tierCalls()).toBe(1);
  });
});


// A Night Market offer = a daily store offer + three extra fields, decorated by the SAME index. Its discount must
// survive even on the fallback path: the skin name may go, the discount number that is the reason this page exists may not.
describe('resolveNightMarketOffers', () => {
  const market = (offers) => ({ offers, endsAt: null });

  it('decorates the discounted offers from the same content index', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveNightMarketOffers } = await import('./contentCache.js');
    const offers = await resolveNightMarketOffers([
      { offerId: LEVEL_UUID, price: 1172, originalPrice: 1775, discountPercent: 34, seen: false },
      { offerId: OTHER_LEVEL_UUID, price: 2354, originalPrice: 2675, discountPercent: 12, seen: true }
    ]);
    expect(offers[0]).toMatchObject({
      id: LEVEL_UUID, name: 'Reaver Vandal', image: 'reaver-level.png', video: 'reaver.mp4',
      price: 1172, originalPrice: 1775, discountPercent: 34, seen: false
    });
    // Cards on the night market page open the same showcase, so levels/chromas must come along.
    expect(offers[0].levels.length).toBeGreaterThan(0);
    // And the tier comes along too — the card's colour comes from here.
    expect(offers[0].tier).toEqual({ rank: 2, label: 'Premium Edition', color: '#D1548D' });
  });

  it('keeps an offer whose skin Riot lists no tier for, with a null tier', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveNightMarketOffers } = await import('./contentCache.js');
    const [offer] = await resolveNightMarketOffers([{ offerId: OTHER_LEVEL_UUID, price: 100, originalPrice: 200, discountPercent: 50, seen: false }]);
    expect(offer.name).toBe('Oni Phantom');
    expect(offer.tier).toBeNull();
  });

  it('degrades to unknown names without losing the discounts', async () => {
    // The content service is a third party. Losing it must not hide the offers from Riot.
    vi.resetModules();
    stubContentApi({ tiersOk: false });
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { resolveNightMarketOrFallback } = await import('./contentCache.js');
    const result = await resolveNightMarketOrFallback(market([
      { offerId: LEVEL_UUID, price: 1172, originalPrice: 1775, discountPercent: 34, seen: false }
    ]));
    expect(result.contentUnavailable).toBe(true);
    expect(result.offers[0]).toMatchObject({
      id: LEVEL_UUID, name: 'Unknown skin', image: null, price: 1172, originalPrice: 1775, discountPercent: 34, tier: null
    });
  });

  it('flags nothing when the content service works', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveNightMarketOrFallback } = await import('./contentCache.js');
    const result = await resolveNightMarketOrFallback(market([
      { offerId: LEVEL_UUID, price: 1172, originalPrice: 1775, discountPercent: 34, seen: false }
    ]));
    expect(result.contentUnavailable).toBe(false);
    expect(result.offers[0].name).toBe('Reaver Vandal');
  });

  it('gives the fallback records the same shape as resolved ones', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveNightMarketOffers, resolveNightMarketOrFallback } = await import('./contentCache.js');
    const [resolved] = await resolveNightMarketOffers([{ offerId: LEVEL_UUID, price: 1, originalPrice: 2, discountPercent: 50, seen: false }]);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const fallback = await resolveNightMarketOrFallback({ offers: [{ offerId: LEVEL_UUID, price: 1, originalPrice: 2, discountPercent: 50, seen: false }], endsAt: null });
    expect(Object.keys(fallback.offers[0]).sort()).toEqual(Object.keys(resolved).sort());
  });

  it('shares the one index: no extra fetch for a second market load', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveNightMarketOffers } = await import('./contentCache.js');
    await resolveNightMarketOffers([{ offerId: LEVEL_UUID, price: 1, originalPrice: 2, discountPercent: 50, seen: false }]);
    const callsAfterFirst = globalThis.fetch.mock.calls.length;
    await resolveNightMarketOffers([{ offerId: OTHER_LEVEL_UUID, price: 1, originalPrice: 2, discountPercent: 50, seen: false }]);
    expect(globalThis.fetch.mock.calls.length).toBe(callsAfterFirst);
  });
});

// Bundle: one set holding skins, a melee, a buddy, a spray and a card. Unlike the two paths above, its
// numbers arrive PER ITEM from Riot — full price, discounted price, percent and the promo flag — so no price
// is reconstructed, and only the labels and the art come from the third party.
//
// `included` (IsPromoItem) is the flag most easily misread: a promo item does NOT add to the bundle price,
// yet it still carries a BasePrice — and that difference is exactly the bundle discount.
describe('resolveFeaturedBundles', () => {
  // The shape getFeaturedBundle emits: this resolver takes parsed input, so anything else would test something that never happens.
  const item = (itemId, { base, discounted = null, percent = null, promo = false, quantity = 1, itemTypeId = 'type' } = {}) => ({
    itemTypeId, itemId, quantity, basePrice: base, discountedPrice: discounted, discountPercent: percent, isPromoItem: promo
  });

  // One skin and one promo melee at full price, three accessories at zero: baseTotal > price, so the discount is positive.
  const BUNDLE = {
    id: BUNDLE_UUID,
    endsAt: 1_700_000_000_000,
    endsInSeconds: 345_600,
    items: [
      item(LEVEL_UUID, { base: 2475, discounted: 2475, percent: 0 }),
      item(OTHER_LEVEL_UUID, { base: 4950, discounted: 4950, percent: 0 }),
      item(BUDDY_UUID, { base: 475, discounted: 0, promo: true }),
      item(SPRAY_UUID, { base: 325, discounted: 0, promo: true }),
      item(CARD_UUID, { base: 375, discounted: 0, promo: true })
    ]
  };

  it('resolves a skin item from the skin index, with everything the showcase modal reads', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([BUNDLE]))[0];

    // Exactly what SkinPreviewModal reads, which is why the existing showcase modal needs no change to open from here.
    expect(bundle.items[0]).toMatchObject({
      id: LEVEL_UUID, kind: 'skin', name: 'Reaver Vandal', image: 'reaver-level.png', video: 'reaver.mp4',
      tier: { rank: 2, label: 'Premium Edition', color: '#D1548D' }
    });
    expect(bundle.items[0].levels.length).toBeGreaterThan(0);
    expect(bundle.items[0].chromas.length).toBeGreaterThan(0);
  });

  it('resolves buddy, spray and card from the accessory index with the right kind and image', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const [buddy, spray, card] = ((await resolveFeaturedBundles([BUNDLE]))[0]).items.slice(2);

    expect(buddy).toMatchObject({ kind: 'buddy', name: 'Elderflame Buddy', image: 'buddy.png', tier: null });
    // Sprays and cards ship a separate high-resolution version; that is the one used, not the icon.
    expect(spray).toMatchObject({ kind: 'spray', name: 'Elderflame Spray', image: 'spray-full.png' });
    expect(card).toMatchObject({ kind: 'card', name: 'Elderflame Card', image: 'card-large.png' });
    // Accessories have no levels and no variants, and the card never has to know that.
    expect([buddy.levels, buddy.chromas, spray.video, card.levels]).toEqual([[], [], null, []]);
  });

  it('drops an item nothing can name, instead of drawing an "Unknown item" card', async () => {
    // The grid shows only what it can label (a nameless, artless card reads as a broken app); the item still
    // counts in the totals below, so the price Riot charges stays exact.
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([{
      ...BUNDLE,
      items: [item(LEVEL_UUID, { base: 2475, discounted: 2475 }), item('not-in-any-index', { base: 100, discounted: 100 })]
    }]))[0];

    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].id).toBe(LEVEL_UUID);
    expect(bundle.baseTotal).toBe(2575);
    expect(bundle.price).toBe(2575);
  });

  it('keeps unlabelled items on the OUTAGE path, where the page explains why', async () => {
    // The opposite call: when the service is down EVERY item is unlabelled, the page prints a note saying so,
    // and dropping them all would leave an empty grid hiding what Riot is selling. Kind still comes from
    // Riot's ItemTypeID, so a card can say "BUDDY" even when it cannot say which buddy.
    vi.resetModules();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { resolveFeaturedBundlesOrFallback } = await import('./contentCache.js');
    const result = await resolveFeaturedBundlesOrFallback([{
      ...BUNDLE,
      items: [
        item(BUDDY_UUID, { base: 475, discounted: 323, itemTypeId: 'dd3bf334-87f3-40bd-b043-682a57a8dc3a' }),
        item(SPRAY_UUID, { base: 325, discounted: 231, itemTypeId: 'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475' }),
        item(CARD_UUID, { base: 375, discounted: 263, itemTypeId: '3f296c07-64c3-494c-923b-fe692a4fa1bd' })
      ]
    }]);

    expect(result.contentUnavailable).toBe(true);
    expect(result.bundles[0].items.map((entry) => entry.kind)).toEqual(['buddy', 'spray', 'card']);
    expect(result.bundles[0].items.every((entry) => entry.name === 'Unknown item')).toBe(true);
    expect(result.bundles[0].price).toBe(323 + 231 + 263);
    expect(result.bundles[0].baseTotal).toBe(475 + 325 + 375);
  });

  it('resolves an accessory sent under its LEVEL uuid, the way a real bundle sends it', async () => {
    // The bug this pins, found only by reading a live Champions 2026 payload: its buddy arrived as
    // `eb86ef90-…`, a LEVEL of buddy `fb211961-…` rather than the buddy's own uuid — keying extras only by
    // entry uuid left that one item unnameable while the six others in the same bundle resolved.
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([{
      ...BUNDLE,
      items: [item(BUDDY_LEVEL_UUID, { base: 475, discounted: 323 })]
    }]))[0];

    expect(bundle.items[0]).toMatchObject({
      id: BUDDY_LEVEL_UUID, kind: 'buddy', name: 'Elderflame Buddy', image: 'buddy.png'
    });
    expect(bundle.items[0]).toMatchObject({ price: 323, basePrice: 475 });
  });

  it('still resolves the accessory under its own uuid as well', async () => {
    // Both keys are indexed so whichever id a payload uses resolves; indexing only the level uuid would trade one unnameable item for another.
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([{ ...BUNDLE, items: [item(BUDDY_UUID, { base: 475, discounted: 323 })] }]))[0];
    expect(bundle.items[0]).toMatchObject({ kind: 'buddy', name: 'Elderflame Buddy' });
  });

  it('computes both totals and the discount percent from the prices as sent', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([BUNDLE]))[0];

    expect(bundle.baseTotal).toBe(2475 + 4950 + 475 + 325 + 375);
    expect(bundle.price).toBe(2475 + 4950);
    expect(bundle.discountPercent).toBe(Math.round((1 - 7425 / 8600) * 100));
    expect(bundle.discountPercent).toBeGreaterThan(0);
  });

  it('turns the real Elderflame shape into the numbers the page prints', async () => {
    // Four skins at full price, one promo dagger, three promo accessories: the shape that proves both
    // baseTotal > price and a positive discount — a smaller fixture can pass with the price computed wrongly.
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const skins = [LEVEL_UUID, OTHER_LEVEL_UUID, 'skin-3', 'skin-4'];
    const bundle = (await resolveFeaturedBundles([{
      id: BUNDLE_UUID,
      endsAt: 1_700_000_000_000,
      endsInSeconds: 345_600,
      items: [
        ...skins.map((itemId) => item(itemId, { base: 2475, discounted: 2475, percent: 0 })),
        item('melee-dagger', { base: 4950, discounted: 0, promo: true }),
        item(BUDDY_UUID, { base: 475, discounted: 0, promo: true }),
        item(SPRAY_UUID, { base: 325, discounted: 0, promo: true }),
        item(CARD_UUID, { base: 375, discounted: 0, promo: true })
      ]
    }]))[0];

    expect(bundle.baseTotal).toBe(16_025);
    expect(bundle.price).toBe(9_900);
    expect(bundle.baseTotal).toBeGreaterThan(bundle.price);
    expect(bundle.discountPercent).toBe(38);
    // Only the five items this stub can label are shown: the extra skins and the melee are not in its index.
    expect(bundle.items).toHaveLength(5);
    // Why the totals must come from the PARSED items: baseTotal still holds the 4,950 melee that has no card.
    expect(bundle.baseTotal).toBeGreaterThan(bundle.items.reduce((sum, entry) => sum + entry.basePrice, 0));
  });

  it('falls back to the full price for an item Riot sent no discounted price for', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([{ ...BUNDLE, items: [item(LEVEL_UUID, { base: 2475 })] }]))[0];
    expect(bundle.price).toBe(2475);
    expect(bundle.baseTotal).toBe(2475);
    // Two equal totals are not a 0% discount — the chip is dropped rather than printed as -0%.
    expect(bundle.discountPercent).toBeNull();
  });

  it('takes the name and the key art from the bundle list', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([BUNDLE]))[0];

    expect(bundle.name).toBe('Elderflame');
    // displayIcon2 (wide key art) and verticalPromoImage; logoIcon is null for Elderflame, hence the text name.
    expect(bundle.art).toEqual({ wide: 'bundle-wide.png', tall: 'bundle-tall.png', logo: null });
  });

  it('never stretches the square logo across the hero box', async () => {
    // The one trap this resolver has: displayIcon is a square logo, and using it as the hero fallback would
    // put a stretched square behind the name. An entry carrying ONLY displayIcon must leave `wide` null and
    // let the renderer fall through to tall, and then to NO ART.
    vi.resetModules();
    stubContentApi({ bundles: [{ uuid: BUNDLE_UUID, displayName: 'Elderflame', displayIcon: 'bundle-square.png' }] });
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([BUNDLE]))[0];

    expect(bundle.art).toEqual({ wide: null, tall: null, logo: null });
    // The name still resolves from the same entry: art and name are independent fields.
    expect(bundle.name).toBe('Elderflame');
  });

  it('uses the tall poster when there is no wide key art', async () => {
    vi.resetModules();
    stubContentApi({ bundles: [{ uuid: BUNDLE_UUID, displayName: 'Elderflame', verticalPromoImage: 'bundle-tall.png' }] });
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([BUNDLE]))[0];

    expect(bundle.art).toEqual({ wide: null, tall: 'bundle-tall.png', logo: null });
  });

  it('carries the window through untouched', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([BUNDLE]))[0];
    expect(bundle.endsAt).toBe(BUNDLE.endsAt);
    expect(bundle.endsInSeconds).toBe(BUNDLE.endsInSeconds);
  });

  it('keeps the items when the bundle is not in the list', async () => {
    // An older bundle no longer in /v1/bundles: the list only ever supplied its name and its art.
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const bundle = (await resolveFeaturedBundles([{ ...BUNDLE, id: 'bundle-not-listed' }]))[0];
    expect(bundle.name).toBe('UNKNOWN BUNDLE');
    expect(bundle.art).toEqual({ wide: null, tall: null, logo: null });
    expect(bundle.items).toHaveLength(5);
    expect(bundle.price).toBe(7425);
  });

  it('resolves skins even when every accessory endpoint is down', async () => {
    // Accessories are decoration on a bundle Riot served: losing those lists must not fail the page or be reported as an outage.
    vi.resetModules();
    stubContentApi({ accessoriesOk: false });
    const { resolveFeaturedBundlesOrFallback } = await import('./contentCache.js');
    const result = await resolveFeaturedBundlesOrFallback([BUNDLE]);

    expect(result.contentUnavailable).toBe(false);
    expect(result.bundles[0].items[0]).toMatchObject({ kind: 'skin', name: 'Reaver Vandal' });
    // The three accessory cards are GONE rather than drawn as "Unknown item": a nameless card reads as a broken app.
    expect(result.bundles[0].items.map((entry) => entry.kind)).toEqual(['skin', 'skin']);
    // Money is untouched by that: the accessory prices are still inside Riot's totals.
    expect(result.bundles[0].price).toBe(7425);
    expect(result.bundles[0].baseTotal).toBe(8600);
  });

  it('keeps the item labels when only the bundle list is down', async () => {
    // The bundle list is the most optional part of the service: it supplies a name and a picture, and losing
    // it must cost exactly those two things — the items keep their names, their kinds, their prices and the window.
    vi.resetModules();
    stubContentApi({ bundlesOk: false });
    const { resolveFeaturedBundlesOrFallback } = await import('./contentCache.js');
    const result = await resolveFeaturedBundlesOrFallback([BUNDLE]);

    expect(result.contentUnavailable).toBe(false);
    expect(result.bundles[0].name).toBe('UNKNOWN BUNDLE');
    expect(result.bundles[0].art).toEqual({ wide: null, tall: null, logo: null });
    expect(result.bundles[0].items[0]).toMatchObject({ kind: 'skin', name: 'Reaver Vandal', price: 2475 });
    expect(result.bundles[0].items[2]).toMatchObject({ kind: 'buddy', name: 'Elderflame Buddy' });
    expect(result.bundles[0].price).toBe(7425);
    expect(result.bundles[0].endsAt).toBe(BUNDLE.endsAt);
  });

  it('treats an unparseable bundle list the same as a missing one', async () => {
    // A 200 whose body is not JSON fails in the parse, not in the request, and it has to degrade exactly like
    // a 503: the name and the art go, the items and their labels do not, and it is not a content outage.
    vi.resetModules();
    stubContentApi({ bundlesMalformed: true });
    const { resolveFeaturedBundlesOrFallback } = await import('./contentCache.js');
    const result = await resolveFeaturedBundlesOrFallback([BUNDLE]);

    expect(result.contentUnavailable).toBe(false);
    expect(result.bundles[0].name).toBe('UNKNOWN BUNDLE');
    expect(result.bundles[0].art).toEqual({ wide: null, tall: null, logo: null });
    expect(result.bundles[0].items[0]).toMatchObject({ kind: 'skin', name: 'Reaver Vandal' });
    expect(result.bundles[0].price).toBe(7425);
    expect(result.bundles[0].endsAt).toBe(BUNDLE.endsAt);
  });

  it('retries the bundle list after a failure instead of remembering the empty result', async () => {
    // The session-long failure mode this guards: resolving to an empty map on failure would memoise it, so one
    // blip would leave every later account on UNKNOWN BUNDLE with no art until restart. The build rejects instead.
    vi.resetModules();
    stubContentApi();
    const working = globalThis.fetch;
    let bundleCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/bundles')) {
        bundleCalls += 1;
        if (bundleCalls === 1) return { ok: false, status: 503, json: async () => ({}) };
      }
      return working(url);
    });
    const { resolveFeaturedBundles } = await import('./contentCache.js');

    const first = (await resolveFeaturedBundles([BUNDLE]))[0];
    // Degraded, not broken: the metadata is gone and everything Riot sent is still there.
    expect(first.name).toBe('UNKNOWN BUNDLE');
    expect(first.items[0]).toMatchObject({ kind: 'skin', name: 'Reaver Vandal', price: 2475 });

    const second = (await resolveFeaturedBundles([BUNDLE]))[0];
    expect(bundleCalls).toBe(2);
    expect(second.name).toBe('Elderflame');
    expect(second.art).toEqual({ wide: 'bundle-wide.png', tall: 'bundle-tall.png', logo: null });
  });

  it('rejects a 200 that carries no list, rather than reading it as an empty one', async () => {
    // The shapes below are the trap: valid JSON, so nothing throws on its own, and `?? []` would turn each of
    // them into a SUCCESSFUL empty index — memoised for the session, so nothing ever asks again.
    for (const body of [null, {}, { data: null }, { data: {} }, 'nope']) {
      vi.resetModules();
      stubContentApi();
      const working = globalThis.fetch;
      let bundleCalls = 0;
      globalThis.fetch = vi.fn(async (url) => {
        if (String(url).includes('/bundles')) {
          bundleCalls += 1;
          if (bundleCalls === 1) return { ok: true, status: 200, json: async () => body };
        }
        return working(url);
      });
      const { resolveFeaturedBundles } = await import('./contentCache.js');
      const label = JSON.stringify(body);

      // Wrong shape: the list is decoration, so the metadata goes and Riot's data stays — and this is NOT an outage.
      const first = (await resolveFeaturedBundles([BUNDLE]))[0];
      expect(first.name, `name for ${label}`).toBe('UNKNOWN BUNDLE');
      expect(first.art, `art for ${label}`).toEqual({ wide: null, tall: null, logo: null });
      expect(first.items[0], `items for ${label}`).toMatchObject({ kind: 'skin', name: 'Reaver Vandal', price: 2475 });
      expect(first.price, `price for ${label}`).toBe(7425);
      expect(first.endsAt, `endsAt for ${label}`).toBe(BUNDLE.endsAt);

      // A real list now, and it has to be REQUESTED again: a memoised empty map makes no second request.
      const second = (await resolveFeaturedBundles([BUNDLE]))[0];
      expect(bundleCalls, `retry after ${label}`).toBe(2);
      expect(second.name, `recovered name for ${label}`).toBe('Elderflame');
      expect(second.art, `recovered art for ${label}`).toEqual({ wide: 'bundle-wide.png', tall: 'bundle-tall.png', logo: null });
    }
  });

  it('still accepts an empty list as a real answer, and caches it', async () => {
    // The other side of the check above: `{ data: [] }` is the service answering properly that this bundle is
    // not in the list — a SUCCESS, not a shape failure. Only the SECOND resolve distinguishes the two: a cached
    // success makes no second request, while a rejected shape would retry on every account load.
    vi.resetModules();
    stubContentApi();
    const working = globalThis.fetch;
    let bundleCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/bundles')) {
        bundleCalls += 1;
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }
      return working(url);
    });
    const { resolveFeaturedBundles } = await import('./contentCache.js');

    const first = (await resolveFeaturedBundles([BUNDLE]))[0];
    const second = (await resolveFeaturedBundles([BUNDLE]))[0];

    // Exactly one fetch across both resolves: the empty array was accepted and remembered.
    expect(bundleCalls).toBe(1);
    for (const result of [first, second]) {
      expect(result.name).toBe('UNKNOWN BUNDLE');
      expect(result.art).toEqual({ wide: null, tall: null, logo: null });
      expect(result.items[0]).toMatchObject({ kind: 'skin', name: 'Reaver Vandal' });
      expect(result.price).toBe(7425);
    }
  });

  it('keeps every id, both totals and the window when the skin index itself is down', async () => {
    // Riot served this bundle perfectly; what died is the service that only supplies names, so the numbers must
    // survive — the same rule withDiscount records.
    vi.resetModules();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { resolveFeaturedBundlesOrFallback } = await import('./contentCache.js');
    const result = await resolveFeaturedBundlesOrFallback([BUNDLE]);

    expect(result.contentUnavailable).toBe(true);
    expect(result.bundles[0].name).toBe('Unknown bundle');
    expect(result.bundles[0].art).toEqual({ wide: null, tall: null, logo: null });
    expect(result.bundles[0].items.map((entry) => entry.id)).toEqual(BUNDLE.items.map((entry) => entry.itemId));
    expect(result.bundles[0].items.map((entry) => entry.price)).toEqual([2475, 4950, 0, 0, 0]);
    expect(result.bundles[0].baseTotal).toBe(8600);
    expect(result.bundles[0].price).toBe(7425);
    expect(result.bundles[0].endsAt).toBe(BUNDLE.endsAt);
    expect(result.bundles[0].items.every((entry) => entry.kind === 'other')).toBe(true);
  });

  it('gives the fallback record the same shape as a resolved one', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    const resolved = (await resolveFeaturedBundles([BUNDLE]))[0];

    // A FRESH module graph for the fallback, which is the point: the call above memoised the successful index,
    // so swapping fetch afterwards would compare two successful records — passing while the fallback is broken.
    vi.resetModules();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { resolveFeaturedBundlesOrFallback } = await import('./contentCache.js');
    const fallback = await resolveFeaturedBundlesOrFallback([BUNDLE]);

    expect(fallback.contentUnavailable).toBe(true);
    expect(Object.keys(fallback.bundles[0]).sort()).toEqual(Object.keys(resolved).sort());
    expect(Object.keys(fallback.bundles[0].art).sort()).toEqual(Object.keys(resolved.art).sort());
    expect(Object.keys(fallback.bundles[0].items[0]).sort()).toEqual(Object.keys(resolved.items[0]).sort());
  });

  it('shares the one index: no extra fetch for a second bundle load', async () => {
    vi.resetModules();
    stubContentApi();
    const { resolveFeaturedBundles } = await import('./contentCache.js');
    (await resolveFeaturedBundles([BUNDLE]))[0];
    const callsAfterFirst = globalThis.fetch.mock.calls.length;
    (await resolveFeaturedBundles([BUNDLE]))[0];
    expect(globalThis.fetch.mock.calls.length).toBe(callsAfterFirst);
  });
});
