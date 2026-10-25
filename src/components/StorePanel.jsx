import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { divisionColor, fmtDuration, rankIconUrl, relativeTime, weaponCategory } from '../lib/format.js';
import { nightMarketCountdown, sortNightMarketOffers } from '../lib/nightMarket.js';
import { clampOfferCursor } from '../lib/offerCursor.js';
import { tierRgb } from '../lib/tierColor.js';
import { getAudioPrefs, setAudioPrefs, subscribeAudioPrefs } from '../lib/audioPrefs.js';
import { presentError } from '../lib/errorPresentation.js';
import { loginStateInfo, needsSignIn } from '../lib/loginState.js';
import { BrandMark, Icon } from './Icons.jsx';
import { WalletChips } from './LockerPanel.jsx';

function Pips({ total = 5, done = 0 }) {
  return (
    <span className="pips">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={`pip${index < done ? ' won' : ''}`} />
      ))}
      <span className="pips-n">{done} <i>/ {total}</i></span>
    </span>
  );
}

// memo: App re-renders every second for the countdown; none of these props change on that tick.
export const AccountOverview = memo(function AccountOverview({ account, busy, onSwitch, onRefresh, onRefreshAll, onDelete, banner = null, title = null, wallet = null }) {
  const store = account.status === 'ready' ? account.store : null;
  const profile = store?.profile;
  const rank = profile?.rank ?? null;
  const color = divisionColor(rank);
  const icon = rank ? rankIconUrl(rank, 'large') : null;
  const online = Boolean(account.active);
  const ranked = (profile?.placementsRemaining ?? 0) === 0;
  const login = loginStateInfo(account.loginState);

  if (account.status === 'error') {
    const presentation = presentError(account.error, account.errorKind);
    const runAction = () => {
      if (presentation.action === 'switch') onSwitch(account.label);
      else if (presentation.action === 'refresh') onRefresh(account.label);
      else if (presentation.action === 'refresh-all') onRefreshAll();
      else if (presentation.action === 'delete') onDelete(account.label);
    };
    return (
      <section className="panel overview" aria-label="Account overview">
        <div className="ov-head">
          <span className="ov-mark"><BrandMark size={20} /></span>
          <h2 className="ov-name">{(account.store?.accountName ?? account.accountName ?? account.label).toUpperCase()}</h2>
          <span className="ov-status is-err"><span className="dot err" />{presentation.title}</span>
          <span className="ov-level">LV. {profile?.level ?? '—'}</span>
        </div>
        <LoginNotice account={account} busy={busy} onSwitch={onSwitch} />
        <div className="ov-body">
          <div className="ov-cell ov-wide ov-error-wrap">
            <p className="ov-error"><Icon name="warn" size={14} /> <b>{presentation.explain}</b></p>
            <p className="ov-error-hint">{presentation.hint}</p>
            <p className="ov-error-raw">{account.error}</p>
            <button
              type="button" className={presentation.action === 'switch' || presentation.action === 'delete' ? 'danger-btn' : 'ghost-btn'}
              disabled={busy} onClick={runAction}
            >{presentation.actionLabel}</button>
          </div>
        </div>
      </section>
    );
  }

  const riotId = store?.accountName ?? account.accountName ?? account.label;
  const [gameName, tagLine] = String(riotId).split('#');
  return (
    <section
      className={`panel overview hero${banner ? ' has-banner' : ''}`} aria-label="Account overview"
      style={banner ? { '--banner': `url("${banner}")` } : undefined}
    >
      <div className="ov-head">
        <div className="ov-id">
          <h2 className="ov-name">{gameName}{tagLine && <span className="ov-tag">#{tagLine}</span>}</h2>
          <div className="ov-sub">
            <span className={`ov-status ${online ? 'is-on' : ''}`}><span className={`dot ${online ? 'on' : 'off'}`} />{online ? 'Online' : 'Saved session'}</span>
            {title && <span className="ov-title">{title}</span>}
            <span className="ov-label">{account.label}</span>
          </div>
        </div>
        <span className="ov-level">Lv {profile?.level ?? '—'}</span>
        <WalletChips wallet={wallet} />
      </div>
      <LoginNotice account={account} busy={busy} onSwitch={onSwitch} />
      <div className="ov-body">
        <div className="ov-cell ov-rank">
          {icon && <img src={icon} alt="" width="46" height="46" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />}
          <div>
            <div className="ov-rankname" style={rank ? { color } : undefined}>{rank ?? 'Unranked'}</div>
            <div className="ov-rr"><b>{profile?.rr ?? '—'}</b> RR</div>
          </div>
        </div>
        <div className="ov-cell ov-mid">
          {ranked ? (
            <>
              <div className="klabel">RANKED RATING</div>
              <div className="rrmeter"><span style={{ width: `${profile?.rr ?? 0}%`, background: color }} /></div>
              <div className="mid-sub"><b>{profile?.rr ?? '—'}</b> / 100 RR THIS SEASON</div>
            </>
          ) : (
            <>
              <div className="klabel">COMPETITIVE PROGRESS</div>
              <Pips total={5} done={Math.max(0, 5 - (profile?.placementsRemaining ?? 0))} />
              <div className="mid-sub">{profile.placementsRemaining} PLACEMENT{profile.placementsRemaining === 1 ? '' : 'S'} REMAINING</div>
            </>
          )}
        </div>
        <div className="ov-cell ov-info">
          <div className="kv"><span className="k">RIOT ID</span><span className="v">{store?.accountName ?? account.accountName ?? '—'}</span></div>
          <div className="kv"><span className="k">ACCOUNT LEVEL</span><span className="v">{profile?.level ?? '—'}</span></div>
          <div className="kv" title={login?.hint}><span className="k">RIOT LOGIN</span><span className={`v login-${login?.tone ?? 'none'}`}><span className={`dot ${login?.tone === 'bad' ? 'err' : online ? 'on' : login ? 'ok' : 'off'}`} />{busy ? 'Syncing…' : login?.label ?? (online ? 'Signed in' : 'Saved session')}</span></div>
          <div className="kv"><span className="k">LAST ACTIVE</span><span className="v dim">{relativeTime(account.lastCheckedAt)}</span></div>
        </div>
      </div>
    </section>
  );
});

// Shown when the saved Riot login cannot be used: the one action that fixes it is a switch, which
// stops at the Riot sign-in screen and saves whatever the user signs in with.
function LoginNotice({ account, busy, onSwitch }) {
  if (!needsSignIn(account.loginState)) return null;
  const info = loginStateInfo(account.loginState);
  return (
    <div className="login-notice">
      <Icon name="warn" size={15} />
      <div>
        <b>{info.label}</b>
        <span>{info.hint}</span>
      </div>
      <button type="button" className="primary-btn" disabled={busy} onClick={() => onSwitch(account.label)}>
        <Icon name="swap" />Sign in again
      </button>
    </div>
  );
}

// `entry` is INLINE in the countdown row, not its own row: a second full row for a rare event
// would eat 44px on every launch all year while empty. Its slot is a span of its own because
// there are TWO doors, and two elements each demanding `margin-left: auto` will not line up
// as one right-aligned group. The old `offersCount` prop is gone — this component never
// read it, and an unused prop reads as a feature that exists.
export function StoreRefreshStrip({ countdown, entry = null }) {
  return (
    <section className="panel refresh-strip" aria-label="Store refresh countdown">
      <Icon name="clock" size={12} />
      <span className="rs-lbl">STORE REFRESHES IN</span>
      <span className="rs-count">{countdown}</span>
      <span className="rs-entries">{entry}</span>
    </section>
  );
}

// The Night Market door, rendered INTO the existing refresh row — deliberately without an offer
// count and without a timer: those numbers live on the page, the place that explains them. App.jsx
// only renders it when the selected account actually has a market, so it costs nothing during the
// weeks when there is none.
export function NightMarketEntry({ onOpen }) {
  return (
    <span
      className="rs-nm" role="button" tabIndex={0}
      title="Open the night market"
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}
    >
      <Icon name="cart" size={12} />
      <span className="nm-lbl">NIGHT MARKET</span>
      <span className="nm-go">VIEW</span>
    </span>
  );
}

