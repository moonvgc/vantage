import { promises as fs } from 'node:fs';
import path from 'node:path';
import { captureLiveCredentials, getActiveAccountId, listAccounts, loadAccount, loginPuuid, saveAccount, syncLiveLoginIntoSavedAccount, updateAccountSession } from './accountStore.js';
import { getSessionTokens, resolveShard } from '../riot/auth.js';
import { fetchAccountProfile, fetchStorefront, getDailyOffers, getFeaturedBundles, nightMarketWindow } from '../riot/store.js';
import { resolveDailyOffersOrFallback, resolveFeaturedBundlesOrFallback, resolveNightMarketOrFallback } from '../riot/contentCache.js';
import { fetchLocker, fetchStats } from '../riot/profile.js';
import { fail, classifyError } from '../lib/errorKind.js';

function expiry(accessToken) {
  try { return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')).exp * 1000; } catch { return 0; }
}
async function resolvedStore(session) {
  const [storefront, profile] = await Promise.all([fetchStorefront(session), fetchAccountProfile(session)]);
  // Riot's storefront is authoritative (offers and prices come from Riot); names, images and
  // videos come from a third-party service, so losing it degrades the labels on a store Riot
  // served fine — it must not turn the account into an error.
  const { offers, contentUnavailable } = await resolveDailyOffersOrFallback(getDailyOffers(storefront));
  return {
    accountName: session.accountName ?? null,
    offers,
    contentUnavailable,
    nightMarket: await resolvedNightMarket(storefront),
    bundles: await resolvedFeaturedBundles(storefront),
    expiresIn: storefront?.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds ?? null,
    profile
  };
}

// Night Market is missing for most of the year — far more often null than not, and the renderer
// treats it as "no market" rather than a failure. Deliberately resolved AFTER the daily store:
// a storefront that fails still fails this account, rather than being masked by a running event.
async function resolvedNightMarket(storefront) {
  const market = nightMarketWindow(storefront);
  if (!market) return null;
  const { offers, contentUnavailable } = await resolveNightMarketOrFallback(market);
  return { offers, contentUnavailable, endsAt: market.endsAt };
}

// Featured bundles: like Night Market they are absent more often than present, and an empty array means
// "nothing on sale", not a failure. Resolved after the daily offers and outside their fallback path,
// because a bundle that cannot be labelled must not touch the store.
async function resolvedFeaturedBundles(storefront) {
  const parsed = getFeaturedBundles(storefront);
  if (!parsed.length) return [];
  const { bundles, contentUnavailable } = await resolveFeaturedBundlesOrFallback(parsed);
  return bundles.map((bundle) => ({ ...bundle, contentUnavailable }));
}

// PUUID of the Riot Client session signed in right now, or null while it sits at sign-in.
async function readLivePuuid() {
  try { return (await getSessionTokens()).puuid; } catch { return null; }
}

// Which saved account the live session belongs to. The live PUUID is authoritative:
// VamAccountId.instance is only written by this app's switcher, so it never marks an account
// signed in through Riot Client directly; the marker is the fallback while no session is readable.
function isLiveAccount(storedPuuid, id, livePuuid, activeId) {
  return livePuuid !== null ? storedPuuid === livePuuid : id === activeId;
}

export async function captureCurrentAccount(label) {
  const session = await getSessionTokens();
  const shard = await resolveShard(session);
  return persistCurrentAccount(label, { ...session, shard });
}

async function persistCurrentAccount(label, session) {
  const accounts = await listAccounts();
  const target = accounts.find((account) => account.label === label);
  const duplicate = accounts.find((account) => account.label !== label && account.puuid === session.puuid);
  if (duplicate) {
    throw fail('duplicate', `This Riot account is already saved as “${duplicate.label}”. It was not copied into “${label}”.`);
  }
  if (target?.puuid && target.puuid !== session.puuid) {
    throw fail('duplicate', `“${label}” is linked to a different Riot account. Its saved session was left unchanged.`);
  }
  const apiSession = { ...session, shard: session.shard, expiresAt: expiry(session.accessToken) };
  const credentials = await captureLiveCredentials();
  const account = await saveAccount(label, credentials, { accountName: session.accountName, puuid: session.puuid, apiSession });
  return { account, store: await resolvedStore(apiSession) };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForCurrentAccount(timeoutMs = 60_000, differentFromPuuid = null) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const session = await getSessionTokens();
      if (!differentFromPuuid || session.puuid !== differentFromPuuid) return { ...session, shard: await resolveShard(session) };
      lastError = new Error('Waiting for a different Riot account to finish signing in.');
    } catch (error) {
      lastError = error;
      await sleep(1_500);
    }
  }
  throw new Error(`Riot opened its sign-in screen or did not finish signing in within 60 seconds. Sign in manually, then use “Save current login” for this account. ${lastError?.message ?? ''}`.trim());
}

