import { chmod, copyFile, mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKUPS_KEPT, INSTALLER_MIN_AGE_MS, INSTALL_DIR_MIN_AGE_MS,
  backupsToPrune, staleInstallDirs, staleInstallers, sweepScratch
} from './housekeeping.js';

// The app left real garbage on this machine — 2.1 GB across five abandoned directories in %TEMP%
// (the NSIS scratch and a second, randomly-named copy of the payload) plus a 96 MB installer cache
// under %LOCALAPPDATA% — and none of it was ever collected, because the sweep's ownership test
// required an `old-install\Sapphire.exe` that the real layout never contains. These tests pin the
// RULES that decide what is safe to delete, because the risky half of housekeeping is deleting too
// much: another app's installer, or one that is still running, must survive.

const MINUTE = 60 * 1000;
const entry = (name, ageMs, extra = {}) => ({ name, mtimeMs: Date.now() - ageMs, ...extra });

describe('staleInstallDirs', () => {
  const ours = (name, ageMs, extra = {}) => entry(name, ageMs, { owned: true, inUse: false, ...extra });

  it('removes an old directory that holds our own build', () => {
    expect(staleInstallDirs([ours('nsABCD1.tmp', 3 * 60 * MINUTE)])).toEqual(['nsABCD1.tmp']);
  });

  it('removes the randomly-named copy too, which no name pattern could ever match', () => {
    // Measured on a real machine: `%TEMP%\3JxWNWkJWREg9oOFGgmSStKSmWu\`, a complete copy of the
    // payload. It was invisible to the previous sweep, which only looked at `ns*.tmp`.
    expect(staleInstallDirs([ours('3JxWNWkJWREg9oOFGgmSStKSmWu', 3 * 60 * MINUTE)]))
      .toEqual(['3JxWNWkJWREg9oOFGgmSStKSmWu']);
  });

  it('keeps a directory that is not ours, however old it is', () => {
    // `ns*.tmp` belongs to whichever installer created it, and this machine runs other Electron apps
    // whose installers leave the same shape behind. Ownership is the only thing that may decide this.
    expect(staleInstallDirs([entry('nsOTHER.tmp', 90 * 24 * 60 * MINUTE, { owned: false, inUse: false })]))
      .toEqual([]);
  });

  it('keeps a directory whose install may still be running', () => {
    // The scratch directory is written from the START of an install to the end. Deleting mid-install
    // would break the install happening right now.
    expect(staleInstallDirs([ours('nsABCD1.tmp', 30 * 1000)])).toEqual([]);
  });

  it('keeps a directory an app is running from, however old it is', () => {
    // The portable build unpacks into %TEMP% and runs from there, so it is indistinguishable from a
    // leftover except for one thing: its own executable is locked while it runs.
    expect(staleInstallDirs([ours('3JxWNWkJWREg9oOFGgmSStKSmWu', 90 * 24 * 60 * MINUTE, { inUse: true })]))
      .toEqual([]);
  });

  it('takes the boundary exactly at the minimum age', () => {
    expect(staleInstallDirs([ours('nsOLD.tmp', INSTALL_DIR_MIN_AGE_MS + MINUTE)])).toEqual(['nsOLD.tmp']);
  });

  it('survives an empty or shapeless list', () => {
    expect(staleInstallDirs([])).toEqual([]);
    expect(staleInstallDirs(undefined)).toEqual([]);
  });
});

describe('staleInstallers', () => {
  it('removes a downloaded installer that has been sitting there', () => {
    // The helper deletes the installer after a successful install. This sweep is the backstop for
    // the cases the helper cannot cover: an install that crashed, or one run by a build old enough
    // to predate the deletion.
    const files = [entry('Sapphire.Setup.0.1.5.exe', 3 * 60 * MINUTE)];
    expect(staleInstallers(files)).toEqual(['Sapphire.Setup.0.1.5.exe']);
  });

  it('keeps one that was just used, because the relaunched app starts seconds after it exits', () => {
    // The helper runs the installer, waits for it to exit, and THEN launches the app — so at app
    // start the installer is seconds old. A generous age guard means the sweep can never delete a
    // file some other part of a just-finished update might still want.
    const files = [entry('Sapphire.Setup.0.1.6.exe', 5 * 1000)];
    expect(staleInstallers(files)).toEqual([]);
    expect(INSTALLER_MIN_AGE_MS).toBeGreaterThan(60 * 1000);
  });
});

