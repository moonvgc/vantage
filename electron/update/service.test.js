import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdates, digestExpectation, digestMatches, downloadInstaller, forgetUpdate, installerPath } from './service.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');

// The body must be a real ReadableStream: the service uses Readable.fromWeb for streaming.
const streamBody = (text) => new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); }
});

const installerInfo = (digest, text = 'hello') => ({
  installer: { name: 'Sapphire Setup 0.1.3.exe', url: 'https://example.invalid/setup.exe', size: text.length, digest }
});

const binaryResponse = (text) => ({
  ok: true,
  status: 200,
  body: streamBody(text),
  headers: new Map([['content-length', String(text.length)]])
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  headers: new Map()
});

describe('digest handling', () => {
  it('understands the shape GitHub publishes', () => {
    expect(digestExpectation(`sha256:${'a'.repeat(64)}`)).toBe('a'.repeat(64));
  });
  // An unknown format is treated as "no digest", NOT as a match.
  // Otherwise a weird format could pass as verified.
  it('refuses to treat an unknown format as a verified digest', () => {
    expect(digestExpectation('md5:abc')).toBeNull();
    expect(digestExpectation('sha256:xyz')).toBeNull();
    expect(digestExpectation(null)).toBeNull();
    expect(digestExpectation(undefined)).toBeNull();
  });
  it('only matches an exact sha256', () => {
    const hex = 'b'.repeat(64);
    expect(digestMatches(`sha256:${hex}`, hex)).toBe(true);
    expect(digestMatches(`sha256:${hex.toUpperCase()}`, hex)).toBe(true);
    expect(digestMatches(`sha256:${'c'.repeat(64)}`, hex)).toBe(false);
    expect(digestMatches(null, hex)).toBe(false);
  });
});

describe('checkForUpdates', () => {
  beforeEach(() => { forgetUpdate(); });

  it('turns a 404 into "no releases yet" instead of an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Not Found' }, 404));
    const result = await checkForUpdates({ currentVersion: '0.1.2', fetchImpl, force: true, root: 'X:/tmp' });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-releases');
  });

  it('reports an available update from a real payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      tag_name: 'v0.1.3',
      assets: [{ name: 'Sapphire Setup 0.1.3.exe', browser_download_url: 'https://x/setup', size: 10, digest: 'sha256:aa' }]
    }));
    const result = await checkForUpdates({ currentVersion: '0.1.2', fetchImpl, force: true, root: 'X:/tmp' });
    expect(result.available).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caches within a session so a launch is one request, not one per render', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: 'v0.1.2', assets: [] }));
    await checkForUpdates({ currentVersion: '0.1.2', fetchImpl, force: true, root: 'X:/tmp' });
    await checkForUpdates({ currentVersion: '0.1.2', fetchImpl, root: 'X:/tmp' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-404 failure instead of reporting up to date', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'rate limited' }, 403));
    await expect(checkForUpdates({ currentVersion: '0.1.2', fetchImpl, force: true, root: 'X:/tmp' }))
      .rejects.toThrow(/403/);
  });
});

describe('downloadInstaller', () => {
  let root;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'sapphire-update-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('streams the file to temp, hashes it, and reports progress', async () => {
    const seen = [];
    const result = await downloadInstaller(installerInfo(`sha256:${sha('hello')}`), {
      root, fetchImpl: vi.fn(async () => binaryResponse('hello')), onProgress: (progress) => seen.push(progress)
    });
    expect(await readFile(result.path, 'utf8')).toBe('hello');
    expect(result.sha256).toBe(sha('hello'));
    expect(seen.at(-1)).toEqual({ received: 5, total: 5 });
  });

  it('refuses a file whose checksum does not match, and deletes it', async () => {
    const info = installerInfo(`sha256:${'0'.repeat(64)}`);
    await expect(downloadInstaller(info, { root, fetchImpl: vi.fn(async () => binaryResponse('hello')) }))
      .rejects.toThrow(/checksum/i);
    await expect(stat(installerPath(root, info))).rejects.toThrow();
  });

  // This app holds a Riot session. Running a 95 MB installer without a checksum is worse than
  // not updating at all, so a missing digest = refused.
  it('refuses when the release published no checksum at all', async () => {
    await expect(downloadInstaller(installerInfo(null), { root, fetchImpl: vi.fn(async () => binaryResponse('hello')) }))
      .rejects.toThrow(/checksum/i);
  });

  it('fails loudly when the download itself fails', async () => {
    await expect(downloadInstaller(installerInfo(`sha256:${sha('hello')}`), {
      root, fetchImpl: vi.fn(async () => ({ ok: false, status: 500, body: null, headers: new Map() }))
    })).rejects.toThrow(/500/);
  });

  // The file name comes from the GitHub payload, so it must not be able to escape the temp folder.
  it('ignores directory parts in the asset name', () => {
    expect(installerPath('C:/Temp', { installer: { name: '../../evil.exe' } })).toBe(path.join('C:/Temp', 'sapphire-update', 'evil.exe'));
  });
});