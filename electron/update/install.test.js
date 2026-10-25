import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildHelperSource, buildInstallerArgs, helperPath, writeHelper } from './install.js';

describe('buildInstallerArgs', () => {
  // NSIS: /D= must be the LAST parameter and must not be quoted, even when the path has spaces.
  // spawn() with an argument array does not go through a shell, so nothing needs escaping.
  it('puts /D last', () => {
    expect(buildInstallerArgs('C:/Apps/Sapphire')).toEqual(['/S', '/D=C:/Apps/Sapphire']);
  });
  it('keeps a path with spaces as one single argument', () => {
    expect(buildInstallerArgs('C:/Program Files/Sapphire')).toEqual(['/S', '/D=C:/Program Files/Sapphire']);
  });
  it('omits /D when we do not know the install dir', () => {
    expect(buildInstallerArgs(null)).toEqual(['/S']);
    expect(buildInstallerArgs('')).toEqual(['/S']);
  });
});

describe('buildHelperSource', () => {
  const source = buildHelperSource();

  it('waits for the parent process before installing', () => {
    expect(source).toContain('process.kill(parentPid, 0)');
  });
  it('runs the installer silently', () => {
    expect(source).toContain("'/S'");
  });
  it('relaunches the app afterwards', () => {
    expect(source).toContain('detached: true');
  });
  it('relaunches the app WITHOUT the flag that would turn it into a bare Node process', () => {
    // The helper runs with ELECTRON_RUN_AS_NODE=1, and spawn() inherits the environment —
    // so without clearing it, the relaunched Sapphire boots as Node without a
    // script: exits instantly, no window. The first version of this test only checked
    // 'detached: true' and passed, because the problem is in the environment, not in how it spawns.
    expect(source).toContain('delete cleanEnv.ELECTRON_RUN_AS_NODE');
    expect(source).toMatch(/spawn\(exePath, \[\], \{[^}]*env: cleanEnv/);
  });
  it('supports a dry run so the mechanism can be verified without an update', () => {
    // Dry run = skip the installer but still leave a trace. That is what lets T3.5
    // prove the mechanism WITHOUT actually updating the app.
    expect(source).toContain("dryRun === 'true'");
    expect(source).toContain('dry-run-marker.txt');
    expect(source).toContain('not running the installer');
  });
  it('deletes the installer after a SUCCESSFUL install, and only then', () => {
    // 100 MB per version used to sit in temp forever. Conditional on the exit code: after a FAILED
    // install, that file is the only way to retry without re-downloading.
    expect(source).toContain('exitCode === 0');
    expect(source).toContain('fs.rmSync(installer, { force: true })');
    // The order is what matters: the guard must come first, because an unconditional rmSync would delete
    // the retry path. The two assertions above pass for misordered code; this one does not.
    expect(source.indexOf('exitCode === 0')).toBeLessThan(source.indexOf('fs.rmSync(installer'));
  });
  it('writes a log, because stdio is ignored and a silent failure is undiagnosable', () => {
    expect(source).toContain('update.log');
  });
  // The helper runs as plain Node, so it must not contain syntax that only exists in Electron.
  it('uses only node builtins', () => {
    expect(source).toContain("require('node:child_process')");
    expect(source).not.toContain('require(\'electron\')');
  });
  it('is parseable JavaScript, because a broken helper fails silently', () => {
    // Every assertion above is a substring check, and all of them pass for a helper that cannot be
    // parsed — the source is one big template literal, so a stray backtick or `${` inside a comment
    // there corrupts the generated program while leaving the markers intact. That failure is the
    // worst kind: the helper is spawned with ELECTRON_RUN_AS_NODE and stdio ignored, so it dies with
    // no message after Sapphire has already quit — "the app closed and never came back".
    expect(() => new Script(source)).not.toThrow();
  });
});

// Found from a REAL UPDATE, not from a unit test: runUpdateHelper SPAWNS the helper path,
// and nothing writes that file. Electron run as Node with a path that
// does not exist exits instantly WITHOUT a message, because stdio is deliberately ignored — so the symptom
// is "app closes, version does not change, no log". The text tests above cannot catch it, and
// the dry-run proof cannot either, because that proof WRITES the helper file itself.
describe('writeHelper', () => {
  it('writes the generated helper to disk, because nothing else does', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sapphire-helper-test-'));
    try {
      const written = writeHelper(root);
      expect(written).toBe(helperPath(root));
      expect(await readFile(written, 'utf8')).toBe(buildHelperSource());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('helperPath', () => {
  it('lives next to the installer in temp', () => {
    expect(helperPath('C:/Temp')).toContain('sapphire-update');
    expect(helperPath('C:/Temp')).toMatch(/\.cjs$/);
  });
});