import { useCallback, useEffect, useMemo, useState } from 'react';

// Locker and stats are fetched on demand (the tab is opened), not with the dashboard: they are several
// extra Riot requests per account, and most launches only look at the store. Results are kept per
// account for the session so switching tabs or accounts back and forth does not refetch.
const cache = new Map();
const MAX_AGE_MS = 5 * 60_000;

const keyOf = (kind, label, options) => `${kind}:${label}:${JSON.stringify(options ?? {})}`;

async function request(kind, label, options) {
  const api = window.valorant;
  const response = kind === 'locker' ? await api?.getLocker?.(label) : await api?.getStats?.(label, options);
  if (!response) throw new Error('This build has no locker/stats bridge.');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export function useProfileData(kind, label, options, enabled = true) {
  const key = label ? keyOf(kind, label, options) : null;
  const [state, setState] = useState(() => ({ key, data: key ? cache.get(key)?.data ?? null : null, loading: false, error: null }));

  const load = useCallback(async (force = false) => {
    if (!key) return;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < MAX_AGE_MS) {
      setState({ key, data: hit.data, loading: false, error: null });
      return;
    }
    setState((current) => ({ key, data: current.key === key ? current.data : hit?.data ?? null, loading: true, error: null }));
    try {
      const data = await request(kind, label, options);
      cache.set(key, { data, at: Date.now() });
      setState((current) => (current.key === key ? { key, data, loading: false, error: null } : current));
    } catch (failure) {
      setState((current) => (current.key === key ? { ...current, loading: false, error: failure?.message ?? String(failure) } : current));
    }
    // options is folded into key; listing it separately would refetch on every new object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind, label]);

  useEffect(() => {
    if (enabled) load(false);
    else if (key !== state.key) setState({ key, data: key ? cache.get(key)?.data ?? null : null, loading: false, error: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, load]);

  const sameKey = state.key === key;
  const reload = useCallback(() => load(true), [load]);
  const data = sameKey ? state.data : (key ? cache.get(key)?.data ?? null : null);
  const loading = sameKey ? state.loading : enabled;
  const error = sameKey ? state.error : null;
  // A stable object, so a memo'd consumer (LockerPanel) is not re-rendered by its parent's clock tick.
  return useMemo(() => ({ data, loading, error, reload }), [data, loading, error, reload]);
}