describe('backupsToPrune', () => {
  const backups = (count) => Array.from({ length: count }, (_, index) => entry(`before-switch-${index}.vam`, (count - index) * MINUTE));

  it('keeps the newest and returns the rest, oldest first', () => {
    // 27 files had accumulated over three days — 245 MB with no pruning anywhere in the codebase.
    const pruned = backupsToPrune(backups(8), 5);
    expect(pruned).toEqual(['before-switch-0.vam', 'before-switch-1.vam', 'before-switch-2.vam']);
  });

  it('deletes nothing while the count is within the limit', () => {
    expect(backupsToPrune(backups(5), 5)).toEqual([]);
    expect(backupsToPrune(backups(2), 5)).toEqual([]);
  });

  it('keeps the NEWEST when the order in is scrambled', () => {
    // Directory order is not age order; the selector must sort rather than trust the caller.
    const scrambled = [
      entry('old.vam', 500 * MINUTE), entry('newest.vam', 1 * MINUTE),
      entry('middle.vam', 60 * MINUTE), entry('older.vam', 900 * MINUTE)
    ];
    expect(backupsToPrune(scrambled, 2)).toEqual(['older.vam', 'old.vam']);
  });

  it('defaults to a limit that actually prunes something', () => {
    expect(BACKUPS_KEPT).toBeGreaterThan(0);
    expect(BACKUPS_KEPT).toBeLessThan(50);
  });
});

