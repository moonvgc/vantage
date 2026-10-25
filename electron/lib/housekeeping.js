// Discards the garbage the update process leaves behind. MEASURED on a real machine after four
// updates — 2.1 GB, none of it ever collected. There are FOUR shapes, and the sweep has to know all
// of them: the first version of this file knew one, the second knew three, and each time the shape
// that was missed was the one that had just been produced.
//
//   %TEMP%\nsXXXX.tmp\old-install\<our exe>   216 MB  in-place update: NSIS moves the OLD executable
//                                                     aside and abandons it. THIS is the shape our own
//                                                     updater produces on every update.
//   %TEMP%\nsXXXX.tmp\                         451 MB  full install: `app-64.7z` plus the payload it
//                                                     unpacked into `7z-out\`
//   %TEMP%\<28 random characters>\             356 MB  portable extraction: the same payload again,
//                                                     with no `ns` prefix for a name pattern to match
//   %LOCALAPPDATA%\<name>-updater\              96 MB  the installer's silent-install cache
//
// WHAT IS RISKY IS NOT DELETING, BUT DELETING TOO MUCH, so ownership is proven by CONTENT wherever
// content exists to read — our own `app-update.yml` naming this repository — and by the executable's
// own name where it does not. A directory an app is running from is left alone, and every decision
// lives in a pure function that can be tested. The runner is best-effort: a file that fails to delete
// is retried on the next launch, while the app must stay open.
//
// DELIBERATELY does not import 'electron': all paths come in as parameters, so its tests run on plain Node.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO } from '../update/release.js';

// NSIS only finishes writing to its directory a few seconds before we look at it. This age limit is
// what separates "an install that just ran" from "the leftovers of an install that has finished".
export const INSTALL_DIR_MIN_AGE_MS = 10 * 60 * 1000;

// The helper runs the installer, waits for the process to exit, THEN opens the app — so when the app starts,
// that installer is only a few seconds old. A loose limit makes sure this sweep can never
// delete a file another part of the just-finished update still needs.
export const INSTALLER_MIN_AGE_MS = 60 * 60 * 1000;

// How many pre-switch backups are kept. A backup is a safety net for a single failed
// operation, not an archive: the useful one is the newest, and after a few more switches
// nothing can use the old ones anymore.
export const BACKUPS_KEPT = 5;

// A directory is ours only if it holds our own build's `resources\app-update.yml`. That is content,
// not a name: `ns*.tmp` belongs to whichever installer created it, this machine runs other Electron
// apps whose installers leave the same shape behind, and the random-named copy would never match a
// name pattern anyway.
//
// `inUse` is the second half of the guard, and it is not hypothetical: the PORTABLE build unpacks
// into %TEMP% under a random name, so a running portable is byte-for-byte the same thing as a
// leftover. Deleting that would break the copy the user is looking at.
export function staleInstallDirs(entries, { now = Date.now(), minAgeMs = INSTALL_DIR_MIN_AGE_MS } = {}) {
  return (entries ?? [])
    .filter((entry) => entry?.owned && !entry.inUse)
    .filter((entry) => now - Number(entry.mtimeMs) > minAgeMs)
    .map((entry) => entry.name);
}

export function staleInstallers(entries, { now = Date.now(), minAgeMs = INSTALLER_MIN_AGE_MS } = {}) {
  return (entries ?? [])
    .filter((entry) => now - Number(entry.mtimeMs) > minAgeMs)
    .map((entry) => entry.name);
}

// Returns the ones that MUST BE DISCARDED (oldest first), not the ones kept — so the caller does not
// have to repeat the ordering logic, and directory order is never trusted as age order.
export function backupsToPrune(entries, keep = BACKUPS_KEPT) {
  const sorted = (entries ?? [])
    .filter(Boolean)
    .sort((a, b) => Number(a.mtimeMs) - Number(b.mtimeMs));
  return sorted.slice(0, Math.max(0, sorted.length - keep)).map((entry) => entry.name);
}

async function listDirectory(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); } catch { return []; }
}

async function statSafe(target) {
  try { return await fs.stat(target); } catch { return null; }
}

