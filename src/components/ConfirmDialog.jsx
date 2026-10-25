import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

const ConfirmContext = createContext(null);

// Promise-based confirm dialog replacing window.confirm, whose native Windows dialog
// clashes with the TUI skin.
export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);
  const [focused, setFocused] = useState('confirm');

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setFocused(options?.danger ? 'confirm' : 'confirm');
    setDialog({
      title: options?.title ?? 'CONFIRM',
      body: options?.body ?? '',
      confirmLabel: options?.confirmLabel ?? 'CONFIRM',
      cancelLabel: options?.cancelLabel ?? 'CANCEL',
      danger: Boolean(options?.danger)
    });
  }), []);

  const settle = useCallback((value) => {
    if (resolverRef.current) resolverRef.current(value);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); settle(false); }
      else if (event.key === 'Enter') { event.preventDefault(); settle(true); }
      else if (event.key === 'Tab') {
        event.preventDefault();
        setFocused((current) => (current === 'confirm' ? 'cancel' : 'confirm'));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dialog, settle]);

  // `pending` keeps the app's keymap out of the way while a dialog is up. The listener below is in
  // the CAPTURE phase but only calls preventDefault, so keys it does not handle (H, Q) still reach
  // the keymap behind it.
  const value = useMemo(() => ({ confirm, pending: Boolean(dialog) }), [confirm, dialog]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          className="overlay open confirm-overlay"
          onClick={(event) => { if (event.target === event.currentTarget) settle(false); }}
          role="presentation"
        >
          <section className={`modal confirm-modal${dialog.danger ? ' danger' : ''}`} role="alertdialog" aria-modal="true" aria-label={dialog.title}>
            <div className="dialog-head">
              <span style={{ color: dialog.danger ? 'var(--red)' : 'var(--cyan)' }}>▚</span>
              {dialog.title}
              <span className="spacer">CONFIRM ACTION</span>
            </div>
            <p className="confirm-body">{dialog.body}</p>
            <div className="confirm-actions">
              <button
                type="button" className={`ghost-btn${focused === 'cancel' ? ' focused' : ''}`}
                onMouseEnter={() => setFocused('cancel')}
                onClick={() => settle(false)}
              >{dialog.cancelLabel}</button>
              <button
                type="button" className={`${dialog.danger ? 'danger-btn' : 'primary-btn'}${focused === 'confirm' ? ' focused' : ''}`}
                onMouseEnter={() => setFocused('confirm')}
                onClick={() => settle(true)}
              >{dialog.confirmLabel}</button>
            </div>
            <div className="confirm-foot">
              <span><Icon name="back" size={9} />[TAB]</span>
              <span>[ENTER] {dialog.confirmLabel}</span>
              <span>[ESC] {dialog.cancelLabel}</span>
            </div>
          </section>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// Stable fallback so a consumer outside the provider still gets both fields with a stable
// identity, and keeps the warning that says why its dialog is a native one.
const NO_PROVIDER = {
  confirm: async () => { console.warn('useConfirm outside provider'); return window.confirm?.('Confirm?') ?? false; },
  pending: false
};

export function useConfirm() {
  return useContext(ConfirmContext) ?? NO_PROVIDER;
}