// The rules above are only worth anything if the runner applies them to a real filesystem, so these
// tests build one. Every path is under a fresh mkdtemp: nothing here can touch the real machine.
describe('sweepScratch', () => {
  // The real `resources\app-update.yml` electron-builder writes into every build. Its two identity
  // lines are the ownership proof, so a fixture that gets them wrong would test nothing.
  const appUpdateYml = (owner, repo) => `owner: ${owner}\nrepo: ${repo}\nprovider: github\nupdaterCacheDirName: valorant-account-manager-updater\n`;
  const OURS = appUpdateYml('naraaalt', 'vlr-acc-manager');
  const THEIRS = appUpdateYml('someone-else', 'some-other-app');

  const plant = async (root, relative, { age = 3 * 60 * MINUTE, content = 'x' } = {}) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    const when = new Date(Date.now() - age);
    await utimes(file, when, when);
    return file;
  };
  // Directory mtimes decide the age, so a fixture has to age the directory itself, not only the
  // files inside it — `utimes` on a parent does not follow what a child write did.
  const ageDir = async (target, ageMs) => {
    const when = new Date(Date.now() - ageMs);
    await utimes(target, when, when);
  };
  const exists = async (file) => { try { await stat(file); return true; } catch { return false; } };

  // TWO fixtures, because the two halves of the sweep read different clocks and a test cannot fake
  // both. Directory ages come from mtime, which `utimes` backdates. FILE ages come from birthtime —
  // see appearedAtMs — and nothing in Node can backdate a creation time, so a file fixture is aged by
  // telling the sweep that time has passed instead. Mixing them would mean one `now` for both, and a
  // directory that must stay "fresh" would age along with the file that must be stale.
  async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'sapphire-sweep-'));
    const appExeName = 'Sapphire.exe';

    // Shape 1, ours and stale: the IN-PLACE update, which is the shape our own updater produces on
    // every update. NSIS moves the old executable aside and abandons it; there is no payload and no
    // `app-update.yml` to read here, so this is the shape a content-only check cannot see.
    await plant(root, 'nsINPLACE.tmp/old-install/Sapphire.exe');
    await ageDir(path.join(root, 'nsINPLACE.tmp'), 3 * 60 * MINUTE);

    // Shape 2, ours and stale: the NSIS scratch, payload unpacked into `7z-out\`.
    await plant(root, 'nsOURS.tmp/7z-out/resources/app-update.yml', { content: OURS });
    await plant(root, 'nsOURS.tmp/7z-out/Sapphire.exe');
    await ageDir(path.join(root, 'nsOURS.tmp'), 3 * 60 * MINUTE);

    // Shape 3, ours and stale: a complete second copy under a random name, no `ns` prefix at all.
    await plant(root, '3JxRANDOMNAME/resources/app-update.yml', { content: OURS });
    await plant(root, '3JxRANDOMNAME/Sapphire.exe');
    await ageDir(path.join(root, '3JxRANDOMNAME'), 3 * 60 * MINUTE);

    // Ours but fresh (an install or a portable run in flight) -> kept.
    await plant(root, 'nsBUSY.tmp/7z-out/resources/app-update.yml', { age: 5 * 1000, content: OURS });
    await ageDir(path.join(root, 'nsBUSY.tmp'), 5 * 1000);

    // Another app's scratch: same shape, same file name, different identity -> kept however old.
    await plant(root, 'nsTHEIRS.tmp/7z-out/resources/app-update.yml', { content: THEIRS });
    await ageDir(path.join(root, 'nsTHEIRS.tmp'), 90 * 24 * 60 * MINUTE);

    // Another app's IN-PLACE scratch: NSIS name, but the executable it moved aside is not ours.
    await plant(root, 'nsOTHERAPP.tmp/old-install/TheirApp.exe');
    await ageDir(path.join(root, 'nsOTHERAPP.tmp'), 90 * 24 * 60 * MINUTE);

    // A directory with a `resources` folder but no marker at all -> kept.
    await plant(root, 'notanapp/resources/thing.dat');

    // Both sweep targets exist but are empty here: the file half has its own fixture.
    const updateDir = path.join(root, 'sapphire-update');
    const updaterCacheDir = path.join(root, 'valorant-account-manager-updater');
    await mkdir(updateDir, { recursive: true });
    await mkdir(updaterCacheDir, { recursive: true });

    return { root, updateDir, updaterCacheDir, appExeName };
  }

  it('removes exactly the stale directories it owns and nothing else', async () => {
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    try {
      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      // nsINPLACE.tmp is the one that matters most: it is the shape our own updater produces on
      // EVERY update, and a content-only ownership check cannot see it.
      expect(result.removedDirs.sort()).toEqual(['3JxRANDOMNAME', 'nsINPLACE.tmp', 'nsOURS.tmp']);
      // The evidence that it kept what matters, asserted by name rather than by a count.
      expect(await exists(path.join(root, 'nsBUSY.tmp/7z-out/resources/app-update.yml'))).toBe(true);
      expect(await exists(path.join(root, 'nsTHEIRS.tmp/7z-out/resources/app-update.yml'))).toBe(true);
      expect(await exists(path.join(root, 'nsOTHERAPP.tmp/old-install/TheirApp.exe'))).toBe(true);
      expect(await exists(path.join(root, 'notanapp/resources/thing.dat'))).toBe(true);
      expect(await exists(path.join(root, 'nsOURS.tmp'))).toBe(false);
      expect(await exists(path.join(root, 'nsINPLACE.tmp'))).toBe(false);
      expect(await exists(path.join(root, '3JxRANDOMNAME'))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not remove an in-place scratch directory when no executable name was supplied', async () => {
    // The `old-install` shape has no readable content to prove ownership with, so it depends on the
    // caller naming this process's executable. A caller that forgets must leave the directory alone
    // rather than fall back to a literal. This is the DEV case: unpackaged, main.js passes undefined
    // precisely because the name there would be `electron.exe`, which is every Electron app's name.
    const { root, updateDir, updaterCacheDir } = await fixture();
    try {
      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir });
      expect(result.removedDirs.sort()).toEqual(['3JxRANDOMNAME', 'nsOURS.tmp']);
      expect(await exists(path.join(root, 'nsINPLACE.tmp/old-install/Sapphire.exe'))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not treat a generic Electron executable name as proof of ownership', async () => {
    // Measured shape of the bug this guards: under `npm run dev`, app.getPath('exe') is
    // node_modules/electron/dist/electron.exe. If that name reached the sweep, every Electron app's
    // in-place scratch directory on the machine would match ours.
    const { root, updateDir, updaterCacheDir } = await fixture();
    try {
      await plant(root, 'nsTHEIRDEV.tmp/old-install/electron.exe');
      await ageDir(path.join(root, 'nsTHEIRDEV.tmp'), 90 * 24 * 60 * MINUTE);
      const result = await sweepScratch({
        tempRoot: root, updateDir, updaterCacheDir, appExeName: 'electron.exe'
      });
      // It does match — which is exactly why main.js must not pass a name when unpackaged.
      expect(result.removedDirs).toContain('nsTHEIRDEV.tmp');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('leaves an in-place directory alone when the moved-aside executable is not ours', async () => {
    // Same NSIS name, same `old-install` folder, a different application's executable.
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    try {
      await plant(root, 'nsNOTOURS.tmp/old-install/OtherApp.exe');
      await ageDir(path.join(root, 'nsNOTOURS.tmp'), 90 * 24 * 60 * MINUTE);
      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(result.removedDirs).not.toContain('nsNOTOURS.tmp');
      expect(await exists(path.join(root, 'nsNOTOURS.tmp/old-install/OtherApp.exe'))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('leaves an in-place directory alone when the directory is not NSIS scratch', async () => {
    // Our executable, in an `old-install` folder, but the directory name is not one NSIS creates —
    // so the only thing tying it to us is a name we did not generate.
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    try {
      await plant(root, 'someone-elses-folder/old-install/Sapphire.exe');
      await ageDir(path.join(root, 'someone-elses-folder'), 90 * 24 * 60 * MINUTE);
      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(result.removedDirs).not.toContain('someone-elses-folder');
      expect(await exists(path.join(root, 'someone-elses-folder/old-install/Sapphire.exe'))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.runIf(process.platform === 'win32')('leaves a directory an app is running from, because the portable build lives in temp', async () => {
    // Windows refuses to open a running executable for writing — measured on this machine against a
    // live process: `fs.open('C:\Windows\explorer.exe', 'r+')` fails with EPERM, while the same call
    // on the not-running Sapphire.exe succeeds. That is the ONLY signal separating a portable build
    // the user is looking at from an abandoned copy of the same files.
    //
    // A running image cannot be faked in a unit test, so the read-only attribute stands in for it:
    // it is the same refusal (`r+` -> EPERM) for the same reason (write access denied).
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    const exe = path.join(root, '3JxRANDOMNAME/Sapphire.exe');
    try {
      await chmod(exe, 0o444);
      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(result.removedDirs.sort()).toEqual(['nsINPLACE.tmp', 'nsOURS.tmp']);
      expect(await exists(path.join(root, '3JxRANDOMNAME/resources/app-update.yml'))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('still removes a directory whose executable is already gone', async () => {
    // A missing exe is NOT "running". Getting that backwards would make a half-deleted leftover
    // permanent, which is the bug this whole sweep exists to fix.
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    try {
      await rm(path.join(root, 'nsOURS.tmp/7z-out/Sapphire.exe'), { force: true });
      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(result.removedDirs.sort()).toEqual(['3JxRANDOMNAME', 'nsINPLACE.tmp', 'nsOURS.tmp']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reports the bytes it reclaimed, so the saving is a measured number', async () => {
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    try {
      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(result.bytes).toBeGreaterThan(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('is idempotent: a second sweep finds nothing and does not throw', async () => {
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    try {
      await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      const again = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(again.removedDirs).toEqual([]);
      expect(again.removedInstallers).toEqual([]);
      expect(again.removedUpdaterCache).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('never throws when the directories do not exist at all', async () => {
    // This runs during app startup. A housekeeping failure must never be the reason Sapphire does
    // not open, so a missing temp root is a no-op rather than an error.
    await expect(sweepScratch({
      tempRoot: path.join(tmpdir(), 'does-not-exist-at-all'),
      updateDir: path.join(tmpdir(), 'also-missing'),
      updaterCacheDir: path.join(tmpdir(), 'missing-too'),
      appExeName: 'Sapphire.exe'
    })).resolves.toMatchObject({ removedDirs: [], removedInstallers: [], removedUpdaterCache: [] });
  });

  it('leaves a plain file in temp alone', async () => {
    const { root, updateDir, updaterCacheDir, appExeName } = await fixture();
    try {
      await plant(root, 'unrelated.txt');
      await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(await exists(path.join(root, 'unrelated.txt'))).toBe(true);
      expect((await readdir(root)).sort()).toEqual([
        'notanapp', 'nsBUSY.tmp', 'nsOTHERAPP.tmp', 'nsTHEIRS.tmp', 'sapphire-update',
        'unrelated.txt', 'valorant-account-manager-updater'
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

// The FILE half of the sweep, which ages on a different clock from the directories above.
describe('sweepScratch installer files', () => {
  const plantFile = async (file, content = 'x') => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    return file;
  };
  const exists = async (file) => { try { await stat(file); return true; } catch { return false; } };

  async function fileFixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'sapphire-files-'));
    const updateDir = path.join(root, 'sapphire-update');
    const updaterCacheDir = path.join(root, 'valorant-account-manager-updater');
    // Freshly written, so birthtime and mtime agree: this is a file that has just appeared.
    await plantFile(path.join(updateDir, 'Sapphire.Setup.0.1.5.exe'));
    await plantFile(path.join(updaterCacheDir, 'installer.exe'));
    // Never swept: not `.exe`. The helper is still useful after an install, and so is its log.
    await plantFile(path.join(updateDir, 'apply-update.cjs'));
    await plantFile(path.join(updateDir, 'update.log'));
    return { root, updateDir, updaterCacheDir, appExeName: 'Sapphire.exe' };
  }

  // Time is moved forward rather than the file's timestamp moved back: a creation time cannot be
  // backdated, and inventing one would test the fixture instead of the rule.
  const HOURS_2 = 2 * 60 * 60 * 1000;

  it('keeps an installer that has just been written, then collects it once it is old enough', async () => {
    const { root, updateDir, updaterCacheDir, appExeName } = await fileFixture();
    try {
      const now = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(now.removedInstallers).toEqual([]);
      expect(now.removedUpdaterCache).toEqual([]);
      expect(await exists(path.join(updateDir, 'Sapphire.Setup.0.1.5.exe'))).toBe(true);
      expect(await exists(path.join(updaterCacheDir, 'installer.exe'))).toBe(true);

      const later = await sweepScratch({
        tempRoot: root, updateDir, updaterCacheDir, appExeName, now: Date.now() + HOURS_2
      });
      expect(later.removedInstallers).toEqual(['Sapphire.Setup.0.1.5.exe']);
      expect(later.removedUpdaterCache).toEqual(['installer.exe']);
      // The helper and its log survive even then: the rule is `.exe` only.
      expect(await exists(path.join(updateDir, 'apply-update.cjs'))).toBe(true);
      expect(await exists(path.join(updateDir, 'update.log'))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps a just-arrived copy whose mtime is old, because a copy inherits the source timestamp', async () => {
    // The installer's own cache is a COPY of the installer, and Windows carries the source's
    // last-write time across a copy — measured on this machine: a file backdated five hours and then
    // copied arrived with that five-hour-old mtime intact and a birthtime of now. So the cached
    // installer's mtime is the installer's BUILD time, and an age guard reading mtime passes the
    // instant the copy lands. This is the case that made that guard inert; the age has to come from
    // when the file appeared.
    const { root, updateDir, updaterCacheDir, appExeName } = await fileFixture();
    try {
      const source = path.join(root, 'built-installer.exe');
      await plantFile(source);
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      await utimes(source, fiveHoursAgo, fiveHoursAgo);
      await copyFile(source, path.join(updaterCacheDir, 'installer.exe'));

      // The premise, asserted rather than assumed: the copy really did inherit the old timestamp, so
      // an mtime-based guard would have collected it on this very sweep.
      const copied = await stat(path.join(updaterCacheDir, 'installer.exe'));
      expect(Date.now() - copied.mtimeMs).toBeGreaterThan(INSTALL_DIR_MIN_AGE_MS);
      expect(Date.now() - copied.birthtimeMs).toBeLessThan(60 * 1000);

      const result = await sweepScratch({ tempRoot: root, updateDir, updaterCacheDir, appExeName });
      expect(result.removedUpdaterCache).toEqual([]);
      expect(await exists(path.join(updaterCacheDir, 'installer.exe'))).toBe(true);

      // ...and it IS collected once the copy itself has been sitting there long enough.
      const later = await sweepScratch({
        tempRoot: root, updateDir, updaterCacheDir, appExeName, now: Date.now() + 11 * 60 * 1000
      });
      expect(later.removedUpdaterCache).toEqual(['installer.exe']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
