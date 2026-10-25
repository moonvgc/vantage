// What the update pill says, as a pure function.
//
// The pill is the only update surface while the settings panel is shut — exactly when a press happens
// — and it used to sit unchanged through the whole download, with the window closing a fraction of a
// second after the version finally changed: "UPDATE 0.1.6" for twenty seconds reads like a dead button.
//
// States in press order: available (nothing started), downloading (a number once the server sends a
// length, '…' until then), ready (downloaded and verified, waiting on install), installing (helper
// running, window about to close), error (last attempt failed; must not read as "nothing to do").
export function updatePillText({ status, progress, latestVersion } = {}) {
  const version = latestVersion ?? '';
  if (status === 'downloading') {
    const percent = downloadPercent(progress);
    return percent === null ? 'DOWNLOADING…' : `DOWNLOADING ${percent}%`;
  }
  if (status === 'installing') return 'INSTALLING…';
  if (status === 'ready') return 'RESTARTING…';
  if (status === 'error') return 'UPDATE FAILED';
  return version ? `UPDATE ${version}` : 'UPDATE';
}

// Whole percent, or null when the response carried no length: some CDNs omit content-length, and
// a fabricated 0% is worse than showing it is working without saying how far along.
export function downloadPercent(progress) {
  const received = Number(progress?.received);
  const total = Number(progress?.total);
  if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}

// Whether the pill may still be pressed, and whether its dismiss cross is offered: a second press
// restarts the download, and dismissing hides the only thing reporting progress.
export function updateInFlight(status) {
  return status === 'downloading' || status === 'ready' || status === 'installing';
}

export function updateBusyLabel(status) {
  if (status === 'installing') return 'the installer is starting';
  if (status === 'ready') return 'starting the installer';
  return 'downloading the update';
}
