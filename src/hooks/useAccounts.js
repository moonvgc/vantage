import { useCallback, useEffect, useRef, useState } from 'react';

export function useAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null);
  // Whether a Riot Client session is readable right now — independent of how
  // many accounts are saved. Drives the footer RIOT SESSION pill.
  const [session, setSession] = useState({ live: false });
  const [tcno, setTcno] = useState({ available: false, accounts: [] });
  const [switchingLabel, setSwitchingLabel] = useState(null);
  // Kept apart from switchingLabel: PLAY switches on the way to launching, and the row must say which.
  const [playingLabel, setPlayingLabel] = useState(null);

  const [progress, setProgress] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null); setErrorKind(null); setProgress(null);
    try {
      const [dashboard, detected] = await Promise.all([window.valorant.getDashboard(), window.valorant.detectTcno()]);
      if (!dashboard.ok) {
        setErrorKind(dashboard.errorKind ?? null);
        throw new Error(dashboard.error);
      }
      setAccounts(dashboard.data.accounts);
      setSession(dashboard.data.session ?? { live: false });
      if (detected.ok) setTcno(detected.data);
    } catch (requestError) { setError(requestError.message || 'Unable to load saved accounts.'); }
    finally { setLoading(false); setProgress(null); }
  }, []);

  // Progressive dashboard load: accounts appear one by one as their stores resolve. Progress events
  // only arrive while the main promise is pending; the final set replaces any partial state.
  useEffect(() => {
    if (!window.valorant.onDashboardProgress) return undefined;
    window.valorant.onDashboardProgress((update) => {
      setProgress(update);
      if (update?.account) {
        setAccounts((current) => {
          const exists = current.some((account) => account.id === update.account.id);
          if (!exists) return [...current, update.account];
          return current.map((account) => (account.id === update.account.id ? update.account : account));
        });
      }
    });
    return undefined;
  }, []);

  // System sleep/resume: after sleep the countdown anchors, rate-limit map and session validity are
  // all stale, so re-run the dashboard fetch once — 15s debounce, resume fires with network flicker.
  const resumingRef = useRef(false);
  useEffect(() => {
    if (!window.valorant.onSystemResumed) return undefined;
    window.valorant.onSystemResumed(() => {
      if (resumingRef.current) return;
      resumingRef.current = true;
      setTimeout(() => { resumingRef.current = false; }, 15_000);
      refresh();
    });
    return undefined;
  }, [refresh]);

  // A PLAY from the tray menu can switch the signed-in account while the window is hidden.
  useEffect(() => {
    if (!window.valorant.onAccountsChanged) return undefined;
    window.valorant.onAccountsChanged(() => refresh());
    return undefined;
  }, [refresh]);

  const capture = useCallback(async (label) => {
    const response = await window.valorant.captureCurrentAccount(label);
    if (!response.ok) throw new Error(response.error);
    await refresh();
  }, [refresh]);
  const addManually = useCallback(async (label) => {
    const response = await window.valorant.addManualAccount(label);
    if (!response.ok) throw new Error(response.error);
    await refresh();
  }, [refresh]);
  const remove = useCallback(async (label) => {
    const response = await window.valorant.deleteAccount(label);
    if (!response.ok) throw new Error(response.error);
    await refresh();
  }, [refresh]);
  const rename = useCallback(async (oldLabel, newLabel) => {
    const response = await window.valorant.renameAccount(oldLabel, newLabel);
    if (!response.ok) throw new Error(response.error);
    await refresh();
  }, [refresh]);
  const switchTo = useCallback(async (label) => {
    setSwitchingLabel(label);
    try {
      const response = await window.valorant.switchAccount(label);
      if (!response.ok) throw new Error(response.error);
      const data = response.data;
      await refresh();
      // Returned so the caller can tell a completed move from a failed one: `moved` is reported
      // separately from a store-refresh error, since the session can move while the store fails.
      return data;
    } finally { setSwitchingLabel(null); }
  }, [refresh]);
  const play = useCallback(async (label, game = 'valorant') => {
    setPlayingLabel(label);
    try {
      const response = await window.valorant.playAccount(label, game);
      if (!response.ok) throw new Error(response.error);
      // A launch on its own changes no account state, so the dashboard is not re-read for one. A
      // launch that SWITCHED first does: the `active` flag moved, and the renderer shows it as the
      // ONLINE dot and as the row pinned to the top — left stale, the app would name the wrong account.
      //
      // Started, not awaited: holding the promise open for a full dashboard fetch (every store re-read
      // from Riot) would keep `playingLabel` set — the row stuck on SWITCHING…, `busy` gating every
      // control, the launch toast delayed by seconds; the dashboard still catches up.
      const data = response.data;
      if (data?.switched) void refresh();
      return data;
    } finally { setPlayingLabel(null); }
  }, [refresh]);
  const refreshAccount = useCallback(async (label) => {
    const response = await window.valorant.refreshAccountMarket(label);
    if (!response.ok) throw new Error(response.error);
    setAccounts((current) => current.map((account) => account.label === label
      ? { ...account, active: response.data.active, status: 'ready', error: null, store: response.data.store, lastCheckedAt: new Date().toISOString() }
      : account));
  }, []);
  const importTcno = useCallback(async (ids) => {
    const response = await window.valorant.importTcno(ids);
    if (!response.ok) throw new Error(response.error);
    await refresh();
    return response.data;
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);
  return { accounts, loading, error, errorKind, progress, session, tcno, switchingLabel, playingLabel, refresh, capture, addManually, remove, rename, switchTo, play, refreshAccount, importTcno };
}
