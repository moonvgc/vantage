import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddAccountModal from './components/AddAccountModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { AccountOverview, DailyStore, FeaturedBundleEntry, FeaturedBundleView, MarketView, NightMarketEntry, NightMarketView, StoreRefreshStrip, SkinPreviewModal } from './components/StorePanel.jsx';
import { useAccounts } from './hooks/useAccounts.js';
import { useUpdates } from './hooks/useUpdates.js';
import { useConfirm } from './components/ConfirmDialog.jsx';
import { fmtCountdown, storeCountdownSeconds, crossedStoreReset, parseRank } from './lib/format.js';
import { presentError } from './lib/errorPresentation.js';
import { getPreviewsHidden, setPreviewsHidden as persistPreviewsHidden, getSortMode, setSortMode as persistSortMode, nextSortMode } from './lib/uiPrefs.js';
import { orderAccounts, SORT_LABELS } from './lib/accountOrder.js';
import { getSetting, setSetting, subscribeSettings, getLastSelection, setLastSelection, getAnnouncedNightMarkets, setAnnouncedNightMarket } from './lib/settings.js';
import { isNewNightMarket, nightMarketOpen, nightMarketSignature } from './lib/nightMarket.js';
import { clampOfferCursor, stepOfferCursor } from './lib/offerCursor.js';
import { isRateLimited, cooldownSeconds, markRefreshed, isRefreshAllRateLimited, markRefreshAll, refreshAllCooldownSeconds } from './lib/rateLimit.js';
import { updateBusyLabel, updateInFlight, updatePillText } from './lib/updatePill.js';
import { Icon, BrandMark } from './components/Icons.jsx';
import WindowControls from './components/WindowControls.jsx';
import LockerPanel from './components/LockerPanel.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import { useProfileData } from './hooks/useProfileData.js';

const GAME_NAMES = { valorant: 'VALORANT', lol: 'LEAGUE OF LEGENDS' };

const CONTENT_TABS = [
  { id: 'store', label: 'Store', icon: 'cart', key: '1' },
  { id: 'locker', label: 'Locker', icon: 'locker', key: '2' },
  { id: 'stats', label: 'Stats', icon: 'chart', key: '3' }
];

// Skeleton mirror of the dashboard layout — stands in for the dashboard while
// accounts load, and shows "FETCHING x/y" once progress events arrive.
function LoadingSkeleton({ progress = null }) {
  return (
    <>
      <section className="panel overview skel-panel" aria-hidden="true">
        <div className="ov-head">
          <span className="skel-bar" style={{ width: 20, height: 20 }} />
          <span className="skel-bar" style={{ width: 180, height: 16 }} />
          <span className="skel-bar" style={{ width: 70, height: 12 }} />
          <span className="skel-bar" style={{ marginLeft: 'auto', width: 64, height: 20 }} />
        </div>
        <div className="ov-body">
          <div className="ov-cell ov-rank"><span className="skel-bar" style={{ width: 46, height: 46 }} /><span className="skel-bar" style={{ width: 110, height: 14 }} /></div>
          <div className="ov-cell ov-mid"><span className="skel-bar" style={{ width: 150, height: 10 }} /><span className="skel-bar" style={{ width: 120, height: 11 }} /></div>
          <div className="ov-cell ov-info">
            {[0, 1, 2, 3].map((key) => (
              <div className="kv" key={key}><span className="skel-bar" style={{ width: 70, height: 8 }} /><span className="skel-bar" style={{ width: 96, height: 12 }} /></div>
            ))}
          </div>
        </div>
      </section>
      <section className="panel refresh-strip skel-panel" aria-hidden="true">
        <span className="skel-bar" style={{ width: 15, height: 15 }} />
        <span className="skel-bar" style={{ width: 140, height: 10 }} />
        <span className="skel-bar" style={{ width: 120, height: 22 }} />
      </section>
      <section className="panel store skel-panel" aria-hidden="true">
        <div className="panel-title">
          <span className="skel-bar" style={{ width: 13, height: 13 }} />
          <span className="skel-bar" style={{ width: 90, height: 10 }} />
        </div>
        <div className="cards">
          {[0, 1, 2, 3].map((key) => (
            <article className="card" key={key}>
              <div className="prev"><span className="skel-bar" style={{ width: '72%', height: 54 }} /></div>
              <div className="meta">
                <span className="skel-bar" style={{ width: '84%', height: 11 }} />
                <span className="skel-bar" style={{ width: '46%', height: 9 }} />
              </div>
            </article>
          ))}
        </div>
        {progress && (
          <div className="skel-progress">
            <span className="skel-progress-label">
              FETCHING {progress.done}/{progress.total}
              {progress.account ? ` — ${String(progress.account.label).toUpperCase()}` : ''}
            </span>
            <span className="skel-progress-track"><span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></span>
          </div>
        )}
      </section>
    </>
  );
}

