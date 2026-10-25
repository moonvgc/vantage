import { app, BrowserWindow, Notification, ipcMain, shell } from 'electron';
import path from 'node:path';
import { deleteAccount, renameAccount } from './accounts/accountStore.js';
import { addManualAccount, captureCurrentAccount, getAccountLocker, getAccountStats, getDashboard, refreshAccountStore } from './accounts/accountService.js';
import { findTcnoAccounts, importTcnoAccounts } from './accounts/tcnoImport.js';
import { switchToAccount, playAccount } from './accounts/switcher.js';
import { checkForUpdates, downloadInstaller } from './update/service.js';
import { runUpdateHelper } from './update/install.js';
import { classifyError } from './lib/errorKind.js';

const TRACKER_HOSTS = ['tracker.gg'];

async function result(action) {
  try { return { ok: true, data: await action() }; }
  catch (error) {
    console.error('IPC request failed:', error.message);
    return { ok: false, error: error.message || 'The request failed.', errorKind: error.kind ?? classifyError(error.message) };
  }
}

export function registerIpcHandlers() {
  ipcMain.handle('accounts:dashboard', (event) => {
    const sender = event.sender;
    // Progressive load: forward each account as it resolves so the renderer
    // paints it immediately. The promise still resolves with the full set.
    return result(() => getDashboard((progress) => {
      if (!sender.isDestroyed()) sender.send('accounts:dashboard-progress', progress);
    }));
  });
  ipcMain.handle('accounts:capture-current', (_, label) => result(() => captureCurrentAccount(label)));
  ipcMain.handle('accounts:add-manually', (_, label) => result(() => addManualAccount(label)));
  ipcMain.handle('accounts:refresh-market', (_, label) => result(() => refreshAccountStore(label)));
  ipcMain.handle('accounts:delete', (_, label) => result(async () => { await deleteAccount(label); return null; }));
  ipcMain.handle('accounts:rename', (_, oldLabel, newLabel) => result(async () => { await renameAccount(oldLabel, newLabel); return null; }));
  ipcMain.handle('accounts:switch', (_, label) => result(() => switchToAccount(label)));
  // PLAY. Launching the game is a main-process decision: the renderer asks for
  // an account, never for a command line.
  ipcMain.handle('accounts:play', (_, label, game) => result(() => playAccount(label, game === 'lol' ? 'lol' : 'valorant')));
  ipcMain.handle('accounts:locker', (_, label) => result(() => getAccountLocker(label)));
  ipcMain.handle('accounts:stats', (_, label, options) => result(() => getAccountStats(label, options)));
  // External stat sites open in the user's browser. Only https URLs on tracker.gg are
  // accepted: the renderer must not be able to hand the shell an arbitrary command or file.
  ipcMain.handle('shell:open-tracker', (_, url) => result(async () => {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:' || !TRACKER_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      throw new Error('Only tracker.gg links can be opened.');
    }
    await shell.openExternal(parsed.toString());
    return true;
  }));
  ipcMain.handle('accounts:tcno-detect', () => result(findTcnoAccounts));
  ipcMain.handle('accounts:tcno-import', (_, ids) => result(() => importTcnoAccounts(ids)));

  // Daily store rotation notice. Clicking it brings the window forward — the
  // point is to pull the user back to a store they have not seen yet.
  ipcMain.handle('notify:store-reset', (event, payload) => {
    if (!Notification.isSupported()) return { ok: true, data: false };
    const notice = new Notification({
      title: payload?.title ?? 'Daily store refreshed',
      body: payload?.body ?? 'New offers are live for your saved accounts.',
      silent: false
    });
    notice.on('click', () => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
    notice.show();
    return { ok: true, data: true };
  });

  // ---- update ----
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('update:check', (_, options) => result(() => checkForUpdates({
    currentVersion: app.getVersion(),
    force: Boolean(options?.force)
  })));

  // The download result is kept HERE, not sent back to the renderer to be reused:
  // the renderer must not name a path that will be executed.
  let verified = null;

  ipcMain.handle('update:download', (event, { info } = {}) => result(async () => {
    const sender = event.sender;
    const downloaded = await downloadInstaller(info, {
      root: app.getPath('temp'),
      onProgress: (progress) => { if (!sender.isDestroyed()) sender.send('update:progress', progress); }
    });
    verified = {
      ...downloaded,
      installDir: path.dirname(app.getPath('exe')),
      exePath: app.getPath('exe'),
      name: info?.installer?.name ?? 'update.exe'
    };
    return { path: verified.path, bytes: verified.bytes, name: verified.name };
  }));

  ipcMain.handle('update:install', () => result(async () => {
    if (!verified) throw new Error('Nothing has been downloaded yet.');
    const helperPid = runUpdateHelper({
      scratchRoot: app.getPath('temp'),
      installerPath: verified.path,
      installDir: verified.installDir,
      exePath: verified.exePath,
      pid: process.pid,
      electronPath: process.execPath
    });
    // The helper is already detached and waiting for this PID to disappear; exit so the installer can overwrite
    // Sapphire.exe. The delay is not merely "so the IPC reply has time to arrive": the renderer shows
    // it as INSTALLING… plus a toast, and at 400ms both pass by before they can be
    // read — an app that closes the instant after the user presses UPDATE cannot be told apart from
    // an app that crashed. The helper itself waits up to 60 seconds, so this pause is free.
    setTimeout(() => app.quit(), 2500);
    return { helperPid };
  }));

  // Custom window controls (frameless title bar).
  ipcMain.handle('window:minimize', (event) => { BrowserWindow.fromWebContents(event.sender)?.minimize(); });
  ipcMain.handle('window:maximizeToggle', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle('window:close', (event) => { BrowserWindow.fromWebContents(event.sender)?.close(); });
  ipcMain.handle('window:isMaximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}