async function readTextSafe(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

// Where a build's own payload sits inside a scratch directory, relative to that directory. BOTH
// shapes are listed because both were found on disk, and the marker is READ rather than assumed: a
// directory that merely has a `resources` folder proves nothing.
const OWNERSHIP_MARKERS = [
  ['resources', 'app-update.yml'],
  ['7z-out', 'resources', 'app-update.yml']
];

// NSIS's own scratch directory. The in-place-update shape has no payload and no `app-update.yml` to
// read — all it holds is the OLD executable, moved aside — so this shape is recognised by the name
// NSIS gives the directory plus the executable's own name.
const NSIS_SCRATCH_NAME = /^ns.*\.tmp$/i;

// `REPO` is the single source of truth for who we are; app-update.yml spells the same identity as
// two separate lines, so it is split rather than duplicated here.
const [APP_OWNER, APP_REPO] = REPO.split('/');

// The app root inside a scratch directory, or null when the directory is not one of ours.
//
// `appExeName` is the running executable's own file name, passed in rather than assumed: the
// `old-install` shape is the only proof available for the shape that has no readable content, and
// comparing against the name this process is actually running under is stronger than a literal.
async function ownedAppRoot(directory, appExeName) {
  for (const marker of OWNERSHIP_MARKERS) {
    const file = path.join(directory, ...marker);
    const text = await readTextSafe(file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    // BOTH lines must match: another app's build carries its own `owner`/`repo`, and a substring test
    // would let a value that merely contains ours through.
    if (!lines.includes(`owner: ${APP_OWNER}`) || !lines.includes(`repo: ${APP_REPO}`)) continue;
    return path.dirname(path.dirname(file));
  }

  if (appExeName && NSIS_SCRATCH_NAME.test(path.basename(directory))) {
    if (await statSafe(path.join(directory, 'old-install', appExeName))) return directory;
  }
  return null;
}

// Windows locks a running executable against writing, so a directory whose Sapphire.exe cannot be
// opened for writing belongs to an app that is running RIGHT NOW — the portable build, whose
// extraction directory is otherwise indistinguishable from a leftover.
//
// A missing executable is not "running"; anything else (locked, or refused for a permission reason
// we cannot tell apart from a lock) is treated as running. The cost of guessing that way is a
// directory that gets swept on the next launch, against a cost of breaking a running app.
// Both names: the app was renamed Sapphire → Vantage, and a portable copy of either may be the one running.
const APP_EXE_NAMES = ['Vantage.exe', 'Sapphire.exe'];

async function appRunningFrom(appRoot) {
  for (const name of APP_EXE_NAMES) {
    try {
      const handle = await fs.open(path.join(appRoot, name), 'r+');
      await handle.close();
    } catch (error) {
      if (error?.code !== 'ENOENT') return true;
    }
  }
  return false;
}

// How long a FILE has existed at this path — which is not what `mtime` answers once a copy is
// involved. Windows preserves the source's last-write time across a copy, MEASURED here: a file
// backdated five hours and then copied arrived with the five-hour-old mtime intact and a birthtime of
// now. The installer's own cache is exactly that — a copy of itself — so its mtime is the installer's
// BUILD time, not when the copy landed, and an age guard reading mtime would pass the moment the file
// appeared. birthtime is when it landed.
//
// Deliberately NOT applied to the scratch DIRECTORY shapes: those mtimes are set locally by NSIS
// writing into them, with nothing copied in from elsewhere, so there is no foreign timestamp to
// inherit. `fallback` covers filesystems that do not report a creation time.
//
// This is a no-op for a file written in place — our own downloader's `%TEMP%\sapphire-update\*.exe`
// has birthtime and mtime a few milliseconds apart — so it changes nothing there and the choice only
// matters for the copied shape above.
function appearedAtMs(info) {
  if (!info) return 0;
  return Number(info.birthtimeMs) > 0 ? info.birthtimeMs : info.mtimeMs;
}

// The `.exe` files in one directory that are old enough to be garbage. Kept separate from the
// directory sweep because the two answer different questions.
async function staleInstallerFiles(directory, now, minAgeMs = INSTALLER_MIN_AGE_MS) {
  const files = [];
  for (const dirent of await listDirectory(directory)) {
    if (!dirent.isFile() || !/\.exe$/i.test(dirent.name)) continue;
    const info = await statSafe(path.join(directory, dirent.name));
    files.push({ name: dirent.name, mtimeMs: appearedAtMs(info) });
  }
  return staleInstallers(files, { now, minAgeMs });
}

// Sizes are collected BEFORE deleting, because afterwards there is nothing left to measure — and
// this number is what lets the sweep be reported as "so many MB back" instead of merely claimed.
async function measure(target) {
  const info = await statSafe(target);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  let total = 0;
  for (const dirent of await listDirectory(target)) total += await measure(path.join(target, dirent.name));
  return total;
}

// Runs on app start. Always resolves — a housekeeping failure must not be a reason
// for Sapphire not opening.
export async function sweepScratch({ tempRoot, updateDir, updaterCacheDir, appExeName, now = Date.now() } = {}) {
  const result = { removedDirs: [], removedInstallers: [], removedUpdaterCache: [], bytes: 0 };
  if (!tempRoot) return result;

  // EVERY directory, not just the ones named `ns*.tmp`: one of the two payload shapes measured on a
  // real machine has a random name, so a name pattern is the one filter that cannot be used. The probe
  // costs two stats per directory, and the marker file is only read when one of them hits.
  //
  // The age guard is what keeps this away from an install that is still on screen: an installer
  // sitting on its directory prompt holds its scratch directory open, and that directory is ours by
  // content, so age is the only thing separating it from a leftover. Ten minutes of user inattention
  // is the assumed limit, and the cost of guessing wrong is an install that fails and has to be run
  // again — the payload is read out of the scratch before anything is written to the install
  // directory, so there is no half-installed app to recover from.
  for (const dirent of await listDirectory(tempRoot)) {
    if (!dirent.isDirectory()) continue;
    const full = path.join(tempRoot, dirent.name);
    const appRoot = await ownedAppRoot(full, appExeName);
    if (!appRoot) continue;
    const info = await statSafe(full);
    const entries = [{
      name: dirent.name,
      mtimeMs: info?.mtimeMs ?? 0,
      owned: true,
      inUse: await appRunningFrom(appRoot)
    }];
    for (const name of staleInstallDirs(entries, { now })) {
      result.bytes += await measure(full);
      await fs.rm(full, { recursive: true, force: true }).catch(() => {});
      result.removedDirs.push(name);
    }
  }

  // .exe only: the helper (`apply-update.cjs`) and its logs are never touched here, because
  // both are still useful after the install finishes.
  if (updateDir) {
    for (const name of await staleInstallerFiles(updateDir, now)) {
      const target = path.join(updateDir, name);
      result.bytes += await measure(target);
      await fs.rm(target, { force: true }).catch(() => {});
      result.removedInstallers.push(name);
    }
  }

  // electron-builder's own updater cache — the folder other apps on this machine have as
  // `comfyui-desktop-2-updater` and `pi-fategui-updater`, named after package.json's `name`. On a
  // silent install the installer copies ITSELF here, and nothing in this app ever reads it: our
  // downloads go to %TEMP%\sapphire-update and are hashed there. 96 MB, and it is replaced rather
  // than accumulated (the file name is constant), so this is a bounded cost and not a growing one.
  //
  // The age is measured from the copy LANDING, not from the file's last-write time: this file is a
  // copy, so its mtime is the installer's build time and would make any guard pass instantly. See
  // appearedAtMs. Guarded by the install-directory age rather than the installer one, because unlike
  // the downloaded installer there is nothing to retry from this file.
  if (updaterCacheDir) {
    for (const name of await staleInstallerFiles(updaterCacheDir, now, INSTALL_DIR_MIN_AGE_MS)) {
      const target = path.join(updaterCacheDir, name);
      result.bytes += await measure(target);
      await fs.rm(target, { force: true }).catch(() => {});
      result.removedUpdaterCache.push(name);
    }
  }

  return result;
}
