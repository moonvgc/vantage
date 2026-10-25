import { app, BrowserWindow, Menu, powerMonitor, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipcHandlers.js';
import { interceptClose, setupBackground, startedHidden } from './background.js';
import { sweepScratch } from './lib/housekeeping.js';
import { updateRoot } from './update/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
let mainWindow = null;

// userData pin: the app was rebranded to "Sapphire", and Electron derives
// %APPDATA%\<name> from productName. Pinning keeps every saved account/session in
// the original folder across the rename. MUST run before app.whenReady() and any
// app.getPath('userData') use.
const LEGACY_USER_DATA_NAME = 'valorant-account-manager';
app.setPath('userData', path.join(app.getPath('appData'), LEGACY_USER_DATA_NAME));

// NO setAppUserModelId here, deliberately. Calling it was what made Windows label the taskbar button
// "Electron" and draw Electron's default mark on it, while Search and Task Manager showed the gem —
// those two read the .exe, the taskbar reads the window's identity, and an app-set id made the shell
// fall back to Electron's own. Measured by removing the call and watching the button change from
// "Electron - 1 running window" with Electron's icon to "Sapphire - 1 running window" with the gem.
//
// Nothing needs it: notifications are attributed by the process, which is Sapphire.exe. Do not add it
// back to "fix" the toast label.

// Single-instance lock. A second copy would load and re-save the same accounts index
// concurrently — the EPERM-on-rename failure the error panel explains — and could drive the
// Riot switcher at the same time as the first. MUST come AFTER the userData pin: the lock is
// keyed on the userData path, so taking it earlier would guard a directory the app does not use.
const isPrimaryInstance = app.requestSingleInstanceLock();

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

// The window icon has to be a REAL file on disk, not a path inside app.asar. Electron itself reads
// asar paths fine, so the window gets the right icon either way — but the shell does not: Explorer
// draws the taskbar button from that file, cannot see inside the archive, and falls back to Electron's
// default mark. That is exactly what happened: Search and Task Manager showed the gem (they read the
// .exe) while the taskbar showed the Electron logo. extraResources puts a copy at
// resources/icon.ico, outside the archive, for the shell to read.
function windowIconPath() {
  const packaged = path.join(process.resourcesPath ?? '', 'icon.ico');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'build', 'icon.ico');
}

// The embedded tracker pages (STATS tab) run in their own persistent session. Their user agent is the
// real Chromium one with the Electron/app tokens removed: Cloudflare compares the UA with the browser's
// client hints, and a spoofed Chrome version that disagrees with them is what kept tracker pages in an
// endless challenge loop. Same engine, same version, just without the words that flag it as an app.
function trackerSession() {
  const trackers = session.fromPartition('persist:trackers');
  const STANDARD = /^(Mozilla|AppleWebKit|Chrome|Safari)\//;
  const agent = trackers.getUserAgent()
    .split(' ')
    // Keeps the "(Windows NT …)" / "(KHTML, like Gecko)" groups and the standard product tokens; drops
    // every other Name/version token (Electron's and the app's own).
    .filter((token) => !/^[\w.-]+\/[\w.-]+$/.test(token) || STANDARD.test(token))
    .join(' ');
  trackers.setUserAgent(agent);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090E',
    // Started by Windows at login: straight to the tray, the window only appears when asked for.
    show: !startedHidden(),
    titleBarStyle: 'hidden',
    icon: windowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The STATS tab embeds tracker.gg. It refuses to be framed by an <iframe>, so a
      // <webview> (its own sandboxed guest process, no preload, no node) is the only way to show them.
      webviewTag: true
    }
  });
  window.on('close', (event) => interceptClose(window, event));
  window.on('maximize', () => window.webContents.send('window:maximized-changed', true));
  window.on('unmaximize', () => window.webContents.send('window:maximized-changed', false));
  // Menu is null, so the default F11 accelerator is gone — rebind it here.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
  // Lock every embedded guest down: no preload, no node, no popups out of the app window.
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!/^https:\/\/([a-z0-9-]+\.)*tracker\.gg\//i.test(params.src ?? '')) event.preventDefault();
  });
  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });
  if (devServerUrl) window.loadURL(devServerUrl);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return window;
}

if (!isPrimaryInstance) {
  // Another copy owns the data directory. Quit without opening a window or registering
  // handlers; the running copy comes forward through its own 'second-instance' event.
  app.quit();
} else {
  app.on('second-instance', () => focusMainWindow());

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    trackerSession();
    mainWindow = createWindow();
    setupBackground({ getWindow: () => mainWindow, iconPath: windowIconPath() }).catch((error) => console.error('Tray setup failed:', error.message));

    // Garbage from the PREVIOUS update is discarded here (the numbers belong to housekeeping.js). DELIBERATELY NOT
    // awaited and it never throws: nobody needs the result, the window must already be
    // visible, and housekeeping must not be the reason Sapphire fails to open. This sweep is also what
    // covers up for old builds, which do not know how to delete the installer.
    sweepScratch({
      tempRoot: app.getPath('temp'),
      updateDir: updateRoot(app.getPath('temp')),
      // electron-builder names the updater's cache folder after package.json's `name` — the same
      // value as the userData pin above — under Local, not Roaming. Nothing here reads it; the
      // installer's silent path copies itself into it and leaves it there.
      updaterCacheDir: path.join(process.env.LOCALAPPDATA ?? '', `${LEGACY_USER_DATA_NAME}-updater`),
      // The in-place-update shape keeps no readable content — only the old executable NSIS moved
      // aside — so it is recognised by this process's own file name rather than by a literal.
      //
      // PACKAGED ONLY. Under `npm run dev` / `npm start` this path is `electron.exe`, and handing
      // that to the sweep would make any Electron app's scratch directory on this machine match —
      // deleting exactly the thing the module exists to protect. Unpackaged means there is no
      // installer scratch of ours to collect, so the honest answer is "no name to match on".
      appExeName: app.isPackaged ? path.basename(app.getPath('exe')) : undefined
    })
      .then((swept) => {
        if (swept.bytes) console.log(`Reclaimed ${(swept.bytes / 1048576).toFixed(1)} MB of leftover update files.`);
      })
      .catch(() => {});

    // System sleep/resume: countdown, rate-limit map and Riot session state are all stale after
    // sleep. The renderer re-runs the progressive dashboard fetch and re-anchors its timers.
    powerMonitor.on('resume', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system:resumed', { resumedAt: Date.now() });
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
      else focusMainWindow();
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
