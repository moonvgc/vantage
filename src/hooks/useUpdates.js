import { useCallback, useEffect, useState } from 'react';
import { getSetting } from '../lib/settings.js';

// Bridges update:check / update:download / update:install — the real work lives in the main process.
//
// Auto-check runs ONCE per session after the window paints, and only if the setting is on — an
// update check is a third-party request, and this app deliberately keeps the count down.
export function useUpdates() {
  const [version, setVersion] = useState(null);
  const [release, setRelease] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // The `npm run bridge` gate guarantees this bridge exists, so this try/catch is not a bug
    // cover-up: it's so any gap on the MOCK side doesn't blank the app on mount.
    try {
      window.valorant.getAppVersion().then(setVersion).catch(() => {});
      window.valorant.onUpdateProgress((update) => setProgress(update));
    } catch { /* bridge without the update method: panel still renders, version stays empty */ }
  }, []);

  const check = useCallback(async ({ force = false } = {}) => {
    setStatus('checking');
    setError(null);
    try {
      const response = await window.valorant.checkForUpdates({ force });
      if (!response.ok) throw new Error(response.error);
      setRelease(response.data);
      setStatus(response.data.available ? 'available' : 'idle');
      return response.data;
    } catch (failure) {
      // A failure NEVER becomes a toast during auto-check: offline has to feel like nothing
      // happened. The message only shows on the SYSTEM line when the user hits CHECK NOW — a button
      // pressed and then silent reads as broken.
      setError(failure.message);
      setStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!getSetting('autoCheckUpdates')) return undefined;
    // Delayed so the first render (and the expensive dashboard) doesn't compete with this request.
    const timer = setTimeout(() => { check(); }, 2500);
    return () => clearTimeout(timer);
  }, [check]);

  const download = useCallback(async () => {
    if (!release?.installer) return null;
    setStatus('downloading');
    setError(null);
    setProgress(null);
    try {
      const response = await window.valorant.downloadUpdate(release);
      if (!response.ok) throw new Error(response.error);
      setStatus('ready');
      return response.data;
    } catch (failure) {
      // A failed download is NOT a silent state: the user just confirmed a dialog. Back to
      // 'available' so the pill offers a second attempt.
      setError(failure.message);
      setStatus('available');
      return null;
    }
  }, [release]);

  const install = useCallback(async () => {
    setStatus('installing');
    setError(null);
    const response = await window.valorant.installUpdate();
    // A failure here has to leave a pressable pill: 'ready' claimed the download was finished
    // and waiting on a restart, which is not true any more and offers no way to try again.
    if (!response.ok) { setError(response.error); setStatus('error'); return false; }
    // On success the app quits shortly — no state needs cleaning up.
    return true;
  }, []);

  return { version, release, status, progress, error, check, download, install };
}