export async function addManualAccount(label) {
  const { openRiotSignIn } = await import('./switcher.js');
  await openRiotSignIn();
  const session = await waitForCurrentAccount(300_000);
  return persistCurrentAccount(label, session);
}

export async function refreshSwitchedAccount(label, timeoutMs = 60_000) {
  const session = await waitForCurrentAccount(timeoutMs);
  return persistCurrentAccount(label, session);
}

// Right after a switch: did Riot Client restore the saved login, or is it sitting at its sign-in
// screen? The client says so through its own files — when Riot rejects the stored token it rewrites
// psl.authorization.riot-client to null — which answers in seconds instead of waiting out a minute.
export async function waitForSignInOutcome(riotRoot, timeoutMs = 45_000) {
  const settingsFile = path.join(riotRoot, 'Data', 'RiotGamesPrivateSettings.yaml');
  const started = Date.now();
  let clearedSeen = 0;
  while (Date.now() - started < timeoutMs) {
    try { await getSessionTokens(); return 'signed-in'; } catch { /* not yet */ }
    let text = '';
    try { text = await fs.readFile(settingsFile, 'utf8'); } catch { /* not written yet */ }
    // Twice in a row, so a file caught mid-rewrite is not mistaken for a rejected login.
    if (/riot-client:\s*null/.test(text)) { clearedSeen += 1; if (clearedSeen >= 2) return 'login-required'; }
    else clearedSeen = 0;
    await sleep(1_000);
  }
  return 'timeout';
}

async function getSavedAccountStore(label) {
  const account = await loadAccount(label);
  if (!account.apiSession || account.apiSession.expiresAt <= Date.now()) {
    throw fail('expired', 'Saved API session expired. Switch to this account, then refresh and save it again.');
  }
  const store = await resolvedStore(account.apiSession);
  await updateAccountSession(label, { ...account.apiSession, accountName: store.accountName });
  return store;
}

// Which signed-in account a record belongs to, resolved the same way the dashboard resolves it.
// Imported by the switcher so "is this account the live one?" has exactly one answer in the codebase.
export async function isAccountLive(account) {
  const storedPuuid = account.puuid ?? account.apiSession?.puuid ?? null;
  return isLiveAccount(storedPuuid, account.id, await readLivePuuid(), await getActiveAccountId());
}

export async function refreshAccountStore(label) {
  const account = await loadAccount(label);
  if (await isAccountLive(account)) {
    const refreshed = await captureCurrentAccount(label);
    return { store: refreshed.store, active: true };
  }
  return { store: await getSavedAccountStore(label), active: false };
}

// The login health shown per account. 'active' = signed in in Riot Client right now; 'ok' = a saved
// login nothing has rejected; 'unknown' = saved before logins were tracked; 'expired' = Riot refused it on a switch (sign in once to renew);
// 'missing' = the saved files hold no login at all (saved while signed out, or before "stay signed in").
function loginStateOf(saved, active) {
  if (active) return 'active';
  if (!loginPuuid(saved?.credentials)) return 'missing';
  if (saved?.login?.state === 'rejected') return 'expired';
  // Saved before the app tracked logins: it may already be used up, and only a switch can tell.
  if (!saved?.login) return 'unknown';
  return 'ok';
}

