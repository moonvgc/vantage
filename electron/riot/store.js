const CLIENT_PLATFORM = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';
const REQUEST_TIMEOUT_MS = 15_000;
export const COMPETITIVE_TIERS = {
  0: 'Unrated',
  3: 'Iron 1', 4: 'Iron 2', 5: 'Iron 3',
  6: 'Bronze 1', 7: 'Bronze 2', 8: 'Bronze 3',
  9: 'Silver 1', 10: 'Silver 2', 11: 'Silver 3',
  12: 'Gold 1', 13: 'Gold 2', 14: 'Gold 3',
  15: 'Platinum 1', 16: 'Platinum 2', 17: 'Platinum 3',
  18: 'Diamond 1', 19: 'Diamond 2', 20: 'Diamond 3',
  21: 'Ascendant 1', 22: 'Ascendant 2', 23: 'Ascendant 3',
  24: 'Immortal 1', 25: 'Immortal 2', 26: 'Immortal 3', 27: 'Radiant'
};

export async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The Riot service took too long to respond. Please try again.', { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// The Riot client version is identical for every account and Riot rejects a stale one: fetched once per
// session, not once per account or per parallel request (five accounts used to make ten identical calls).
// A failure clears the memo rather than being remembered, so one blip does not break every later account.
let clientVersionPromise;
function getClientVersion() {
  if (!clientVersionPromise) {
    clientVersionPromise = (async () => {
      const response = await fetchWithTimeout('https://valorant-api.com/v1/version');
      if (!response.ok) throw new Error(`Could not retrieve the Valorant client version (${response.status}).`);
      const payload = await response.json();
      const version = payload?.data?.riotClientVersion;
      if (!version) throw new Error('The public version service returned no Riot client version.');
      return version;
    })().catch((error) => {
      clientVersionPromise = undefined;
      throw error;
    });
  }
  return clientVersionPromise;
}

export async function getAuthenticatedHeaders({ accessToken, entitlementsToken }) {
  const clientVersion = await getClientVersion();
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Riot-Entitlements-JWT': entitlementsToken,
    'X-Riot-ClientPlatform': CLIENT_PLATFORM,
    'X-Riot-ClientVersion': clientVersion,
    'Content-Type': 'application/json'
  };
}

export async function fetchStorefront({ accessToken, entitlementsToken, puuid, shard }) {
  const headers = await getAuthenticatedHeaders({ accessToken, entitlementsToken });

  // Riot migrated this route to a POST-only v3 endpoint; the v2 GET fallback is for installations which
  // still expose the older route.
  const v3 = await fetchWithTimeout(`https://pd.${shard}.a.pvp.net/store/v3/storefront/${puuid}`, {
    method: 'POST',
    headers,
    body: '{}'
  });
  if (v3.ok) return v3.json();
  if (![404, 405].includes(v3.status)) {
    throw new Error(`Store request failed (${v3.status}). Update and relaunch Valorant, then try again.`);
  }

  const v2 = await fetchWithTimeout(`https://pd.${shard}.a.pvp.net/store/v2/storefront/${puuid}`, { headers });
  if (v2.ok) return v2.json();
  if (v2.status !== 404) throw new Error(`Store request failed (${v2.status}). Update and relaunch Valorant, then try again.`);
  throw new Error('The Riot Client did not expose a compatible storefront endpoint. Update and relaunch Valorant, then try again.');
}

async function readProfileResponse(response, name) {
  if (!response.ok) throw new Error(`${name} request failed (${response.status}).`);
  return response.json();
}

function extractCompetitiveRank(payload) {
  const competitive = payload?.QueueSkills?.competitive;
  const latest = payload?.LatestCompetitiveUpdate;
  const seasons = Object.values(competitive?.SeasonalInfoBySeasonID ?? {});
  const season = seasons.find((item) => item?.SeasonID === latest?.SeasonID)
    ?? seasons.find((item) => Number(item?.GamesNeededForRating) > 0)
    ?? seasons.find((item) => Number(item?.CompetitiveTier) > 2)
    ?? latest;
  const tier = Number(season?.CompetitiveTier ?? season?.TierAfterUpdate ?? 0);
  const gamesNeeded = Number(season?.GamesNeededForRating ?? 0);
  const rrValue = season?.RankedRating ?? season?.RankedRatingAfterUpdate;
  const rr = Number.isFinite(Number(rrValue)) ? Number(rrValue) : null;

  if (gamesNeeded > 0) return { rank: 'Unranked', rr: null, placementsRemaining: gamesNeeded };
  return { rank: COMPETITIVE_TIERS[tier] ?? 'Unranked', rr: tier > 2 ? rr : null, placementsRemaining: 0 };
}

