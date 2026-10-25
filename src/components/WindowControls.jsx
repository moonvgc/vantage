import { useEffect, useState } from 'react';

const bridge = () => (typeof window !== 'undefined' ? window.valorant : null);

// Custom frameless-window controls. Buttons live inside the header's drag
// region, so they opt out explicitly (-webkit-app-region: no-drag).
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const api = bridge();

  useEffect(() => {
    if (!api) return undefined;
    let disposed = false;
    api.isWindowMaximized?.().then((value) => { if (!disposed) setMaximized(Boolean(value)); }).catch(() => {});
    api.onWindowMaximizedChanged?.((value) => setMaximized(Boolean(value)));
    return () => { disposed = true; };
  }, [api]);

  return (
    <div className="win-controls" role="toolbar" aria-label="Window controls">
      <button type="button" className="win-btn" title="Minimize" aria-label="Minimize window"
        onClick={() => api?.minimizeWindow?.()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button type="button" className="win-btn" title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore window' : 'Maximize window'}
        onClick={() => api?.maximizeToggleWindow?.()}>
        {maximized
          ? <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5v-2h7v7h-2" /></svg>
          : <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>}
      </button>
      <button type="button" className="win-btn win-close" title="Close" aria-label="Close window"
        onClick={() => api?.closeWindow?.()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
    </div>
  );
}