export default function App() {
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [marketLabel, setMarketLabel] = useState(null);
  // Same as marketLabel: a label, not a boolean, so the page keeps pointing at the right account
  // if the selection shifts behind it.
  const [nightMarketLabel, setNightMarketLabel] = useState(null);
  // Same again for Featured Bundles: the three are mutually exclusive — only one page may be
  // mounted, because only one can be read by the user at a time. An OBJECT rather than a bare label,
  // because Riot can be selling more than one bundle at once: the label names the account and the id
  // names which of that account's bundles is open.
  const [openBundle, setOpenBundle] = useState(null);
  const [selectedLabel, setSelectedLabel] = useState(null);
  // Daily store cursor: the card currently pointed at, or null when there is none — null is in fact
  // the valid initial state. The rules live in src/lib/offerCursor.js.
  const [selectedOffer, setSelectedOffer] = useState(null);
  // [H] skin-preview toggle persists across restarts via uiPrefs.
  const [previewsHidden, setPreviewsHidden] = useState(getPreviewsHidden);
  // Account sort mode (active-first is the invariant; this reorders the rest).
  const [sortMode, setSortMode] = useState(getSortMode);
  // The offer object itself, not an index into one of the lists: two screens now open the
  // showcase, and an index would have to say which list.
  const [previewOffer, setPreviewOffer] = useState(null);
  const [commandFlash, setCommandFlash] = useState(null);
  const [toast, setToast] = useState(null);
  const [quitOpen, setQuitOpen] = useState(false);
  // Opened by the header button only, but it must stay in the keymap guard (see keyHandler).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which view of the selected account the content column shows. Store stays the default: it is the
  // only one loaded with the dashboard, the other two ask Riot on demand.
  const [contentTab, setContentTab] = useState('store');
  // Which game PLAY starts. Valorant by default; the switch above the account list and the settings
  // panel both write the same setting.
  const [playGame, setPlayGame] = useState(() => getSetting('playGame'));
  const choosePlayGame = useCallback((game) => { setSetting('playGame', game); }, []);
  const updates = useUpdates();
  // DISMISS = silent until the app is closed, NOT skip version: the offer comes back after a restart.
  // The SYSTEM row still shows the available version — the nag is dropped, not the fact.
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busyLabel, setBusyLabel] = useState(null);
  const flashTimer = useRef(null);
  const toastTimer = useRef(null);
  const { accounts: loadedAccounts, loading, error, errorKind, progress, session, tcno, switchingLabel, playingLabel, refresh, capture, addManually, remove, rename, switchTo, play, refreshAccount, importTcno } = useAccounts();
  const { confirm, pending: confirmPending } = useConfirm();

  // The active-first invariant is orderAccounts' own (see src/lib/accountOrder.js); the
  // selected mode only reorders the accounts below it.
  const accounts = useMemo(
    () => orderAccounts(loadedAccounts, sortMode, parseRank),
    [loadedAccounts, sortMode]
  );

  const busy = Boolean(switchingLabel) || Boolean(playingLabel) || Boolean(busyLabel);
  const tcnoAvailable = Boolean(tcno.available);

  // Keep a selection once accounts load: the remembered account when REOPEN LAST ACCOUNT is on, else
  // active, else first ready, else first — same fallback after a refresh removed the current one.
  // The remembered label is a preference only; it never outranks the signed-in list ORDER.
  useEffect(() => {
    setSelectedLabel((current) => {
      if (current && accounts.some((account) => account.label === current)) return current;
      const remembered = getSetting('restoreLastSelection') ? getLastSelection() : null;
      const rememberedAccount = remembered ? accounts.find((account) => account.label === remembered) : null;
      const fallback = rememberedAccount
        ?? accounts.find((account) => account.active)
        ?? accounts.find((account) => account.status === 'ready')
        ?? accounts[0]
        ?? null;
      return fallback?.label ?? null;
    });
  }, [accounts]);

  // Remembered only while the setting is on, so turning it off leaves nothing for a later launch.
  useEffect(() => {
    if (getSetting('restoreLastSelection') && selectedLabel) setLastSelection(selectedLabel);
  }, [selectedLabel]);

  const needle = filter.trim().toLocaleLowerCase();
  // Memoised so the sidebar (React.memo) is not re-rendered by the once-a-second countdown tick.
  const visible = useMemo(
    () => accounts.filter((account) => `${account.label} ${account.accountName ?? ''} ${account.store?.accountName ?? ''}`.toLocaleLowerCase().includes(needle)),
    [accounts, needle]
  );
  const selectedIndex = visible.findIndex((account) => account.label === selectedLabel);
  // Mirrors the selection effect above, so a render before that effect runs still has a concrete account.
  const selectedAccount = selectedIndex >= 0
    ? visible[selectedIndex]
    : visible.find((account) => account.active)
      ?? visible.find((account) => account.status === 'ready')
      ?? visible[0]
      ?? null;
  const activeIndex = selectedAccount ? visible.indexOf(selectedAccount) : -1;
  // Read for every selected ready account (cached per account): the hero banner, title and wallet come
  // from it, and the LOCKER tab renders the same result instead of asking twice.
  // Debounced: holding an arrow key through the list would otherwise fire nine Riot requests per row.
  const selectedReadyLabel = selectedAccount?.status === 'ready' ? selectedAccount.label : null;
  const [lockerLabel, setLockerLabel] = useState(null);
  useEffect(() => {
    const timer = setTimeout(() => setLockerLabel(selectedReadyLabel), lockerLabel ? 450 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReadyLabel]);
  const lockerRequest = useProfileData('locker', lockerLabel, null, Boolean(lockerLabel));
  // Until the debounce settles, the previous account's locker must not dress the new one's header.
  const locker = useMemo(
    () => (lockerLabel === selectedReadyLabel ? lockerRequest : { data: null, loading: true, error: null, reload: lockerRequest.reload }),
    [lockerLabel, selectedReadyLabel, lockerRequest]
  );
  const marketAccount = accounts.find((account) => account.label === marketLabel && account.status === 'ready');
  // The door's gate MINUS its time window: a market that expires while its page is open stays
  // readable instead of vanishing under the reader. Without the ownership test, pressing S onto a
  // ready account not selling a market left the page mounted over nothing.
  const nightMarketAccount = accounts.find((account) => account.label === nightMarketLabel
    && account.status === 'ready' && account.store?.nightMarket?.offers?.length > 0);
  // The open bundle, resolved from the account it belongs to. The id is a preference, not a
  // requirement: a switch can move the page to an account that does not sell the bundle that was
  // open, and the page is about that account's sale rather than about that one bundle, so it falls
  // back to whatever that account does have. Both are null when the account sells none — which is
  // what stops FeaturedBundleView rendering its shell around nothing.
  const bundleAccount = openBundle ? accounts.find((account) => account.label === openBundle.label && account.status === 'ready') : null;
  const accountBundles = bundleAccount?.store?.bundles ?? [];
  const activeBundle = accountBundles.find((entry) => entry.id === openBundle?.id) ?? accountBundles[0] ?? null;
  // The pill reports the Riot Client session itself: a signed-in client is ACTIVE with zero accounts saved.
  const sessionActive = Boolean(session.live);

  // Switching account = a different offer list, so the old cursor points at an offer the user never
  // saw on this account. Reset to null, not 0 — the first card only moves the problem.
  useEffect(() => { setSelectedOffer(null); }, [selectedLabel]);

  // Daily store resets on a fixed 00:00 UTC server schedule — one instant worldwide (17:00 PT /
  // 20:00 ET / 07:00 WIB), shifting only where a region observes DST. Counting straight to the next
  // UTC midnight keeps the timer exact even when the last store snapshot is stale.
  const countdown = useMemo(() => fmtCountdown(storeCountdownSeconds(now)), [now]);

  useEffect(() => {
    setNow(Date.now());
    // Hidden (tray / minimised): the countdown nobody can see is re-rendered every 30s instead of every
    // second — still often enough to catch the 00:00 UTC rotation, at a fraction of the work.
    let last = 0;
    const timer = setInterval(() => {
      const current = Date.now();
      if (document.hidden && current - last < 30_000) return;
      last = current;
      setNow(current);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const showToast = useCallback((message, kind = 'info') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    // Warnings carry instructions (sign in, update the game) and need longer than a status line.
    toastTimer.current = setTimeout(() => setToast(null), kind === 'warn' ? 7000 : 2600);
  }, []);

  const flash = useCallback((key) => {
    setCommandFlash(key);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setCommandFlash(null), 650);
  }, []);

  // [O] cycles the sort; the active account stays pinned first in every mode, so it can never be hidden.
  const cycleSort = useCallback(() => {
    flash('O');
    setSortMode((current) => {
      const next = nextSortMode(current);
      persistSortMode(next);
      showToast(`SORT: ${SORT_LABELS[next]}`, 'ok');
      return next;
    });
  }, [flash, showToast]);

  // The moment the countdown crosses 00:00 UTC the store is new, so tell the user and pull it.
  // crossedStoreReset is monotonic, so this fires once per rotation — including when the machine
  // slept through it. Skipped while a load is in flight so a resume-triggered refresh cannot stack.
  const lastTickRef = useRef(now);
  useEffect(() => {
    const previous = lastTickRef.current;
    lastTickRef.current = now;
    if (crossedStoreReset(previous, now) == null) return;
    if (getSetting('notifyOnRotation')) {
      window.valorant?.notifyStoreReset?.({
        title: 'Daily store refreshed',
        body: `${accounts.length} account${accounts.length === 1 ? '' : 's'} — new offers are live.`
      });
    }
    if (!getSetting('autoSyncOnRotation')) {
      // Still surface it: the store rotated whether or not this app pulled the new offers.
      showToast('DAILY STORE RESET — AUTO-SYNC OFF', 'ok');
      return;
    }
    if (!loading) {
      markRefreshAll();
      refresh()
        .then(() => showToast('DAILY STORE RESET — SYNCED', 'ok'))
        .catch((failure) => showToast((failure?.message ?? String(failure)).toUpperCase(), 'warn'));
    } else {
      showToast('DAILY STORE RESET', 'ok');
    }
  }, [now, loading, accounts.length, refresh, showToast]);

  // Night Market has no schedule, so its notice is driven by its DATA: the first sync that
  // reports a window with a signature never announced for that account. Running off the
  // account list, not a timer, means a window that opened while the app was closed is announced on
  // the next launch. Its memory is written BEFORE the notice is sent (src/lib/settings.js).
  useEffect(() => {
    const announced = getAnnouncedNightMarkets();
    const fresh = accounts
      .filter((account) => account.status === 'ready')
      .map((account) => ({ label: account.label, signature: nightMarketSignature(account.store?.nightMarket) }))
      .filter((entry) => isNewNightMarket(entry.signature, announced[entry.label]));
    if (!fresh.length) return;
    for (const entry of fresh) setAnnouncedNightMarket(entry.label, entry.signature);
    const names = fresh.map((entry) => entry.label.toUpperCase());
    if (getSetting('notifyNightMarket')) {
      window.valorant?.notifyStoreReset?.({
        title: 'Night Market',
        // Not the daily store sentence: this event is per-account, so the body names how many accounts have one.
        body: names.length === 1 ? `${names[0]} — a Night Market is open.` : `${names.length} accounts — a Night Market is open.`
      });
    }
    showToast(`NIGHT MARKET — ${names.join(', ')}`, 'ok');
  }, [accounts, showToast]);

  const doSwitch = useCallback(async (label) => {
    const target = label ?? selectedAccount?.label;
    if (!target || busy) return;
    // CONFIRM SWITCH & DELETE REMOVES a safeguard, so it is read here at press time: off acts immediately.
    if (getSetting('confirmDestructive')) {
      const ok = await confirm({
        title: 'SWITCH ACCOUNT',
        body: `Switch the Riot Client to “${target}”? The client restarts with this account's saved session.`,
        confirmLabel: 'SWITCH',
        danger: true
      });
      if (!ok) return;
    }
    flash('S');
    // The panel follows at PRESS time, not when the switch reports back: a switch restarts Riot Client
    // and waits for the new session (60s window), and waiting for `moved` would leave the panel and the
    // daily store on the account the user just left. Not a lie meanwhile — the target reads SAVED.
    const previous = selectedLabel;
    setSelectedLabel(target);
    switchTo(target)
      .then((data) => {
        // The open page follows the session: left alone it keeps pointing at the PREVIOUS account, and
        // because the header prints that label the switch looks like it did nothing. Retargeted on
        // `moved`, not full success — the main process reports the move separately from a refresh failure.
        if (data?.moved) {
          setMarketLabel((current) => (current ? target : current));
          setNightMarketLabel((current) => (current ? target : current));
          setOpenBundle((current) => (current ? { label: target, id: current.id } : current));
        }
        // The move is reported either way; a store that could not be read yet is a warning on top of it.
        if (data?.loginRequired) showToast(`RIOT WANTS A NEW LOGIN — SIGN IN TO ${target.toUpperCase()} IN THE RIOT CLIENT, VANTAGE SAVES IT`, 'warn');
        else if (data?.refreshError) showToast(`${target.toUpperCase()} SWITCHED — STORE NOT READ YET`, 'warn');
        else showToast(`SWITCHED SESSION → ${target.toUpperCase()}`, 'ok');
      })
      .catch((failure) => {
        // switchTo rejects for exactly the failures BEFORE the client is touched, so nothing moved and
        // the panel must go back — but only if it is still where this press put it: an arrow key during
        // the wait is the user's own, newer choice and outranks this press's undo.
        setSelectedLabel((current) => (current === target ? previous : current));
        showToast((failure?.message ?? String(failure)).toUpperCase(), 'warn');
      });
  }, [busy, selectedAccount, selectedLabel, switchTo, showToast, flash, confirm]);

  // PLAY is one press: switch Riot Client to the account when it does not own the session, then
  // launch. No prompt — the press is the instruction; the destructive case (ending a game already
  // open under another account) is refused by the main process. Offered per src/lib/playGate.js.
  const doPlay = useCallback((label) => {
    const target = label ?? selectedAccount?.label;
    if (!target || busy) return;
    const gameName = GAME_NAMES[playGame] ?? GAME_NAMES.valorant;
    play(target, playGame)
      .then((data) => {
        if (data?.reason === 'already-running') showToast(`${gameName} IS ALREADY RUNNING`, 'warn');
        else if (data?.reason === 'close-game-first') showToast('CLOSE THE OPEN GAME FIRST — SWITCHING WOULD END IT', 'warn');
        else if (data?.reason === 'login-required') showToast(`SIGN IN TO ${target.toUpperCase()} IN THE RIOT CLIENT — ${gameName} STARTS AFTER THAT`, 'warn');
        else if (data?.reason === 'needs-update') showToast(`${gameName} NEEDS AN UPDATE — PRESS UPDATE IN THE RIOT CLIENT`, 'warn');
        else if (data?.launched) showToast(`${data.switched ? 'SWITCHED + ' : ''}LAUNCHING ${gameName} — ${target.toUpperCase()}`, 'ok');
        // PLAY switches too, and the panel has to follow — gated on the backend's `switched` flag rather
        // than at press time like SWITCH, because a PLAY press can be refused outright (a game already
        // open under another account) with nothing happening at all.
        if (data?.switched) setSelectedLabel(target);
      })
      .catch((failure) => showToast((failure?.message ?? String(failure)).toUpperCase(), 'warn'));
  }, [busy, selectedAccount, play, playGame, showToast]);

  const doRefresh = useCallback((label) => {
    const target = label ?? selectedAccount?.label;
    if (!target || busy) return;
    if (isRateLimited(target)) {
      flash('R');
      showToast(`RATE LIMITED — ${target.toUpperCase()} RETRY IN ${cooldownSeconds(target)}s`, 'warn');
      return;
    }
    flash('R');
    setBusyLabel(target);
    refreshAccount(target)
      .then(() => { markRefreshed(target); showToast(`${target.toUpperCase()} STORE SYNCED`, 'ok'); })
      .catch((failure) => showToast((failure?.message ?? String(failure)).toUpperCase(), 'warn'))
      .finally(() => setBusyLabel(null));
  }, [busy, selectedAccount, refreshAccount, showToast, flash]);

  const doRefreshAll = useCallback(() => {
    if (isRefreshAllRateLimited()) {
      flash('CTRL+R');
      showToast(`RATE LIMITED — RETRY IN ${refreshAllCooldownSeconds()}s`, 'warn');
      return;
    }
    flash('CTRL+R');
    markRefreshAll();
    refresh()
      .then(() => showToast(`${accounts.length} ACCOUNTS SYNCED`, 'ok'))
      .catch((failure) => showToast((failure?.message ?? String(failure)).toUpperCase(), 'warn'));
  }, [accounts.length, refresh, showToast, flash]);

  const doDelete = useCallback(async (label) => {
    const target = label ?? selectedAccount?.label;
    if (!target || busy) return;
    if (getSetting('confirmDestructive')) {
      const ok = await confirm({
        title: 'DELETE ACCOUNT',
        body: `Delete saved account “${target}”? This cannot be undone.`,
        confirmLabel: 'DELETE',
        danger: true
      });
      if (!ok) return;
    }
    flash('X');
    remove(target)
      .then(() => showToast('ACCOUNT DELETED', 'warn'))
      .catch((failure) => showToast((failure?.message ?? String(failure)).toUpperCase(), 'warn'));
  }, [busy, selectedAccount, remove, showToast, flash, confirm]);

  const doRename = useCallback(async (oldLabel, newLabel) => {
    try {
      await rename(oldLabel, newLabel);
      setSelectedLabel((current) => (current === oldLabel ? newLabel : current));
      showToast(`RENAMED → ${newLabel.toUpperCase()}`, 'ok');
    } catch (failure) {
      showToast((failure?.message ?? String(failure)).toUpperCase(), 'warn');
    }
  }, [rename, showToast]);

  const openAdding = useCallback(() => setAdding(true), []);

  const openMarket = useCallback((label) => {
    const target = accounts.find((account) => account.label === label);
    if (target?.status === 'ready' && !busy) {
      setMarketLabel(label);
      setNightMarketLabel(null);
      setOpenBundle(null);
    }
  }, [accounts, busy]);

  const startUpdate = useCallback(async () => {
    const release = updates.release;
    if (!release?.available) return;
    const megabytes = release.installer.size ? `~${Math.round(release.installer.size / 1048576)} MB` : 'the installer';
    const ok = await confirm({
      title: `UPDATE TO ${String(release.latestVersion).toUpperCase()}`,
      body: `Vantage will download ${release.installer.name} (${megabytes}), close, run the installer silently, and start again. Saved accounts and sessions are not touched.`,
      confirmLabel: 'UPDATE',
      danger: true
    });
    if (!ok) return;
    // Both halves report themselves, and each one has to: after the dialog closes nothing else on
    // screen says whether the press did anything. The download reports through the pill
    // (src/lib/updatePill.js); the install gets a toast because the pill disappears with the window.
    const downloaded = await updates.download();
    if (!downloaded) {
      // The pill goes back to offering the version, which on its own looks like nothing was ever tried.
      showToast('UPDATE DOWNLOAD FAILED — CHECK YOUR CONNECTION AND TRY AGAIN', 'warn');
      return;
    }
    showToast(`INSTALLING VANTAGE ${String(release.latestVersion).toUpperCase()} — IT WILL CLOSE AND REOPEN`, 'ok');
    const installed = await updates.install();
    if (!installed) showToast('THE INSTALLER COULD NOT START — TRY AGAIN', 'warn');
  }, [confirm, updates, showToast]);

  const toggleMarket = useCallback(() => {
    if (busy) return;
    setMarketLabel((current) => (current ? null : selectedAccount?.status === 'ready' ? selectedAccount.label : null));
    setNightMarketLabel(null);
    setOpenBundle(null);
  }, [busy, selectedAccount]);

  // Same as toggleMarket, but gated on an account that REALLY sells a bundle: [B] on an account with
  // none does nothing instead of opening an empty page. It opens the FIRST bundle; the tabs on the
  // page are how you reach the others.
  const toggleBundle = useCallback(() => {
    if (busy) return;
    const first = selectedAccount?.store?.bundles?.[0];
    if (!first) return;
    setOpenBundle((current) => (current ? null : { label: selectedAccount.label, id: first.id }));
    setNightMarketLabel(null);
    setMarketLabel(null);
  }, [busy, selectedAccount]);

  // Which bundle the open page is about. The account and the page stay as they are — only the id moves,
  // so switching bundles cannot drop the reader back to the dashboard.
  const selectBundle = useCallback((id) => {
    setOpenBundle((current) => (current ? { ...current, id } : current));
  }, []);

  // Flash and toggle together: called by the keymap and the COMMANDS panel in the sidebar.
  const doOpenBundle = useCallback(() => {
    flash('B');
    toggleBundle();
  }, [flash, toggleBundle]);

  // Single global keymap: the listener subscribes once and reads the freshest closure through the ref.
  // The ref is refreshed in an effect, not during render — a discarded render would still mutate it.
  const keyHandlerRef = useRef(null);
  const keyHandler = (event) => {
    if (confirmPending) {
      // A pending confirmation owns the keyboard. Its own listener handles Escape/Enter/Tab in the
      // capture phase but only calls preventDefault, so without this guard every other key reaches
      // the keymap BEHIND it: H toggled previews, Q raised the quit prompt, A raised the add modal.
      return;
    }
    if (settingsOpen) {
      // Without this the app's hotkeys fire BEHIND the open modal: X raised the delete confirmation,
      // Q the quit prompt, A the add-account modal, H toggled a setting nobody can see. The panel's
      // own onKeyDown owns the arrows and Enter; this only closes on Escape.
      if (event.key === 'Escape') setSettingsOpen(false);
      return;
    }
    if (quitOpen) {
      if (event.key === 'Enter') { event.preventDefault(); if (window.valorant?.quitApp) window.valorant.quitApp(); else window.close(); }
      else if (event.key === 'Escape') setQuitOpen(false);
      return;
    }
    if (adding) {
      if (event.key === 'Escape') setAdding(false);
      return;
    }
    if (previewOffer) {
      if (event.key === 'Escape') setPreviewOffer(null);
      return;
    }
    const target = event.target;
    const inText = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    // Overlay close beats input blur: one Escape always closes the topmost layer, focused input or not.
    if (event.key === 'Escape' && (inText || marketLabel || nightMarketLabel || openBundle)) {
      event.preventDefault();
      if (inText) target.blur();
      else if (openBundle) setOpenBundle(null);
      else if (nightMarketLabel) setNightMarketLabel(null);
      else setMarketLabel(null);
      return;
    }
    if (inText) return;
    // Bundle page: [ and ] step between the bundles on sale, wrapping at both ends. Only while that page
    // is open, so the brackets stay free everywhere else; the tabs themselves are buttons, so this is
    // the fast path rather than the only one.
    if (openBundle && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      if (accountBundles.length > 1) {
        const at = accountBundles.findIndex((entry) => entry.id === openBundle.id);
        const step = event.key === ']' ? 1 : -1;
        const next = accountBundles[((at < 0 ? 0 : at) + step + accountBundles.length) % accountBundles.length];
        selectBundle(next.id);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      doRefreshAll();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!visible.length) return;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = visible[(activeIndex + delta + visible.length) % visible.length];
        setSelectedLabel(next.label);
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const count = selectedAccount?.store?.offers.length ?? 0;
        if (!count) return;
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        setSelectedOffer((current) => stepOfferCursor(current, delta, count));
        return;
      }
      case 'Enter':
        event.preventDefault();
        flash('M');
        // Opening the market view means closing the other two pages: otherwise [Enter] on the bundle
        // page looks like it does nothing — the bundle page wins in the render branch.
        setOpenBundle(null);
        setNightMarketLabel(null);
        if (!busy && selectedAccount?.status === 'ready') setMarketLabel(selectedAccount.label);
        return;
      case '1':
      case '2':
      case '3':
        setContentTab(CONTENT_TABS[Number(event.key) - 1].id);
        return;
      case 'm':
      case 'M':
        flash('M');
        toggleMarket();
        return;
      case 'b':
      case 'B':
        doOpenBundle();
        return;
      case 's':
      case 'S':
        if (!busy && selectedAccount) doSwitch(selectedAccount.label);
        return;
      case 'r':
      case 'R':
        if (!busy && selectedAccount) doRefresh(selectedAccount.label);
        return;
      case 'h':
      case 'H': {
        // Compute next state outside the updater: a side effect inside one runs twice under StrictMode.
        const nextHidden = !previewsHidden;
        flash('H');
        setPreviewsHidden(nextHidden);
        persistPreviewsHidden(nextHidden);
        return;
      }
      case 'p':
      case 'P': {
        // Empty cursor = no card pointed at, so [P] stays silent: opening the first card would be guessing.
        const offers = selectedAccount?.status === 'ready' ? (selectedAccount.store?.offers ?? []) : [];
        const index = clampOfferCursor(selectedOffer, offers.length);
        const offer = index === null ? null : offers[index];
        if (offer && (offer.video || (offer.levels?.length ?? 0) > 1)) { flash('P'); setPreviewOffer(offer); }
        return;
      }
      case 'i':
      case 'I':
        if (tcnoAvailable) { event.preventDefault(); flash('I'); setAdding(true); }
        return;
      case 'o':
      case 'O':
        cycleSort();
        return;
      case 'a':
      case 'A':
        // preventDefault keeps this key out of the modal input that autofocuses on the same keypress.
        event.preventDefault();
        flash('A');
        setAdding(true);
        return;
      case 'x':
      case 'X':
        if (!busy && selectedAccount) doDelete(selectedAccount.label);
        return;
      case 'q':
      case 'Q':
        setQuitOpen(true);
        return;
      case 'Escape':
        if (openBundle) setOpenBundle(null);
        else if (nightMarketLabel) setNightMarketLabel(null);
        else if (marketLabel) setMarketLabel(null);
        return;
      default:
    }
  };
  // No dependency array on purpose: runs after every commit, keeping the ref on the newest closure.
  // Declared before the listener effect so the ref is populated before input can arrive.
  useEffect(() => { keyHandlerRef.current = keyHandler; });

  useEffect(() => {
    const handler = (event) => keyHandlerRef.current?.(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // The settings panel is the other writer for these two; subscribing keeps its change visible
  // immediately in the sidebar, the store and the sort button instead of drifting to next launch.
  useEffect(() => subscribeSettings((settings) => {
    setPreviewsHidden(settings.previewsHidden);
    setSortMode(settings.sortMode);
    setPlayGame(settings.playGame);
    // The main process needs these two before any window exists (tray on close, start with Windows).
    window.valorant?.setBackgroundPrefs?.({ closeToTray: settings.closeToTray, launchAtLogin: settings.launchAtLogin });
  }), []);

  // The tray menu's "Run in background" checkbox writes the same preference from the other side.
  useEffect(() => {
    window.valorant?.onBackgroundPrefs?.((prefs) => {
      if (typeof prefs?.closeToTray === 'boolean' && prefs.closeToTray !== getSetting('closeToTray')) setSetting('closeToTray', prefs.closeToTray);
    });
  }, []);

  const pill = error ? { on: false, text: 'ERROR' } : loading ? { on: false, text: 'SYNCING' } : sessionActive ? { on: true, text: 'ACTIVE' } : { on: false, text: 'STANDBY' };

  return <div className="app-frame">
    <header className="app-header">
      <div className="brand">
        <BrandMark size={20} />
        <span className="brand-vlr">VANTAGE</span>
      </div>
      {/* App-level controls (settings) sit next to the app identity, NOT in the right cluster with
          ADD — there it reads as a pair of boxes with ADD. Do not move it back to
          .header-right without giving it a visual separator. */}
      <button type="button" className="ghost-btn hdr-settings" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Open settings"><Icon name="settings" /></button>
      <div className="header-right">
        {updates.release?.available && !updateDismissed && (
          <span className="update-notice">
            {/* The pill is the whole progress report during an update: the settings panel is shut when
                a press happens and the window closes the moment the installer starts. So press and
                dismiss are both closed while it runs — a second press restarts the download. */}
            <button
              type="button"
              className={`update-pill${updates.status === 'ready' ? ' ready' : ''}${updateInFlight(updates.status) ? ' busy' : ''}`}
              onClick={startUpdate}
              disabled={updateInFlight(updates.status)}
              title={updateInFlight(updates.status)
                ? `Update in progress — ${updateBusyLabel(updates.status)}`
                : `Version ${updates.release.latestVersion} is available`}
            >
              <Icon name="import" size={11} />
              {updatePillText({ status: updates.status, progress: updates.progress, latestVersion: updates.release.latestVersion })}
            </button>
            {!updateInFlight(updates.status) && (
              <button
                type="button" className="update-dismiss" onClick={() => setUpdateDismissed(true)}
                title="Dismiss until next launch" aria-label="Dismiss update notice"
              ><Icon name="close" size={10} /></button>
            )}
          </span>
        )}
        <button type="button" className="ghost-btn" onClick={() => setAdding(true)}><Icon name="plus" />ADD</button>
      </div>
      <WindowControls />
    </header>

    {activeBundle
      ? <main className="app-main market-main">
          <FeaturedBundleView
            bundle={activeBundle}
            bundles={accountBundles}
            now={now}
            onBack={() => setOpenBundle(null)}
            onSelect={selectBundle}
            onPreview={setPreviewOffer}
          />
        </main>
      : nightMarketAccount
      ? <main className="app-main market-main">
          <NightMarketView
            account={nightMarketAccount}
            now={now}
            onBack={() => setNightMarketLabel(null)}
            onPreview={setPreviewOffer}
          />
        </main>
      : marketAccount
      ? <main className="app-main market-main"><MarketView account={marketAccount} countdown={countdown} onBack={() => setMarketLabel(null)} /></main>
      : <main className="app-main">
          <Sidebar
            accounts={accounts} visible={visible} totalCount={accounts.length}
            selectedIndex={activeIndex} onSelect={setSelectedLabel} onOpenMarket={openMarket}
            filter={filter} onFilter={setFilter}
            sortMode={sortMode} onCycleSort={cycleSort}
            tcnoAvailable={tcnoAvailable} busy={busy} commandFlash={commandFlash}
            switchingLabel={switchingLabel} playingLabel={playingLabel}
            onSwitch={doSwitch} onPlay={doPlay} onRefresh={doRefresh} onRefreshAll={doRefreshAll}
            playGame={playGame} onPlayGame={choosePlayGame}
            onDelete={doDelete} onRename={doRename} onImport={openAdding} onAdd={openAdding}
            onOpenBundle={doOpenBundle}
          />
          <div className="v-divider" aria-hidden="true" />
          <section className="content" aria-label="Account details">
            {error && (() => {
              const presentation = presentError(error, errorKind);
              return (
                <section className="panel error-panel">
                  <div className="panel-title"><span className="corner red" /><span className="t">{presentation.title}</span></div>
                  <p className="error-msg"><Icon name="warn" size={14} /> <b>{presentation.explain}</b></p>
                  <p className="error-hint">{presentation.hint}</p>
                  <div className="error-actions">
                    <button type="button" className="ghost-btn" onClick={doRefreshAll}><Icon name="refresh" />{presentation.actionLabel}</button>
                  </div>
                </section>
              );
            })()}
            {loading && !accounts.length && (
              <LoadingSkeleton progress={progress} />
            )}
            {!loading && !accounts.length && (
              <section className="panel empty-panel">
                <div className="panel-title"><span className="corner" /><span className="t">NO ACCOUNTS SAVED</span></div>
                <p className="error-msg">Save the Riot Client session currently signed in on this PC to begin. Press <kbd>A</kbd> or click ADD.</p>
                <button type="button" className="primary-btn" onClick={() => setAdding(true)}><Icon name="plus" />ADD ACCOUNT</button>
              </section>
            )}
            {!loading && accounts.length > 0 && visible.length === 0 && (
              <section className="panel empty-panel">
                <div className="panel-title"><span className="corner" /><span className="t">NO MATCH</span></div>
                <p className="error-msg">No account matches “{filter}”. Clear the sidebar filter to see all {accounts.length}.</p>
              </section>
            )}
            {selectedAccount && (
              <>
                <AccountOverview
                  account={selectedAccount} busy={busy} onSwitch={doSwitch} onRefresh={doRefresh} onRefreshAll={doRefreshAll} onDelete={doDelete}
                  banner={locker.data?.card?.wide ?? null} title={locker.data?.title ?? null}
                  wallet={locker.data?.wallet ?? null}
                />
                {selectedAccount.status === 'ready' && <>
                  <nav className="tabs" role="tablist" aria-label="Account views">
                    {CONTENT_TABS.map((tab) => (
                      <button
                        key={tab.id} type="button" role="tab" aria-selected={contentTab === tab.id}
                        className={`tab${contentTab === tab.id ? ' on' : ''}`} onClick={() => setContentTab(tab.id)}
                      >
                        <Icon name={tab.icon} size={14} />{tab.label}<kbd>{tab.key}</kbd>
                      </button>
                    ))}
                  </nav>
                  {contentTab === 'store' && <>
                    <StoreRefreshStrip
                      countdown={countdown}
                      entry={<>
                        {/* ONE door for the bundle page, whatever the number on sale: the page itself is
                            where you choose between them. `extra` is the count of the others, so a second
                            sale is still visible in this row without a second control competing for it. */}
                        {selectedAccount.store?.bundles?.length > 0 && (
                          <FeaturedBundleEntry
                            name={selectedAccount.store.bundles[0].name}
                            discountPercent={selectedAccount.store.bundles[0].discountPercent}
                            extra={selectedAccount.store.bundles.length - 1}
                            onOpen={() => { setOpenBundle({ label: selectedAccount.label, id: selectedAccount.store.bundles[0].id }); setNightMarketLabel(null); setMarketLabel(null); }}
                          />
                        )}
                        {nightMarketOpen(selectedAccount.store?.nightMarket, now) && (
                          <NightMarketEntry onOpen={() => { setNightMarketLabel(selectedAccount.label); setOpenBundle(null); setMarketLabel(null); }} />
                        )}
                      </>}
                    />
                    <DailyStore
                      account={selectedAccount}
                      selectedOffer={selectedOffer}
                      onHoverOffer={setSelectedOffer}
                      previewsHidden={previewsHidden}
                      onPreview={setPreviewOffer}
                    />
                  </>}
                  {contentTab === 'locker' && <LockerPanel account={selectedAccount} locker={locker} onPreview={setPreviewOffer} />}
                  {contentTab === 'stats' && <StatsPanel key={selectedAccount.label} account={selectedAccount} />}
                </>}
              </>
            )}
          </section>
        </main>}

    {previewOffer && (
      <SkinPreviewModal offer={previewOffer} onClose={() => setPreviewOffer(null)} />
    )}

    <footer className="app-footer">
      <div className="brand"><BrandMark size={14} /></div>
      {/* Status row: identity on the left, version and Riot session state on the right. `?? '—'` because the bridge
          answers late: an empty version beats a footer that jumps when its promise
          lands. RIOT SESSION moved here from the header because it is STATE, not an action. */}
      <span className="foot-version">VANTAGE {updates.version ?? '—'}</span>
      <span className="session-pill">
        <span className={`dot ${pill.on ? 'on' : pill.text === 'ERROR' ? 'err' : 'off'}`} />
        RIOT SESSION: {pill.text}
      </span>
    </footer>

    <div
      className={`overlay${adding ? ' open' : ''}`}
      onClick={(event) => { if (event.target === event.currentTarget && !switchingLabel) setAdding(false); }}
      aria-hidden={!adding}
    >
      {adding && <AddAccountModal tcno={tcno} onCapture={capture} onManualAdd={addManually} onImport={importTcno} onClose={() => setAdding(false)} />}
    </div>

    <div className={`overlay${quitOpen ? ' open' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) setQuitOpen(false); }} aria-hidden={!quitOpen}>
      <div className="modal quit-modal">
        <div className="quit-big">QUIT VANTAGE</div>
        <div className="quit-sub">PRESS <kbd>ENTER</kbd> TO QUIT COMPLETELY · <kbd>ESC</kbd> TO RESUME</div>
        <div className="quit-sub">Closing the window with ✕ keeps Vantage running in the tray.</div>
      </div>
    </div>

    <div
      className={`overlay${settingsOpen ? ' open' : ''}`}
      onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}
      aria-hidden={!settingsOpen}
    >
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          version={updates.version}
          updateState={updates}
          onCheckUpdate={() => updates.check({ force: true })}
        />
      )}
    </div>

    {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
  </div>;
}