// These two endpoints are independent of the storefront: a missing profile response must never prevent the daily store from rendering.
export async function fetchAccountProfile({ accessToken, entitlementsToken, puuid, shard }) {
  const headers = await getAuthenticatedHeaders({ accessToken, entitlementsToken });
  const baseUrl = `https://pd.${shard}.a.pvp.net`;
  const [xpResult, mmrResult] = await Promise.allSettled([
    fetchWithTimeout(`${baseUrl}/account-xp/v1/players/${puuid}`, { headers }).then((response) => readProfileResponse(response, 'Account level')),
    fetchWithTimeout(`${baseUrl}/mmr/v1/players/${puuid}`, { headers }).then((response) => readProfileResponse(response, 'Competitive rank'))
  ]);

  const level = xpResult.status === 'fulfilled' && Number.isFinite(Number(xpResult.value?.Progress?.Level))
    ? Number(xpResult.value.Progress.Level)
    : null;
  const rank = mmrResult.status === 'fulfilled' ? extractCompetitiveRank(mmrResult.value) : null;
  return { level, ...(rank ?? { rank: null, rr: null, placementsRemaining: null }) };
}

// Riot always prices an item, but the currency is a map keyed by currency id and a single offer
// can carry more than one, so the largest finite value is taken — correct for the VP store and the
// night market. null for an empty map matters: Math.max() of empty is -Infinity, and that renders as a price.
function maxCost(cost) {
  const values = Object.values(cost ?? {}).map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

export function getDailyOffers(storefront) {
  const layout = storefront?.SkinsPanelLayout;
  const ids = layout?.SingleItemOffers;
  const offers = layout?.SingleItemStoreOffers;
  if (!Array.isArray(ids) || !Array.isArray(offers)) throw new Error('Riot returned a storefront without daily skin offers.');
  return ids.map((id) => {
    const offer = offers.find((item) => item.OfferID === id);
    return { offerId: id, price: maxCost(offer?.Cost) };
  });
}

// Night Market. Riot opens it per act and otherwise simply omits the BonusStore field, so what is
// reported is what the storefront says. Two things in the public documentation are wrong and matter:
// BonusStoreOffers is an array, and BonusStoreRemainingDurationInSeconds is not listed at all —
// both are optional, because a window without a countdown beats one that throws.
//
// Offers are keyed on Rewards[0].ItemID (the skin LEVEL uuid), the same namespace as
// SkinsPanelLayout.SingleItemOffers and where the content index is built; BonusOfferID means no name.
export function getNightMarket(storefront) {
  const raw = storefront?.BonusStore?.BonusStoreOffers;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const offers = raw.map((entry) => {
    const cost = maxCost(entry?.Offer?.Cost);
    const discounted = maxCost(entry?.DiscountCosts);
    const percent = Number(entry?.DiscountPercent);
    return {
      offerId: entry?.Offer?.Rewards?.[0]?.ItemID ?? entry?.Offer?.OfferID ?? null,
      price: discounted ?? cost,
      originalPrice: cost,
      discountPercent: Number.isFinite(percent) ? percent : null,
      seen: Boolean(entry?.IsSeen)
    };
  }).filter((offer) => offer.offerId !== null);
  if (!offers.length) return null;
  const remaining = Number(storefront?.BonusStore?.BonusStoreRemainingDurationInSeconds);
  return { offers, endsInSeconds: Number.isFinite(remaining) ? remaining : null };
}

// Its window, with the end already turned into an absolute instant. `now` is a parameter so the rule can be
// tested without freezing the clock — the same reason as nextStoreReset(now) in the renderer.
export function nightMarketWindow(storefront, now = Date.now()) {
  const parsed = getNightMarket(storefront);
  if (!parsed) return null;
  return {
    offers: parsed.offers,
    endsAt: parsed.endsInSeconds === null ? null : now + parsed.endsInSeconds * 1000
  };
}

// Number(...) of a missing field is NaN, and NaN is not null: it survives the renderer's `?? 0` and is
// printed as a price. Empty string and null both count as "absent" — Number(null) is 0, not a price Riot sent.
function finiteOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// A fraction becomes a whole percent, one that arrives whole is kept: `<= 1` is the boundary, since a
// fraction cannot exceed it and both endpoints were measured — FeaturedBundle sends 0.34, the Night Market 34.
function percentOrNull(value) {
  const number = finiteOr(value, null);
  if (number === null) return null;
  return Math.round(number <= 1 ? number * 100 : number);
}

// One bundle's rows, in the shape the content index is keyed on. An entry without an ItemID is dropped —
// that id resolves its name, image and tier, and a missing row beats a row that lies about what it is.
function bundleRows(items) {
  return (Array.isArray(items) ? items : []).map((entry) => {
    const item = entry?.Item;
    const itemId = item?.ItemID;
    if (typeof itemId !== 'string' || !itemId) return null;
    return {
      itemTypeId: typeof item?.ItemTypeID === 'string' ? item.ItemTypeID : null,
      itemId,
      // NOT multiplied into the price: BasePrice and DiscountedPrice are the line's own prices, not unit prices.
      quantity: finiteOr(item?.Quantity, 1),
      basePrice: finiteOr(entry?.BasePrice, null),
      discountedPrice: finiteOr(entry?.DiscountedPrice, null),
      // Measured against a live Champions 2026 bundle: THIS endpoint sends the discount as a FRACTION
      // (0.34, 0.3, 0.29) while the Night Market sends whole percents (34, 30). Normalising keeps the field
      // meaning one thing across both paths — stored raw it would read "-0.34%" and disagree with the market's.
      discountPercent: percentOrNull(entry?.DiscountPercent),
      isPromoItem: Boolean(entry?.IsPromoItem)
    };
  }).filter(Boolean);
}

// Featured bundles: the cosmetic bundles Riot is selling right now, inside the same storefront as the daily
// store, so they cost no extra request. Every item carries its own price, discount and promo flag, so no
// price is reconstructed from the bundle price.
//
// USUALLY ONE, but Riot runs a second promo bundle alongside the main one — measured live: Champions 2026
// (7 items, 33% off) with Warden Launch (4 items, 51% off). Returning only the first hid the larger
// discount entirely, so this returns the whole set.
//
// `Bundles` REPEATS the primary bundle as its own first entry, so the list is deduped on DataAssetID:
// drawing the same bundle twice is worse than drawing one, and the repeat is not a second offer.
//
// The window is PER BUNDLE (`DurationRemainingInSeconds`). The top-level
// `FeaturedBundle.BundleRemainingDurationInSeconds` is NOT it: on the live payload that field held the
// SECOND bundle's window (7.5 days) while the first bundle's own field said 21.5 days, so preferring it
// under-reported the main bundle by a fortnight. It is kept only as the fallback for a bundle that omits
// its own field.
//
// `now` is a parameter because the durations are measured AT THIS REQUEST: converted to absolute instants
// once, here, rather than going stale the moment they are read.
export function getFeaturedBundles(storefront, now = Date.now()) {
  const featured = storefront?.FeaturedBundle;
  if (!featured) return [];
  const fallbackSeconds = finiteOr(featured.BundleRemainingDurationInSeconds, null);

  const seen = new Set();
  const bundles = [];
  for (const bundle of [featured.Bundle, ...(Array.isArray(featured.Bundles) ? featured.Bundles : [])]) {
    const id = typeof bundle?.DataAssetID === 'string' ? bundle.DataAssetID : '';
    if (!id || seen.has(id)) continue;
    const items = bundleRows(bundle.Items);
    // An empty bundle is not a sale: without this the page renders its shell around nothing.
    if (!items.length) continue;
    seen.add(id);
    const endsInSeconds = finiteOr(bundle.DurationRemainingInSeconds, fallbackSeconds);
    bundles.push({
      id,
      endsAt: endsInSeconds === null ? null : now + endsInSeconds * 1000,
      endsInSeconds,
      items
    });
  }
  return bundles;
}
