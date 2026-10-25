// Per-account rate limiting for Riot storefront refreshes: Riot dislikes burst traffic, and the
// dashboard already fetches every account on load, so manual refreshes need a cooldown. Module-level
// store, no persistence — a restart resets cooldowns; the boot fetch is the request we would block anyway.

const COOLDOWN_MS = 30_000;
const lastRefresh = new Map(); // label → Date.now()

export function cooldownRemainingMs(label) {
  const last = lastRefresh.get(label);
  if (!last) return 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

export function markRefreshed(label) {
  lastRefresh.set(label, Date.now());
}

// Seconds remaining, rounded up (0 when the label is free to refresh).
export function cooldownSeconds(label) {
  return Math.ceil(cooldownRemainingMs(label) / 1000);
}

export function isRateLimited(label) {
  return cooldownRemainingMs(label) > 0;
}

// Global cooldown for "refresh all" — resets the whole map.
let lastRefreshAll = 0;
export function isRefreshAllRateLimited() {
  return Date.now() - lastRefreshAll < COOLDOWN_MS;
}
export function markRefreshAll() {
  lastRefreshAll = Date.now();
  const now = Date.now();
  for (const label of lastRefresh.keys()) lastRefresh.set(label, now);
}
export function refreshAllCooldownSeconds() {
  return Math.ceil(Math.max(0, COOLDOWN_MS - (Date.now() - lastRefreshAll)) / 1000);
}

export const COOLDOWN_SECONDS = COOLDOWN_MS / 1000;
