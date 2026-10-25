let contentIndexPromise;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The Valorant content service took too long to respond. Please try again.', { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Built once per session and shared by every account. A FAILED attempt must not be remembered:
// keeping the rejected promise made every later account fail instantly, without a request.
function getContentIndex() {
  if (!contentIndexPromise) {
    contentIndexPromise = buildContentIndex().catch((error) => {
      contentIndexPromise = undefined;
      throw error;
    });
  }
  return contentIndexPromise;
}

// Tier colours come from Riot itself through the SECOND endpoint on the same content service — the same
// colour as the Select to Ultra markers in game. highlightColor is EIGHT digits (RRGGBBAA, alpha always
// 33); only the first six digits are a colour, and the raw value is 20% transparent — it reads as
// "the tier is washed out", not a parsing bug.
function tierFromPayload(tiers, uuid) {
  const tier = tiers.find((entry) => entry.uuid === uuid);
  if (!tier) return null;
  const hex = String(tier.highlightColor ?? '').replace(/^#/, '');
  if (!/^[0-9a-f]{6,8}$/i.test(hex)) return null;
  return { rank: Number(tier.rank) || 0, label: tier.displayName ?? 'Unknown', color: `#${hex.slice(0, 6).toUpperCase()}` };
}

async function buildContentIndex() {
  const [skinsResponse, tiersResponse, buddiesResponse, spraysResponse, cardsResponse] = await Promise.all([
    fetchWithTimeout('https://valorant-api.com/v1/weapons/skins'),
    // The tier list is decoration on top of the store: its failure must not fail this account, the card only loses its colour.
    fetchWithTimeout('https://valorant-api.com/v1/contenttiers').catch(() => null),
    // The three accessory lists below exist for the same reason as the tier list: losing one costs only that kind its label.
    fetchWithTimeout('https://valorant-api.com/v1/buddies').catch(() => null),
    fetchWithTimeout('https://valorant-api.com/v1/sprays').catch(() => null),
    fetchWithTimeout('https://valorant-api.com/v1/playercards').catch(() => null)
  ]);
  if (!skinsResponse.ok) throw new Error(`Could not retrieve Valorant skin content (${skinsResponse.status}).`);
  const payload = await skinsResponse.json();
  // Valid JSON in the wrong shape is a failure, exactly as on the bundle list: `?? []` would memoise a
  // SUCCESSFUL empty index for the session, so every card would read "Unknown skin" with no note and no
  // retry. Throwing sends the account down the degraded path instead; an empty ARRAY stays legitimate.
  if (!Array.isArray(payload?.data)) throw new Error('The Valorant content service returned an unexpected skin list.');
  const tiers = tiersResponse?.ok ? (await tiersResponse.json()).data ?? [] : [];

  const skins = new Map();
  for (const skin of payload.data) {
    const tier = tierFromPayload(tiers, skin.contentTierUuid);
    const levels = (skin.levels ?? []).map((level) => ({
      name: level.displayName ?? skin.displayName ?? 'Skin',
      item: level.levelItem ?? null,
      video: level.streamedVideo ?? null,
      icon: level.displayIcon ?? null
    }));
    const chromas = (skin.chromas ?? [])
      .filter((chroma) => chroma.swatch)
      .map((chroma) => ({
        name: (chroma.displayName ?? '').replace(/\s+/g, ' ').trim(),
        swatch: chroma.swatch,
        // Most newer skins have a per-chroma video; every chroma has a full-quality render as fallback.
        video: chroma.streamedVideo ?? null,
        render: chroma.fullRender ?? null
      }));
    for (const level of skin.levels ?? []) {
      skins.set(level.uuid, {
        name: level.displayName ?? skin.displayName ?? 'Unknown skin',
        image: level.displayIcon ?? skin.displayIcon ?? null,
        video: level.streamedVideo ?? null,
        levels,
        chromas,
        // /weapons/skins carries no category field (verified 2026-09); kept for when it does.
        category: skin.category ?? null,
        tier
      });
    }
  }

  // Accessories have no levels: one entry is one object keyed by uuid, and an entry without one is
  // dropped — the key is what makes it findable. Sprays and cards ship a hi-res image, buddies do not.
  const extras = new Map();
  const collect = async (response, kind, image) => {
    if (!response?.ok) return;
    for (const entry of (await response.json()).data ?? []) {
      if (!entry?.uuid) continue;
      const record = { name: entry.displayName ?? 'Unknown', image: image(entry), kind };
      extras.set(entry.uuid, record);
      // A bundle keys its accessories by the accessory's LEVEL uuid, not its own — the same split the
      // weapon-skin index above handles. Measured on a live Champions 2026 bundle: its buddy arrived as
      // `eb86ef90-…`, a level of `fb211961-…`, so keying on the buddy uuid alone left that item unnameable.
      for (const level of entry.levels ?? []) {
        if (level?.uuid) extras.set(level.uuid, record);
      }
    }
  };
  await Promise.all([
    collect(buddiesResponse, 'buddy', (entry) => entry.displayIcon ?? null),
    collect(spraysResponse, 'spray', (entry) => entry.fullIcon ?? entry.displayIcon ?? null),
    collect(cardsResponse, 'card', (entry) => entry.largeArt ?? entry.displayIcon ?? null)
  ]);

  return { skins, extras };
}

// Its own lazy memo, reached only from the featured-bundle resolver: 324 entries of key art no other
// screen reads, so a session that never opens a bundle should not pay for it.
//
// Cleared on failure like the content index's. This build MUST reject rather than resolve to an empty
// map: resolving would memoise the failure, leaving every later account on UNKNOWN BUNDLE with no art.
let bundleIndexPromise;

function getBundleIndex() {
  if (!bundleIndexPromise) {
    bundleIndexPromise = buildBundleIndex().catch((error) => {
      bundleIndexPromise = undefined;
      throw error;
    });
  }
  return bundleIndexPromise;
}

async function buildBundleIndex() {
  const response = await fetchWithTimeout('https://valorant-api.com/v1/bundles');
  if (!response.ok) throw new Error(`Could not retrieve Valorant bundle content (${response.status}).`);
  const payload = await response.json();
  // Valid JSON in the wrong shape is a failure too, caught HERE rather than tolerated with a `?? []`:
  // that would memoise an empty map for the session, leaving every later account on UNKNOWN BUNDLE with
  // no art and no retry. An empty ARRAY stays legitimate — the service saying this bundle is not listed.
  if (!Array.isArray(payload?.data)) throw new Error('The Valorant bundle content service returned an unexpected shape.');
  const bundles = new Map();
  for (const entry of payload.data) {
    if (!entry?.uuid) continue;
    // displayIcon2 is the wide key art, verticalPromoImage the tall poster. displayIcon is deliberately
    // NOT a fallback: it is a square logo, and stretched across a 236px hero box it reads as a bug.
    // With neither present the page renders NO ART — correct for an older bundle, not a failure.
    bundles.set(entry.uuid, {
      name: entry.displayName ?? null,
      wide: entry.displayIcon2 ?? null,
      tall: entry.verticalPromoImage ?? null,
      logo: entry.logoIcon ?? null
    });
  }
  return bundles;
}

// One place that knows how to turn an offer id into a skin: the Daily store and the Night Market decorate
// in exactly the same way, and two copies would mean two places to fix when the service changes.
function decorate(index, offer) {
  const skin = index.skins.get(offer.offerId);
  return {
    // The renderer uses `offer.id` as the React key (and the remount key of the showcase modal), while the
    // skin record carries no id of its own: without this line every card shares key undefined and the modal does not remount.
    id: offer.offerId,
    name: skin?.name ?? 'Unknown skin',
    image: skin?.image ?? null,
    video: skin?.video ?? null,
    levels: skin?.levels ?? [],
    chromas: skin?.chromas ?? [],
    category: skin?.category ?? null,
    price: offer.price,
    // Null for a skin Riot lists no tier for (40 of 1405): the card is still rendered, without colour.
    tier: skin?.tier ?? null
  };
}

export async function resolveDailyOffers(offers) {
  const index = await getContentIndex();
  return offers.map((offer) => decorate(index, offer));
}

// The offer id and its price come from Riot; only its decorative labels (name, image, video) come from the third-party
// service. The record shape is the same as the labelled one, so the card, keyboard navigation and its price keep working.
function bareOffer(offer) {
  return {
    id: offer.offerId,
    name: 'Unknown skin',
    image: null,
    video: null,
    levels: [],
    chromas: [],
    category: null,
    price: offer.price,
    tier: null
  };
}

export function unavailableDailyOffers(offers) {
  return offers.map(bareOffer);
}

// The discount Riot sends is the reason the Night Market page exists, so it is attached LAST — after
// the decoration, whichever path is taken: the fallback path must not silently drop that number.
function withDiscount(resolved, source) {
  return {
    ...resolved,
    originalPrice: source?.originalPrice ?? null,
    discountPercent: source?.discountPercent ?? null,
    seen: Boolean(source?.seen)
  };
}

export async function resolveNightMarketOffers(offers) {
  const index = await getContentIndex();
  return offers.map((offer) => withDiscount(decorate(index, offer), offer));
}

export async function resolveNightMarketOrFallback(nightMarket) {
  try {
    return { offers: await resolveNightMarketOffers(nightMarket.offers), contentUnavailable: false };
  } catch {
    return { offers: nightMarket.offers.map((offer) => withDiscount(bareOffer(offer), offer)), contentUnavailable: true };
  }
}

export async function resolveDailyOffersOrFallback(offers) {
  try {
    return { offers: await resolveDailyOffers(offers), contentUnavailable: false };
  } catch {
    return { offers: unavailableDailyOffers(offers), contentUnavailable: true };
  }
}

// Featured bundle: ONE bundle, not a list of offers. Its labels come from the index above, but its
// numbers — prices, totals, the window — come from Riot: losing the third party must not lose those.
//
// The order is Riot's and NOT sorted: the Night Market sorts because it is a shopping list, while a
// bundle is one set Riot already arranged (weapons first, then accessories) — part of what is being sold.
//
// Riot's own entitlement categories, keyed by the ItemTypeID a bundle item carries — the one field that
// still says what an item IS when its id resolves to nothing (an accessory list that failed, a uuid the
// service has not caught up with). The ids are Riot's, from the owned-items endpoint's category table.
const ITEM_TYPE_KINDS = {
  'e7c63390-eda7-46e0-bb7a-a6abdacd2433': 'skin',
  'dd3bf334-87f3-40bd-b043-682a57a8dc3a': 'buddy',
  'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475': 'spray',
  '3f296c07-64c3-494c-923b-fe692a4fa1bd': 'card'
};

function bundleItem(index, item, { keepUnlabelled = false } = {}) {
  const skin = index.skins.get(item.itemId);
  const extra = skin ? null : index.extras.get(item.itemId);
  if (!skin && !extra && !keepUnlabelled) return null;
  const label = skin
    // Exactly the fields SkinPreviewModal reads (name, image, video, levels, chromas), so the existing showcase modal works unchanged.
    ? { kind: 'skin', name: skin.name, image: skin.image, video: skin.video, levels: skin.levels, chromas: skin.chromas, tier: skin.tier }
    : extra
      // No levels and no tier (null/[]): the shape stays identical to a skin's, so the card never has to know what it draws.
      ? { kind: extra.kind, name: extra.name, image: extra.image, video: null, levels: [], chromas: [], tier: null }
      // Only reachable with keepUnlabelled (the outage path below), where EVERY item is in this state and
      // the page explains why. Kind still comes from Riot's ItemTypeID, so a card can say "BUDDY".
      : { kind: ITEM_TYPE_KINDS[item.itemTypeId] ?? 'other', name: 'Unknown item', image: null, video: null, levels: [], chromas: [], tier: null };
  return {
    id: item.itemId,
    ...label,
    price: item.discountedPrice,
    basePrice: item.basePrice,
    discountPercent: item.discountPercent,
    included: item.isPromoItem,
    quantity: item.quantity
  };
}

// The empty index for the fallback path: shape must match the successful path exactly, contents differ.
const EMPTY_INDEX = { skins: new Map(), extras: new Map() };

// Totals come from the PARSED items, never the labelled ones: an unnameable item is still one Riot charges
// for, so a dropped card must not quietly lower the bundle price.
function bundleTotals(parsedItems) {
  const baseTotal = parsedItems.reduce((sum, item) => sum + (item.basePrice ?? 0), 0);
  // Riot's discounted price, or the full price when it sent none; nothing is reconstructed from the percent.
  const price = parsedItems.reduce((sum, item) => sum + (item.discountedPrice ?? item.basePrice ?? 0), 0);
  return {
    baseTotal,
    price,
    // COMPUTED, not copied: the payload carries no bundle-level percentage. Two equal totals drop the
    // chip rather than printing it as -0%.
    discountPercent: baseTotal > 0 && price < baseTotal ? Math.round((1 - price / baseTotal) * 100) : null
  };
}

function featuredBundleRecord(index, bundles, bundle, { keepUnlabelled = false } = {}) {
  // An item nothing can name is dropped rather than drawn as "Unknown item": a card with no name and no
  // art reads as a broken app (the one time it happened the cause was a real resolver bug, not a missing
  // item). The totals below still count it, so the price Riot charges stays exact — only the row is gone.
  //
  // `keepUnlabelled` is the outage exception: EVERY item is in that state there, the page prints the note,
  // and an empty grid would hide what Riot is selling and what it costs.
  const items = bundle.items.map((item) => bundleItem(index, item, { keepUnlabelled })).filter(Boolean);
  const meta = bundles.get(bundle.id) ?? null;
  return {
    id: bundle.id,
    name: meta?.name ?? 'UNKNOWN BUNDLE',
    art: { wide: meta?.wide ?? null, tall: meta?.tall ?? null, logo: meta?.logo ?? null },
    items,
    ...bundleTotals(bundle.items),
    endsAt: bundle.endsAt,
    endsInSeconds: bundle.endsInSeconds
  };
}

// Prices, totals and the window stay INTACT (all come from Riot): same rule as withDiscount — only labels may go.
function unavailableFeaturedBundle(bundle) {
  return {
    ...featuredBundleRecord(EMPTY_INDEX, new Map(), bundle, { keepUnlabelled: true }),
    name: 'Unknown bundle'
  };
}

export async function resolveFeaturedBundles(bundles) {
  const [index, bundleIndex] = await Promise.all([
    getContentIndex(),
    // The list supplies a name and a picture and nothing else, so its failure becomes empty metadata HERE,
    // at the one call site that knows what the list is for: letting it travel would report a content outage.
    getBundleIndex().catch(() => new Map())
  ]);
  return bundles.map((bundle) => featuredBundleRecord(index, bundleIndex, bundle));
}

export async function resolveFeaturedBundlesOrFallback(bundles) {
  try {
    return { bundles: await resolveFeaturedBundles(bundles), contentUnavailable: false };
  } catch {
    return { bundles: bundles.map((bundle) => unavailableFeaturedBundle(bundle)), contentUnavailable: true };
  }
}
