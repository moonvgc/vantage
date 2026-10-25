import { app, Menu, Notification, Tray, ipcMain, nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listAccounts } from './accounts/accountStore.js';
import { startSignOutWatch } from './accounts/signOutWatch.js';
import { playAccount } from './accounts/switcher.js';
import { accountEvents } from './accounts/events.js';

// Background mode: the window can close into the tray while the app keeps running — the daily store
// and Night Market notices keep firing, and the tray menu launches any saved account without opening
// the window. The renderer owns the settings UI; the two values the MAIN process needs before any
// window exists (close-to-tray, start-with-Windows) are mirrored into a small file in userData.

const DEFAULTS = { closeToTray: true, launchAtLogin: false };
const HIDDEN_ARG = '--hidden';
let prefs = { ...DEFAULTS };
let tray = null;
let quitting = false;
let trayHintShown = false;

const prefsPath = () => path.join(app.getPath('userData'), 'background.json');

async function loadPrefs() {
  try { prefs = { ...DEFAULTS, ...JSON.parse(await fs.readFile(prefsPath(), 'utf8')) }; }
  catch { prefs = { ...DEFAULTS }; }
}

async function savePrefs() {
  try { await fs.writeFile(prefsPath(), JSON.stringify(prefs), 'utf8'); } catch { /* preference only */ }
}

function applyLoginItem() {
  if (!app.isPackaged) return; // a dev build registering electron.exe at login helps nobody
  app.setLoginItemSettings({ openAtLogin: Boolean(prefs.launchAtLogin), args: [HIDDEN_ARG] });
}

export function startedHidden() {
  return process.argv.includes(HIDDEN_ARG);
}

function showWindow(getWindow) {
  const window = getWindow();
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

async function trayPlay(getWindow, label, game) {
  const name = game === 'lol' ? 'League of Legends' : 'Valorant';
  try {
    const result = await playAccount(label, game);
    if (result.reason === 'already-running') notify(`${name} is already running`, label);
    else if (result.reason === 'close-game-first') notify('Close the open game first', 'Switching accounts would end it.');
    else if (result.reason === 'login-required' || result.reason === 'needs-update') notify(result.reason === 'login-required' ? `Sign in to ${label}` : `${name} needs an update`, result.message);
    else notify(`Launching ${name}`, result.switched ? `Switched to ${label}` : label);
    // The renderer shows which account is signed in; a switch from the tray changes that.
    if (result.switched) getWindow()?.webContents.send('accounts:changed');
  } catch (error) {
    notify(`Could not launch ${name}`, error.message);
  }
}

// Built on every open, so a newly saved or renamed account shows up without bookkeeping.
async function buildMenu(getWindow) {
  let labels = [];
  try { labels = (await listAccounts()).map((account) => account.label); } catch { /* menu still works */ }
  const playMenu = (game) => (labels.length
    ? labels.map((label) => ({ label, click: () => trayPlay(getWindow, label, game) }))
    : [{ label: 'No saved accounts', enabled: false }]);
  return Menu.buildFromTemplate([
    { label: 'Open Vantage', click: () => showWindow(getWindow) },
    { type: 'separator' },
    { label: 'Play Valorant', submenu: playMenu('valorant') },
    { label: 'Play League of Legends', submenu: playMenu('lol') },
    { type: 'separator' },
    { label: 'Run in background', type: 'checkbox', checked: prefs.closeToTray, click: (item) => setPrefs({ closeToTray: item.checked }, getWindow) },
    { label: 'Quit Vantage', click: () => { quitting = true; app.quit(); } }
  ]);
}

async function setPrefs(patch, getWindow) {
  prefs = { ...prefs, ...patch };
  await savePrefs();
  applyLoginItem();
  getWindow?.()?.webContents.send('app:background-prefs', prefs);
}

export async function setupBackground({ getWindow, iconPath }) {
  await loadPrefs();
  applyLoginItem();

  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Vantage — Riot account manager');
  tray.on('click', () => showWindow(getWindow));
  tray.on('right-click', async () => tray.popUpContextMenu(await buildMenu(getWindow)));

  app.on('before-quit', () => { quitting = true; });

  // Keeps saved logins alive while the app runs: copies every renewed login into its account and
  // catches a sign-out inside the Riot Client, which kills that account's saved login at Riot.
  startSignOutWatch();

  // Outcomes that arrive after their IPC call returned (a hand sign-in after Riot rejected a saved login).
  const changed = () => getWindow()?.webContents.send('accounts:changed');
  accountEvents.on('signed-in', ({ label, game }) => {
    changed();
    notify(`Signed in — ${label}`, game ? 'Login saved. Starting the game…' : 'Login saved for next time.');
  });
  accountEvents.on('signed-out', ({ label }) => {
    changed();
    notify(`Signed out of ${label} in the Riot Client`, 'Riot deleted its saved login. Switch accounts with Vantage instead of “Sign out” — then logins stay saved.');
  });
  accountEvents.on('login-saved', ({ label }) => { changed(); notify(`Login saved — ${label}`, 'Switching to this account works again.'); });
  accountEvents.on('launched', ({ game }) => notify(`Launching ${game === 'lol' ? 'League of Legends' : 'Valorant'}`, ''));
  accountEvents.on('launch-failed', ({ error }) => notify('Could not start the game', error));
  accountEvents.on('sign-in-failed', ({ label, error }) => notify(`No sign-in saved for ${label}`, error));

  ipcMain.handle('app:get-background-prefs', () => prefs);
  ipcMain.handle('app:set-background-prefs', async (_, patch) => {
    const clean = {};
    if (typeof patch?.closeToTray === 'boolean') clean.closeToTray = patch.closeToTray;
    if (typeof patch?.launchAtLogin === 'boolean') clean.launchAtLogin = patch.launchAtLogin;
    await setPrefs(clean);
    return prefs;
  });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
}

// Wired to the window's 'close': hide instead of closing while background mode is on.
export function interceptClose(window, event) {
  if (quitting || !prefs.closeToTray) return;
  event.preventDefault();
  window.hide();
  if (!trayHintShown) {
    trayHintShown = true;
    notify('Vantage is still running', 'It keeps watching your stores in the tray. Right-click the tray icon to quit.');
  }
}
