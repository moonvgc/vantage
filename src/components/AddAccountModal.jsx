import { useState } from 'react';
import { Icon } from './Icons.jsx';

export default function AddAccountModal({ tcno, onCapture, onManualAdd, onImport, onClose }) {
  const [label, setLabel] = useState('');
  const [savingMode, setSavingMode] = useState(null);
  const [error, setError] = useState(null);
  const saving = savingMode !== null;
  const submit = async (event) => {
    event?.preventDefault?.();
    if (!label.trim()) { setError('Enter a label first.'); return; }
    setSavingMode('current'); setError(null);
    try { await onCapture(label); onClose(); } catch (requestError) { setError(requestError.message); } finally { setSavingMode(null); }
  };
  const addManually = async () => {
    if (!label.trim()) { setError('Enter a label before adding an account manually.'); return; }
    setSavingMode('manual'); setError(null);
    try { await onManualAdd(label); onClose(); } catch (requestError) { setError(requestError.message); } finally { setSavingMode(null); }
  };
  const importAccounts = async () => {
    setSavingMode('import'); setError(null);
    try { await onImport(tcno.accounts.map((account) => account.id)); onClose(); } catch (requestError) { setError(requestError.message); } finally { setSavingMode(null); }
  };
  return (
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <div className="dialog-head">
        <span style={{ color: 'var(--red)' }}>▚</span>ADD ACCOUNT<span className="spacer">ESC TO CANCEL</span>
        <button type="button" className="ghost-btn" onClick={onClose} disabled={saving} aria-label="Close"><Icon name="close" /></button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); addManually(); }} className="acct-form">
        <label htmlFor="account-label">LABEL</label>
        <input id="account-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. MAIN" maxLength="64" autoFocus disabled={saving} required />
        {/* The order matters: signing in through the app keeps every other saved login alive, while
            "Sign out" in the Riot Client deletes the signed-in account's saved login at Riot. */}
        <div className="add-account-actions">
          <button type="submit" className="primary-btn" disabled={saving}><Icon name="plus" />{savingMode === 'manual' ? 'WAITING FOR SIGN-IN…' : 'SIGN IN NEW ACCOUNT'}</button>
          <button type="button" className="ghost-btn" onClick={submit} disabled={saving}><Icon name="import" />{savingMode === 'current' ? 'SAVING…' : 'SAVE ACCOUNT SIGNED IN NOW'}</button>
        </div>
        <p className="form-note dim">
          <b>Sign in new account</b> closes the Riot Client without signing out, then opens its sign-in screen.
          Sign in with <b>“Stay signed in”</b> ticked — it saves automatically, and your other saved accounts stay valid.
        </p>
        <div className="sign-out-warning">
          <Icon name="warn" size={14} />
          <span>Never press <b>Sign out</b> in the Riot Client to change accounts: Riot then deletes that account’s saved login on its servers and it has to be signed in again. Always switch with Vantage.</span>
        </div>
      </form>
      {tcno.available && tcno.accounts.length > 0 && (
        <section className="tcno-import">
          <div className="panel-label"><span>TCNO ACCOUNT SWITCHER</span></div>
          <p className="form-note">{tcno.accounts.length} saved account{tcno.accounts.length === 1 ? '' : 's'} detected.</p>
          <button type="button" className="ghost-btn" onClick={importAccounts} disabled={saving}><Icon name="import" />IMPORT DETECTED ACCOUNTS</button>
        </section>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
