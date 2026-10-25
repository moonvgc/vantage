// Night Market logic on the renderer side.
//
// The Night Market has NO schedule: Riot opens it at any time (~once per act, ~2 weeks), and each
// account gets its own six discounted offers — nothing can be computed and no date may be written in
// the code. A "new window" is recognised from the FINGERPRINT of its offers: every window has a new
// BonusOfferID, so the sorted list of ids identifies the window, and "announce once" falls out of the
// data itself.

export function nightMarketSignature(nightMarket) {
  const ids = (nightMarket?.offers ?? []).map((offer) => String(offer?.id ?? '')).filter(Boolean).sort();
  return ids.length ? ids.join('|') : null;
}

export function isNewNightMarket(signature, announcedSignature) {
  return Boolean(signature) && signature !== (announcedSignature ?? null);
}

// Seconds remaining, or null when Riot sends no duration. Callers MUST treat null as "open, end
// unknown" and not as "no market": the offers can still be bought.
export function nightMarketCountdown(endsAt, now = Date.now()) {
  if (!Number.isFinite(endsAt)) return null;
  return Math.max(0, Math.floor((endsAt - now) / 1000));
}

export function nightMarketOpen(nightMarket, now = Date.now()) {
  if (!(nightMarket?.offers?.length > 0)) return false;
  const remaining = nightMarketCountdown(nightMarket.endsAt, now);
  return remaining === null || remaining > 0;
}

// Highest tier first, then biggest discount — deliberately tier before discount: 20% on an Ultra
// skin is worth more than 50% on a Select, and a skin with no tier from Riot sorts last (still an
// offer, not an error). Returns a NEW array, because the array belongs to the account payload.
export function sortNightMarketOffers(offers) {
  return [...(offers ?? [])].sort((a, b) => {
    const rankA = a?.tier?.rank ?? -1;
    const rankB = b?.tier?.rank ?? -1;
    if (rankA !== rankB) return rankB - rankA;
    return (b?.discountPercent ?? -1) - (a?.discountPercent ?? -1);
  });
}