export async function getDashboard(onProgress = null) {
  // Every launch and refresh first copies the live client's login into the account it belongs to:
  // Riot rotates the token while an account is in use, so this keeps the saved copy usable.
  await syncLiveLoginIntoSavedAccount().catch(() => null);
  const accounts = await listAccounts();
  const activeId = await getActiveAccountId();
  const livePuuid = await readLivePuuid();
  const hydrated = await Promise.all(accounts.map(async (account) => {
    try {
      const saved = await loadAccount(account.label);
      return { account, saved, storedPuuid: account.puuid ?? saved.apiSession?.puuid ?? null };
    } catch (error) { return { account, storedPuuid: null, loadError: error }; }
  }));
  const owners = new Map();
  const kindOf = (error) => (error?.kind ?? classifyError(error?.message));

  // Fetch stores one account at a time. Riot rate-limits bursts; N accounts × 2 requests in
  // parallel is exactly the pattern that earns 429s. Each resolved account is handed to
  // onProgress so the renderer paints it immediately instead of waiting for the whole batch.
  const loadOne = async ({ account: entry, saved, storedPuuid, loadError }) => {
    const active = isLiveAccount(storedPuuid, entry.id, livePuuid, activeId);
    const account = { ...entry, loginState: loadError ? 'missing' : loginStateOf({ ...saved, login: entry.login }, active && livePuuid !== null) };
    if (loadError) return { ...account, active, status: 'error', error: loadError.message, errorKind: kindOf(loadError) };
    if (storedPuuid && owners.has(storedPuuid)) {
      return { ...account, active: false, status: 'error', errorKind: 'duplicate', error: `This saved session duplicates “${owners.get(storedPuuid)}”. It was not loaded as a second account.` };
    }
    if (storedPuuid) owners.set(storedPuuid, account.label);
    try { return { ...account, active, status: 'ready', store: await getSavedAccountStore(account.label) }; }
    catch (error) { return { ...account, active, status: 'error', error: error.message, errorKind: kindOf(error) }; }
  };

  // The header pill and the per-account ONLINE badge answer different questions, so both travel
  // in the payload: `session.live` is true whenever a Riot Client session is readable, even with
  // no saved account at all.
  const dashboard = (loaded) => ({ accounts: loaded, session: { live: livePuuid !== null } });

  // No saved accounts yet: return an empty list. Falling through to the stagger path would yield
  // a one-element array holding undefined, which crashes the renderer (blank window).
  if (hydrated.length === 0) return dashboard([]);
  if (hydrated.length === 1) {
    return dashboard(await Promise.all(hydrated.map(loadOne)));
  }
  const results = new Array(hydrated.length);
  // Fixed 350ms stagger + sequential start (each store fetch itself takes 300-900ms).
  let chain = Promise.resolve();
  hydrated.forEach((entry, index) => {
    chain = chain
      .then(() => (index === 0 ? null : sleep(350)))
      .then(async () => {
        results[index] = await loadOne(entry);
        onProgress?.({
          done: results.filter(Boolean).length,
          total: hydrated.length,
          account: results[index]
        });
      });
  });
  await chain;
  return dashboard(results);
}

// A usable API session for any saved account: the live Riot Client session when this account owns it
// (always fresh), otherwise its saved one — the same rule the store path follows.
async function getAccountSession(label) {
  const account = await loadAccount(label);
  if (await isAccountLive(account)) {
    const session = await getSessionTokens();
    return { ...session, shard: await resolveShard(session) };
  }
  if (!account.apiSession || account.apiSession.expiresAt <= Date.now()) {
    throw fail('expired', 'Saved API session expired. Switch to this account, then refresh and save it again.');
  }
  return account.apiSession;
}

export async function getAccountLocker(label) {
  return fetchLocker(await getAccountSession(label));
}

export async function getAccountStats(label, options) {
  return fetchStats(await getAccountSession(label), options);
}