// The daily store card is NOT clickable — the only action inside it is the PREVIEW button. Hover
// moves the SAME cursor used by the [P] and [←][→] keys, so mouse and keyboard point at the same
// card. The card is also not a Tab stop: `role="button"` + `tabIndex` used to promise an Enter
// action that no longer exists, and a false promise to a screen reader is worse than no role.
export const DailyStore = memo(function DailyStore({ account, selectedOffer, onHoverOffer, previewsHidden, onPreview }) {
  const store = account.status === 'ready' ? account.store : null;
  const offers = store?.offers ?? [];
  // An empty cursor prints "—", not "01": the number in the label is a claim about the card pointed at.
  const activeOffer = clampOfferCursor(selectedOffer, offers.length);
  const cursorLabel = activeOffer === null ? '—' : String(activeOffer + 1).padStart(2, '0');
  const title = (
    <div className="panel-title">
      <Icon name="cart" size={13} />
      <span className="t">DAILY STORE</span>
      <span className="aux">SELECTED {cursorLabel}/{String(offers.length).padStart(2, '0')}</span>
    </div>
  );

  if (!offers.length) {
    return (
      <section className="panel store" aria-label="Daily store">
        {title}
        <p className="store-hidden">STORE DATA UNAVAILABLE</p>
      </section>
    );
  }

  return (
    <section className="panel store" aria-label="Daily store">
      {title}
      {store?.contentUnavailable && (
        <p className="snap-note">SKIN NAMES AND PREVIEWS UNAVAILABLE — RIOT&apos;S OFFERS AND PRICES BELOW.</p>
      )}
      {previewsHidden
        ? <p className="store-hidden">{offers.length} STORE SKINS HIDDEN — PRESS [H] TO SHOW.</p>
        : <div className="cards">
            {offers.map((offer, index) => {
              const pointed = index === activeOffer;
              // Tier color becomes a custom property, not a class: the value comes from Riot at runtime,
              // so it cannot live in styles.css. Without a tier, the card gets no .tiered class at
              // all — rgba(var(--tier-rgb)) with an empty variable cancels the whole declaration.
              const tierRgbValue = tierRgb(offer.tier?.color);
              return (
                <article
                  key={offer.id} className={`card${pointed ? ' cur' : ''}${tierRgbValue ? ' tiered' : ''}`}
                  style={tierRgbValue ? { '--tier': offer.tier.color, '--tier-rgb': tierRgbValue } : undefined}
                  onMouseEnter={() => onHoverOffer(index)}
                >
                  <span className="num">{String(index + 1).padStart(2, '0')}</span>
                  <div className="prev">
                    {offer.image
                      ? <img src={offer.image} alt={offer.name} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      : <span className="prev-fallback">NO IMAGE</span>}
                    {!offer.video && !offer.levels?.some((level) => level.video) && (
                      <span className="novideo-tag" title="Riot provides no showcase video for this skin">NO VIDEO</span>
                    )}
                    {(offer.video || offer.levels?.length > 1) && (
                      <button
                        type="button" className="preview-btn"
                        onClick={() => onPreview(offer)}
                        title="Open the skin showcase video"
                      ><Icon name="eye" size={11} />PREVIEW</button>
                    )}
                  </div>
                  <div className="meta">
                    <span className="skname" title={offer.name}>{offer.name}</span>
                    <div className="skrow">
                      <span className="wcat">{weaponCategory(offer.name)}</span>
                      <span className="vp">{offer.price?.toLocaleString('en-US') ?? '—'} VP</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>}
    </section>
  );
});

export function MarketView({ account, countdown, onBack }) {
  const store = account.status === 'ready' ? account.store : null;

  return (
    <section className="market-page" aria-label="Market view">
      <div className="market-top">
        <button type="button" className="ghost-btn" onClick={onBack}><Icon name="back" />BACK TO ACCOUNTS</button>
        <span className="market-meta">SESSION {account.active ? 'ACTIVE' : 'SAVED'} · REFRESH IN {countdown}</span>
      </div>
      <div className="market-head">
        <BrandMark size={18} />
        <h2>{account.label.toUpperCase()} — FULL MARKET</h2>
        <span className="market-live"><span className="dot on" />{store?.offers.length ?? 0} SKINS TRACKED</span>
      </div>
      <table className="market-table">
        <thead>
          <tr><th>#</th><th>OFFER</th><th>TYPE</th><th className="num-col">PRICE</th></tr>
        </thead>
        <tbody>
          {(store?.offers ?? []).map((offer, index) => (
            <tr key={offer.id} className={index === 0 ? 'sel' : ''}>
              <td className="idx">{String(index + 1).padStart(2, '0')}</td>
              <td className="nm">
                {offer.image && <img src={offer.image} alt="" width="46" height="17" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                {offer.name}
              </td>
              <td className="cat">{weaponCategory(offer.name)}</td>
              <td className="price">{offer.price?.toLocaleString('en-US') ?? '—'} VP</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="market-foot">DATA FROM RIOT STOREFRONT API · PRICES IN VP · [ESC] BACK</p>
    </section>
  );
}

// Night Market card color is the skin TIER — no "TIER: PREMIUM" label, because the word is a worse
// carrier of color than the color itself; the tier arrives ready-made from the main process (rank,
// color), so nothing is re-derived here.
//
// Sorted by tier first, discount second: Riot sends its own order and the daily store keeps it,
// but here what the user is looking for is the best offer — a 40% discount on a Select skin is
// worth less than 20% on an Ultra skin.
export function NightMarketView({ account, now, onBack, onPreview }) {
  const market = account.status === 'ready' ? account.store?.nightMarket : null;
  // Sorted HERE, not in App.jsx, and the result is a new array: the account payload keeps Riot's
  // original order, while display order is a display component's decision.
  const offers = sortNightMarketOffers(market?.offers);
  const remaining = nightMarketCountdown(market?.endsAt, now);

  return (
    <section className="market-page nm-page" aria-label="Night market">
      <div className="market-top">
        <button type="button" className="ghost-btn" onClick={onBack}><Icon name="back" />BACK TO ACCOUNTS</button>
        <span className="market-meta">{remaining === null ? 'NO END DATE' : `ENDS IN ${fmtDuration(remaining)}`}</span>
      </div>
      <div className="market-head">
        <BrandMark size={18} />
        <h2>{account.label.toUpperCase()} — NIGHT MARKET</h2>
        <span className="nm-head-live">{offers.length} OFFERS</span>
      </div>
      {market?.contentUnavailable && (
        <p className="snap-note">SKIN NAMES AND PREVIEWS UNAVAILABLE — RIOT&apos;S OFFERS AND PRICES BELOW.</p>
      )}
      <div className="nm-cards">
        {offers.map((offer) => {
          const tierRgbValue = tierRgb(offer.tier?.color);
          const tierStyle = tierRgbValue ? { '--tier': offer.tier.color, '--tier-rgb': tierRgbValue } : undefined;
          return (
            <article
              key={offer.id}
              className={`nm-card${tierRgbValue ? ' tiered' : ''}`}
              style={tierStyle}
            >
              {/* Edge line: a tier marker readable at a glance in the six-card grid. */}
              <span className="nm-edge" style={{ background: offer.tier?.color ?? 'var(--border2)' }} />
              {offer.seen && <span className="nm-seen">OPENED</span>}
              <div className="nm-prev">
                {offer.image
                  ? <img src={offer.image} alt={offer.name} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  : <span className="nm-noimg">NO IMAGE</span>}
              </div>
              <div className="nm-meta">
                <span className="nm-name" title={offer.name}>{offer.name}</span>
                <div className="nm-bottom">
                  {/* Percentage uses the tier color when there is one; without a tier it falls back to
                      gold, the only color that means "number". */}
                  <span className="nm-pct" style={offer.tier?.color ? { color: offer.tier.color } : undefined}>
                    {offer.discountPercent == null ? '—' : `-${offer.discountPercent}%`}
                  </span>
                  <span className="nm-now">{offer.price?.toLocaleString('en-US') ?? '—'} VP</span>
                  <span className="nm-was">{offer.originalPrice?.toLocaleString('en-US') ?? '—'}</span>
                </div>
                <button
                  type="button" className="ghost-btn nm-pv"
                  onClick={() => onPreview(offer)} title="Open the skin showcase"
                ><Icon name="eye" size={11} />PREVIEW</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// The Featured Bundle door, sibling of the Night Market door in the same row. Its color is brand
// blue, NOT gold — gold in this app means "a number worth reading" and is already taken by Night
// Market. Only the bundle name and its discount are printed; a missing discount (Riot sends two
// identical totals) is not printed at all, rather than printed as -0%.
//
// ONE door regardless of how many bundles are on sale: Riot usually runs a promo alongside the main
// bundle, and a second door competes with the countdown and the Night Market for the same row. Which
// bundle you are looking at is chosen on the page instead, so `extra` is how many FURTHER bundles the
// page holds — a second sale stays visible without a second door.
export function FeaturedBundleEntry({ name, discountPercent, extra = 0, onOpen }) {
  return (
    <span
      className="rs-bundle" role="button" tabIndex={0}
      title={extra > 0 ? `Open the featured bundles (${extra + 1} on sale)` : 'Open the featured bundle'}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}
    >
      <Icon name="box" size={12} />
      <span className="rb-lbl">{name}</span>
      {discountPercent != null && <span className="rb-off">-{discountPercent}%</span>}
      {extra > 0 && <span className="rb-more">+{extra}</span>}
      <span className="nm-go">VIEW</span>
    </span>
  );
}

const BUNDLE_KINDS = { buddy: 'BUDDY', spray: 'SPRAY', card: 'PLAYER CARD', other: 'ITEM' };

// Skins use weaponCategory, which returns MELEE for dagger/knife names — so a bundle's melee needs
// no marker of its own; it already reads as melee from its name.
function bundleKindLabel(item) {
  return item.kind === 'skin' ? weaponCategory(item.name) : BUNDLE_KINDS[item.kind] ?? 'ITEM';
}

// Featured Bundle page: same shape as Night Market, the only difference is how the price is read.
// A bundle has ONE price and one discount computed from the prices of its rows, while every item
// inside it is already included in that price — which is why an item flagged as promo prints INCLUDED
// with its original price struck through, not 0 VP: a 0 next to an item reads as "this item is
// free", and that is not what Riot says. Its order is Riot's order and is not sorted like Night
// Market, because a bundle is one set Riot already arranged — weapons first, accessories after.
//
// It takes the bundle ITSELF, not the account: Riot can be selling more than one at a time, so which
// one this page is about is chosen here, by the tabs — not derived from the account.
//
// The tabs render ONLY when there is more than one: a single tab is a control that cannot do anything.
// They are real buttons, so Tab and Enter reach them without a keybinding; `[` and `]` step through
// them for speed, because this app is keyboard-first.
export function FeaturedBundleView({ bundle, bundles = [], now, onBack, onSelect, onPreview }) {
  // The same helper as Night Market: it only needs a window with an absolute end, not offers.
  const remaining = nightMarketCountdown(bundle?.endsAt, now);
  const items = bundle?.items ?? [];
  const skins = items.filter((item) => item.kind === 'skin').length;
  // displayIcon2 is the wide key art; verticalPromoImage is the tall poster. displayIcon is deliberately
  // NOT used as a fallback: a square logo stretched to a box this wide reads as a bug.
  const hero = bundle?.art?.wide ?? bundle?.art?.tall ?? null;

  return (
    <section className="market-page" aria-label="Featured bundle">
      <div className="market-top">
        <button type="button" className="ghost-btn" onClick={onBack}><Icon name="back" />BACK TO ACCOUNTS</button>
        <span className="market-meta">{remaining === null ? 'NO END DATE' : `ENDS IN ${fmtDuration(remaining)}`}</span>
      </div>
      <div className="market-head">
        <BrandMark size={18} />
        <h2>FEATURED BUNDLE</h2>
        <span className="nm-head-live">
          {bundle?.name ?? '—'}
          {bundle?.discountPercent != null ? ` · -${bundle.discountPercent}%` : ''}
          {bundle ? ` · ${bundle.price.toLocaleString('en-US')} VP` : ''}
        </span>
      </div>
      {bundles.length > 1 && (
        <div className="bundle-tabs" role="tablist" aria-label="Bundles on sale">
          {bundles.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === bundle?.id}
              className={`bundle-tab${entry.id === bundle?.id ? ' on' : ''}`}
              onClick={() => onSelect(entry.id)}
            >
              <span className="bt-name">{entry.name}</span>
              {entry.discountPercent != null && <span className="bt-off">-{entry.discountPercent}%</span>}
              <span className="bt-price">{entry.price.toLocaleString('en-US')} VP</span>
            </button>
          ))}
        </div>
      )}
      {bundle?.contentUnavailable && (
        <p className="snap-note">SKIN NAMES AND PREVIEWS UNAVAILABLE — RIOT&apos;S OFFERS AND PRICES BELOW.</p>
      )}
      {bundle && <>
        <div className="bundle-hero">
          <div className="hero-art">
            {hero
              ? <img src={hero} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              : <span className="nm-noimg">NO ART</span>}
          </div>
          <div className="hero-side">
            <div>
              <div className="bundle-name">{bundle.name}</div>
              <div className="bundle-tags">
                <span className="bundle-count">{items.length} ITEMS · {skins} WEAPON SKINS</span>
              </div>
            </div>
            <div className="bundle-price">
              {bundle.discountPercent != null && <span className="b-pct">-{bundle.discountPercent}%</span>}
              <span className="b-now">{bundle.price.toLocaleString('en-US')} VP</span>
              {bundle.discountPercent != null && <span className="b-was">{bundle.baseTotal.toLocaleString('en-US')} VP</span>}
            </div>
            <div className="b-note">
              {remaining === null ? 'NO END DATE' : `ENDS IN ${fmtDuration(remaining)}`}
              {bundle.discountPercent != null ? ` · ${bundle.baseTotal.toLocaleString('en-US')} VP BOUGHT SEPARATELY` : ''}
            </div>
          </div>
        </div>
        <div className="b-grid">
          {items.map((item) => {
            const tierRgbValue = tierRgb(item.tier?.color);
            // Same as the other two screens: without a tier, the card gets no .tiered class at all, so
            // rgba(var(--tier-rgb)) is never empty — an empty variable cancels the whole declaration.
            const tierStyle = tierRgbValue ? { '--tier': item.tier.color, '--tier-rgb': tierRgbValue } : undefined;
            const previewable = Boolean(item.video) || (item.levels?.length ?? 0) > 1;
            return (
              <article key={item.id} className={`b-card${tierRgbValue ? ' tiered' : ''}`} style={tierStyle}>
                {/* Edge line: a quick tier marker in the grid; a card without a tier still gets its line, just neutral. */}
                <span className="b-edge" />
                <div className="b-thumb">
                  {item.image
                    ? <img src={item.image} alt={item.name} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                    : <span className="b-none">NO IMAGE</span>}
                </div>
                <div className="b-meta">
                  <span className="b-name" title={item.name}>{item.name}</span>
                  <div className="b-row">
                    <span className="b-type">{bundleKindLabel(item)}</span>
                    {item.included ? (
                      <>
                        {item.basePrice != null && <span className="b-base">{item.basePrice.toLocaleString('en-US')}</span>}
                        <span className="b-inc">INCLUDED</span>
                      </>
                    ) : (
                      <>
                        <span className="b-price">{item.price?.toLocaleString('en-US') ?? '—'} VP</span>
                        {item.basePrice != null && item.basePrice !== item.price
                          && <span className="b-base">{item.basePrice.toLocaleString('en-US')}</span>}
                      </>
                    )}
                  </div>
                  {/* Same as the daily store: a button that opens an empty stage is worse than no button. */}
                  {previewable
                    ? <button
                        type="button" className="ghost-btn preview-btn"
                        onClick={() => onPreview(item)} title="Open the showcase"
                      ><Icon name="eye" size={11} />PREVIEW</button>
                    : <span className="b-none">NO SHOWCASE VIDEO</span>}
                </div>
              </article>
            );
          })}
        </div>
      </>}
    </section>
  );
}

const LEVEL_LABELS = {
  'EEquippableSkinLevelItem::VFX': 'VFX',
  'EEquippableSkinLevelItem::Animation': 'ANIM',
  'EEquippableSkinLevelItem::Finisher': 'FINISHER',
  'EEquippableSkinLevelItem::KillCounter': 'KILLCOUNTER'
};

function levelLabel(level, index) {
  if (level.item && LEVEL_LABELS[level.item]) return LEVEL_LABELS[level.item];
  return `LVL ${index + 1}`;
}

// Showcase modal: one <video> whose src is bound declaratively (via key) to the selected level —
// the fix for the stale/blank video bug. Audio is muted by default (store previews are ambient).
export function SkinPreviewModal({ offer, onClose }) {
  const levels = (offer?.levels ?? []).filter((level) => level.video || level.icon);
  const chromas = offer?.chromas ?? [];
  const [levelIndex, setLevelIndex] = useState(0);
  const [chromaIndex, setChromaIndex] = useState(0);
  const [videoKey, setVideoKey] = useState(0);
  // Audio prefs live in a module-level store persisted to localStorage, so the volume carries across
  // skins, modal cycles, and app restarts.
  const [audio, setAudio] = useState(getAudioPrefs());
  useEffect(() => subscribeAudioPrefs(setAudio), []);
  const { soundOn, volume } = audio;
  const videoRef = useRef(null);
  useEffect(() => {
    setLevelIndex(0);
    setChromaIndex(0);
    setVideoKey((key) => key + 1);
  }, [offer?.id]);

  const applyAudio = (element, on, value) => {
    if (!element) return;
    element.muted = !on;
    element.volume = Math.min(1, Math.max(0, value / 100));
  };
  useEffect(() => { applyAudio(videoRef.current, soundOn, volume); }, [soundOn, volume]);

  // Some CDN responses stall entirely: canplay may never fire even though enough data has arrived to
  // show frames. onPlaying is the strongest signal; onLoadedData starts a stall timeout that reveals
  // the video anyway — a stalled frame beats an infinite loader.
  const [videoLoading, setVideoLoading] = useState(Boolean(offer?.video));
  const stallTimerRef = useRef(null);
  // Stable identities: the effect below lists these as dependencies, and an unstable function would
  // re-run it every render, restarting the timer instead of letting it fire.
  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
  }, []);
  const startStallTimer = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => setVideoLoading(false), 6000);
  }, [clearStallTimer]);
  useEffect(() => () => clearStallTimer(), [clearStallTimer]);

  const activeLevel = levels[levelIndex] ?? null;
  const activeChroma = chromas[chromaIndex] ?? null;
  const standardLevel = levels.find((level) => !level.item) ?? levels[0] ?? null;
  // Showcase resolution order for the selected level + variant: variant-specific video (only 865 of
  // 2921 chromas have one) → picked variant's full-quality render — a chosen variant must always
  // change the stage, so it wins over the default-color level video → level video → level icon.
  const variantVideo = activeChroma?.video ?? null;
  const wantsVariantStill = !variantVideo && chromaIndex > 0 && activeChroma?.render;
  const activeVideo = wantsVariantStill ? null : (variantVideo ?? activeLevel?.video ?? offer?.video ?? null);
  const activeRender = wantsVariantStill ? activeChroma.render : null;
  const stillImage = activeRender ?? standardLevel?.icon ?? offer?.image ?? null;

  // Reset the loading state machine whenever the stage content changes — mirrors the <video> remount
  // below (same key inputs).
  useEffect(() => {
    setVideoLoading(Boolean(activeVideo));
    if (activeVideo) startStallTimer();
    else clearStallTimer();
  }, [activeVideo, startStallTimer, clearStallTimer]);

  return (
    <div className="overlay open skin-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal skin-modal" role="dialog" aria-modal="true" aria-label={`${offer?.name ?? 'Skin'} showcase`}>
        <div className="dialog-head">
          <span style={{ color: 'var(--red)' }}>▚</span>
          <span className="skin-modal-name">{(offer?.name ?? 'SKIN').toUpperCase()}</span>
          <span className="spacer">{activeLevel ? levelLabel(activeLevel, levelIndex) : 'SHOWCASE'}</span>
          <button type="button" className="ghost-btn" onClick={onClose} aria-label="Close showcase"><Icon name="close" /></button>
        </div>
        <div className="skin-stage">
          {activeVideo && (
            <div className={`stage-loader${videoLoading ? ' visible' : ''}`} aria-hidden="true">
              <div className="ld-sweep"><div className="ld-sweep-label"><span className="loader-label">LOADING SHOWCASE</span></div></div>
              <span className="stage-sub">BUFFERING <b>riotcdn</b></span>
            </div>
          )}
          {activeVideo
            ? <video
                ref={videoRef}
                key={`${offer?.id ?? 'skin'}:${levelIndex}:${chromaIndex}:${videoKey}`}
                className="skin-video" src={activeVideo}
                autoPlay muted={soundOn ? undefined : true} loop playsInline
                onLoadStart={() => { setVideoLoading(true); startStallTimer(); }}
                onLoadedData={() => { startStallTimer(); }}
                onCanPlay={() => { clearStallTimer(); setVideoLoading(false); }}
                onPlaying={() => { clearStallTimer(); setVideoLoading(false); }}
                onWaiting={() => { setVideoLoading(true); startStallTimer(); }}
                onStalled={() => { startStallTimer(); }}
                onLoadedMetadata={(event) => applyAudio(event.currentTarget, soundOn, volume)}
                onError={(event) => { clearStallTimer(); event.currentTarget.classList.add('skin-video-dead'); setVideoLoading(false); }}
              />
            : <div className="skin-stage-fallback">
                {stillImage
                  ? <img src={stillImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  : <span>NO SHOWCASE AVAILABLE FOR THIS SKIN</span>}
              </div>}
          {!activeVideo && activeRender && <span className="skin-render-note">VARIANT RENDER — NO VIDEO FOR THIS VARIANT</span>}
          <div className="skin-stage-actions">
            {activeVideo && (
              <>
                <button
                  type="button" className={`ghost-btn sound-btn${soundOn ? ' on' : ''}`}
                  onClick={() => setAudioPrefs({ soundOn: !soundOn })}
                  title={soundOn ? 'Mute preview' : 'Unmute preview (not every skin video has audio)'}
                ><Icon name={soundOn ? 'sound' : 'soundoff'} size={12} /></button>
                <div className={`vol-slider${soundOn ? ' on' : ''}`} title="Preview volume">
                  <input
                    type="range" min="0" max="100" value={volume} aria-label="Preview volume"
                    onChange={(event) => setAudioPrefs({ volume: Number(event.target.value), soundOn: true })}
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
                <button type="button" className="ghost-btn" onClick={() => setVideoKey((key) => key + 1)} title="Replay from the start">
                  <Icon name="refresh" size={12} />REPLAY
                </button>
              </>
            )}
          </div>
        </div>
        {levels.length > 1 && (
          <div className="skin-variants">
            <span className="sv-label">UPGRADE</span>
            <div className="sv-row">
              {levels.map((level, index) => (
                <button
                  key={level.name + index} type="button"
                  className={`sv-btn${index === levelIndex ? ' on' : ''}${!level.video ? ' muted' : ''}`}
                  onClick={() => setLevelIndex(index)}
                  title={level.name}
                >
                  {level.icon && <img src={level.icon} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                  {levelLabel(level, index)}
                </button>
              ))}
            </div>
          </div>
        )}
        {chromas.length > 1 && (
          <div className="skin-variants">
            <span className="sv-label">VARIANT</span>
            <div className="sv-row">
              {chromas.map((chroma, index) => (
                <button
                  key={chroma.name + index} type="button"
                  className={`sv-btn sv-chroma${index === chromaIndex ? ' on' : ''}`}
                  onClick={() => setChromaIndex(index)}
                  title={chroma.name}
                >
                  <img src={chroma.swatch} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  {index === 0 ? 'DEFAULT' : `V${index}`}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="skin-modal-foot">
          <span>{chromas.length} VARIANTS · {levels.length} LEVELS</span>
          <span>[ESC] CLOSE</span>
        </div>
      </section>
    </div>
  );
}
