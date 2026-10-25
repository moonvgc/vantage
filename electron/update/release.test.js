import { describe, expect, it } from 'vitest';
import { compareVersions, pickInstaller, readRelease } from './release.js';

// Versions are compared as NUMBERS per part. String comparison has a classic bug:
// '0.1.10' < '0.1.9' lexicographically, meaning the app will stop offering updates
// forever once the tenth version ships — and it fails SILENTLY.
describe('compareVersions', () => {
  it('treats the tenth patch as newer than the ninth', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
  });
  it('reports equal versions as equal', () => {
    expect(compareVersions('0.1.2', '0.1.2')).toBe(0);
  });
  it('treats a missing part as zero', () => {
    expect(compareVersions('0.1', '0.1.0')).toBe(0);
    expect(compareVersions('0.2', '0.1.9')).toBe(1);
  });
  it('ignores a leading v', () => {
    expect(compareVersions('v0.1.3', '0.1.2')).toBe(1);
  });
  it('reports an older version as older', () => {
    expect(compareVersions('0.1.1', '0.1.2')).toBe(-1);
  });
});

describe('pickInstaller', () => {
  const assets = [
    { name: 'Sapphire 0.1.3.exe', browser_download_url: 'https://x/portable' },
    { name: 'Sapphire Setup 0.1.3.exe', browser_download_url: 'https://x/setup', size: 100, digest: 'sha256:abc' },
    { name: 'latest.yml', browser_download_url: 'https://x/yml' }
  ];
  it('picks the NSIS installer, not the portable build', () => {
    expect(pickInstaller(assets).browser_download_url).toBe('https://x/setup');
  });
  // GitHub normalises spaces in REST-uploaded asset names to DOTS. A fixture that only
  // uses spaced names lets this bug slip through unit tests and only surfaces from a
  // REAL release: the updater misses its installer and stops offering updates.
  it('accepts the dot-normalised name GitHub actually stores', () => {
    expect(pickInstaller([{ name: 'Sapphire.Setup.0.1.3.exe', browser_download_url: 'https://x/setup' }]).browser_download_url).toBe('https://x/setup');
  });
  it('still refuses the portable build under either spelling', () => {
    expect(pickInstaller([{ name: 'Sapphire.0.1.3.exe' }])).toBeNull();
    expect(pickInstaller([{ name: 'Sapphire 0.1.3.exe' }])).toBeNull();
  });
  it('returns null when no installer was attached', () => {
    expect(pickInstaller([{ name: 'notes.txt' }])).toBeNull();
    expect(pickInstaller([])).toBeNull();
    expect(pickInstaller(undefined)).toBeNull();
  });
});

describe('readRelease', () => {
  const release = {
    tag_name: 'v0.1.3',
    body: 'Fixed the thing.',
    published_at: '2026-09-16T00:00:00Z',
    assets: [{ name: 'Sapphire Setup 0.1.3.exe', browser_download_url: 'https://x/setup', size: 99, digest: 'sha256:deadbeef' }]
  };

  it('reports an update when the tag is newer and an installer is attached', () => {
    const result = readRelease(release, '0.1.2');
    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('0.1.3');
    expect(result.installer.name).toBe('Sapphire Setup 0.1.3.exe');
    expect(result.installer.digest).toBe('sha256:deadbeef');
    expect(result.reason).toBe('ok');
  });

  // A 404 from /releases/latest = "no release yet", and this repo INDEED has none.
  // If this were treated as an error, new users would keep seeing a failure message.
  it('treats a missing release as up to date, not as a failure', () => {
    const result = readRelease(null, '0.1.2');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-releases');
  });

  it('reports up-to-date when the tag is not newer', () => {
    expect(readRelease({ ...release, tag_name: 'v0.1.2' }, '0.1.2').reason).toBe('up-to-date');
    expect(readRelease({ ...release, tag_name: 'v0.1.1' }, '0.1.2').reason).toBe('up-to-date');
  });

  it('ignores prereleases and drafts', () => {
    expect(readRelease({ ...release, prerelease: true }, '0.1.2').available).toBe(false);
    expect(readRelease({ ...release, prerelease: true }, '0.1.2').reason).toBe('prerelease');
    expect(readRelease({ ...release, draft: true }, '0.1.2').reason).toBe('draft');
  });

  it('is honest when a newer version has no installer attached', () => {
    const result = readRelease({ ...release, assets: [] }, '0.1.2');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-installer');
    expect(result.latestVersion).toBe('0.1.3');
  });

  it('treats a malformed payload as unusable rather than crashing', () => {
    expect(readRelease({ nope: 1 }, '0.1.2').reason).toBe('malformed');
    expect(readRelease('hi', '0.1.2').reason).toBe('malformed');
  });
});