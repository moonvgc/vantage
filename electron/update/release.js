// GitHub release parsing + version comparison. PURE: zero network, zero Electron, zero fs, so
// every decision (a newer version exists, which file is the installer, digest is published) is tested
// in unit tests instead of being discovered on a user's machine.

export const REPO = 'naraaalt/vlr-acc-manager';

// '0.1.10' is newer than '0.1.9'. String comparison says the opposite, and a comparator that gets
// that direction wrong makes the app stop offering updates FOREVER once the tenth version ships.
export function compareVersions(a, b) {
  const parts = (value) => String(value ?? '').replace(/^v/i, '').trim()
    .split('.')
    .map((piece) => Number.parseInt(piece, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

// electron-builder also produces a portable build ("Sapphire 0.1.3.exe"). That is NOT what runs for an
// in-place update, so this filter skips it.
//
// The word separators are space/dot/dash/underscore, not just space: GitHub normalises spaces in
// REST-uploaded asset names to DOTS, so a real release contains "Sapphire.Setup.0.1.3.exe". A pattern
// that only accepts spaces makes the updater miss its installer and silently stop offering updates.
const INSTALLER_NAME = /^Sapphire[ ._-]+Setup[ ._-]+.+\.exe$/i;

export function pickInstaller(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return list.find((asset) => INSTALLER_NAME.test(String(asset?.name ?? ''))) ?? null;
}

function base(currentVersion, reason) {
  return {
    available: false,
    currentVersion,
    latestVersion: null,
    reason,
    installer: null,
    notes: null,
    publishedAt: null
  };
}

/**
 * @param {object|null} payload  JSON result from /releases/latest, or null on 404
 * @param {string} currentVersion  app.getVersion()
 * @returns {{ available: boolean, currentVersion: string, latestVersion: string|null,
 *   reason: 'ok'|'up-to-date'|'no-releases'|'prerelease'|'draft'|'no-installer'|'malformed',
 *   installer: { name: string, url: string, size: number|null, digest: string|null }|null,
 *   notes: string|null, publishedAt: string|null }}
 */
export function readRelease(payload, currentVersion) {
  // A 404 from /releases/latest is how GitHub says "nothing published yet" — not an error
  // worth showing, it is in fact this repo's current state.
  if (payload == null) return base(currentVersion, 'no-releases');
  if (typeof payload !== 'object' || typeof payload.tag_name !== 'string' || !payload.tag_name.trim()) {
    return base(currentVersion, 'malformed');
  }
  if (payload.draft) return base(currentVersion, 'draft');
  if (payload.prerelease) return base(currentVersion, 'prerelease');

  const latestVersion = payload.tag_name.replace(/^v/i, '').trim();
  const installer = pickInstaller(payload.assets);
  const newer = compareVersions(latestVersion, currentVersion) > 0;

  return {
    available: newer && Boolean(installer),
    currentVersion,
    latestVersion,
    reason: newer ? (installer ? 'ok' : 'no-installer') : 'up-to-date',
    installer: installer ? {
      name: installer.name,
      url: installer.browser_download_url ?? null,
      size: Number.isFinite(installer.size) ? installer.size : null,
      // GitHub publishes {"digest":"sha256:..."} for assets uploaded since mid
      // 2025. Treated as optional: older assets can be null.
      digest: typeof installer.digest === 'string' ? installer.digest : null
    } : null,
    notes: typeof payload.body === 'string' ? payload.body.slice(0, 4000) : null,
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : null
  };
}