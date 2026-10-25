import { memo, useState } from 'react';
import { divisionColor, rankIconUrl, relativeTime } from '../lib/format.js';
import { SORT_LABELS } from '../lib/accountOrder.js';
import { canPlay, playTitle } from '../lib/playGate.js';
import { loginStateInfo } from '../lib/loginState.js';
import { Icon } from './Icons.jsx';

function AccountRow({ account, selected, onSelect, onOpenMarket, onSwitch, onPlay, onDelete, onRename, switching, playing, anySwitching, playGame }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const store = account.status === 'ready' ? account.store : null;
  const profile = store?.profile;
  const rank = profile?.rank ?? null;
  const color = divisionColor(rank);
  const iconUrl = rank ? rankIconUrl(rank) : null;
  const login = loginStateInfo(account.loginState);
  const sel = (fn) => (event) => { event.stopPropagation(); if (!anySwitching) fn(); };
  const beginRename = () => { setDraft(account.label); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== account.label) onRename(account.label, next);
  };
  const onEditKey = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false); }
  };
  return (
    <li
      className={`acct${selected ? ' sel' : ''}${switching || playing ? ' busy' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => { if (!anySwitching && account.status === 'ready') onOpenMarket(account.label); }}
      role="button" tabIndex={0} aria-pressed={selected}
    >
      <div className="acct-l1">
        <span className="acct-av" style={rank ? { borderColor: `${color}55`, color } : undefined}>{account.label.slice(0, 1).toUpperCase()}</span>
        {editing
          ? <input
              className="acct-rename"
              value={draft}
              autoFocus
              maxLength={64}
              disabled={anySwitching}
              onChange={(event) => setDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={onEditKey}
              onBlur={commit}
              aria-label="New account label"
            />
          : <span className="acct-name" title={account.store?.accountName ?? account.accountName ?? account.label}>{account.label}</span>}
        {login && login.tone !== 'good' && <span className={`login-chip ${login.tone}`} title={login.hint}>{login.short}</span>}
        <span className="acct-lv">LV.{profile?.level ?? '—'}</span>
        <span className={`dot ${account.active ? 'on' : account.status === 'error' ? 'err' : 'off'}`} />
      </div>
      <div className="acct-l2">
        {iconUrl
          ? <img className="acct-rankic" src={iconUrl} alt="" width="14" height="14" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          : <span className="acct-rankic acct-rankic-empty" />}
        <span className="acct-rank" style={rank ? { color } : undefined}>{rank ?? 'UNRANKED'}</span>
        {/* PLAY takes this row's RR slot because RR is the one value the details panel already
            carries three times over. It stays visible on every row and is MUTED only when the
            entry itself is unusable — see playGate for why the earlier rule was wrong. */}
        <button
          type="button" className={`acct-play${playGame === 'lol' ? ' lol' : ''}`}
          disabled={!canPlay(account) || anySwitching}
          onClick={sel(() => onPlay(account.label))}
          title={playTitle(account, playGame)}
        >
          <Icon name="play" size={12} />
          {/* The press switches first when this account does not own the session, which takes far
              longer than a launch — saying which is happening is the difference between slow and broken. */}
          {playing ? (account.active ? 'PLAYING…' : 'SWITCHING…') : 'PLAY'}
        </button>
      </div>
      <div className="acct-actions">
        <button type="button" onClick={sel(onSwitch)} disabled={anySwitching} title="Switch Riot session to this account">
          {switching ? 'SWITCHING…' : 'SWITCH'}
        </button>
        <button type="button" onClick={sel(beginRename)} disabled={anySwitching} title="Rename this account">RENAME</button>
        <button type="button" onClick={sel(onDelete)} disabled={anySwitching} title="Delete saved account">DEL</button>
      </div>
    </li>
  );
}

function SyncNote({ accounts }) {
  return (
    <div className="sync-panel">
      <p className="snap-note">LAST SYNC {accounts[0]?.lastCheckedAt ? relativeTime(accounts[0].lastCheckedAt).toUpperCase() : '—'}</p>
    </div>
  );
}

const GAMES = [
  { id: 'valorant', short: 'Valorant', name: 'Valorant', icon: 'valorant' },
  { id: 'lol', short: 'League', name: 'League of Legends', icon: 'league' }
];

// Commands mirror the non-duplicated keymap: switching happens per-row via the account card
// buttons, so there is no Switch entry.
const COMMANDS = [
  { key: 'R', icon: 'refresh', label: 'Refresh Account', busyGated: true },
  { key: 'CTRL+R', icon: 'refreshall', label: 'Refresh All', busyGated: true },
  { key: 'O', icon: 'sort', label: 'Sort Accounts' },
  // Not busyGated: reading the bundle changes no account, just like the Night Market door.
  { key: 'B', icon: 'box', label: 'Featured Bundle' },
  { key: 'X', icon: 'trash', label: 'Delete Account', busyGated: true }
];

function CommandPanel({ commandFlash, tcnoAvailable, busy, onCommand, onOpenAdd }) {
  const commands = [...COMMANDS, ...(tcnoAvailable ? [{ key: 'I', icon: 'import', label: 'Import From TCNO' }] : [])];
  return (
    <nav className="cmd-panel" aria-label="Keyboard commands">
      <div className="panel-label"><span>COMMANDS</span></div>
      <ul className="cmd-list">
        {commands.map((command) => {
          const disabled = busy && command.busyGated;
          return (
            <li
              key={command.key}
              className={`${commandFlash === command.key ? 'flash' : ''}${disabled ? ' disabled' : ''}`}
              onClick={() => { if (!disabled) onCommand(command.key); }}
              onKeyDown={(event) => { if (event.key === 'Enter' && !disabled) onCommand(command.key); }}
              role="button" tabIndex={0}
            >
              <Icon name={command.icon} />
              <span>{command.label}</span>
              <kbd>{command.key}</kbd>
            </li>
          );
        })}
        <li className="cmd-add" onClick={onOpenAdd} onKeyDown={(event) => { if (event.key === 'Enter') onOpenAdd(); }} role="button" tabIndex={0}>
          <Icon name="plus" />
          <span>Add Account</span>
          <kbd>A</kbd>
        </li>
      </ul>
    </nav>
  );
}

export default memo(function Sidebar({
  accounts, visible, totalCount, selectedIndex, onSelect, onOpenMarket,
  filter, onFilter, sortMode, onCycleSort,
  tcnoAvailable, busy, commandFlash, switchingLabel, playingLabel,
  onSwitch, onPlay, onRefresh, onRefreshAll, onDelete, onRename, onImport, onAdd, onOpenBundle,
  playGame, onPlayGame
}) {
  const readyCount = accounts.filter((account) => account.status === 'ready').length;
  // Command rows act on the selected account; row buttons act on their own row.
  const runCommand = (key) => {
    if (key === 'R') onRefresh();
    else if (key === 'CTRL+R') onRefreshAll();
    else if (key === 'X') onDelete();
    else if (key === 'I') onImport();
    else if (key === 'B') onOpenBundle();
    else if (key === 'O') onCycleSort();
  };
  return (
    <aside className="sidebar">
      <div className="side-head">
        <span className="side-title">ACCOUNTS ({visible.length})</span>
        <span className="side-count">{readyCount}/{totalCount} READY</span>
      </div>
      {/* Which game every PLAY button starts. Valorant first — it is what this app is for. */}
      <div className="game-switch" role="radiogroup" aria-label="Game to launch">
        {GAMES.map((game) => (
          <button
            key={game.id} type="button" role="radio" aria-checked={playGame === game.id}
            className={`game-opt ${game.id}${playGame === game.id ? ' on' : ''}`}
            onClick={() => onPlayGame(game.id)}
            title={`PLAY launches ${game.name}`}
          >
            <Icon name={game.icon} size={14} />{game.short}
          </button>
        ))}
      </div>
      <div className="side-filter">
        <Icon name="search" size={12} />
        <input value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="filter…" aria-label="Filter accounts" />
        <button
          type="button" className={`sort-btn${sortMode !== 'active' ? ' on' : ''}`} onClick={onCycleSort}
          title={`Sort: ${SORT_LABELS[sortMode]} — click or press [O] to cycle`}
          aria-label={`Sort accounts, currently ${SORT_LABELS[sortMode]}`}
        >
          <Icon name="sort" size={11} />
          <span>{SORT_LABELS[sortMode]}</span>
        </button>
      </div>
      <ul className="acct-list">
        {visible.map((account, index) => (
          <AccountRow
            key={account.id} account={account}
            selected={index === selectedIndex}
            onSelect={() => onSelect(account.label)}
            onOpenMarket={onOpenMarket}
            onSwitch={() => onSwitch(account.label)}
            onPlay={() => onPlay(account.label)}
            onDelete={() => onDelete(account.label)}
            onRename={onRename}
            switching={switchingLabel === account.label}
            playing={playingLabel === account.label}
            anySwitching={busy}
            playGame={playGame}
          />
        ))}
      </ul>
      <SyncNote accounts={accounts} />
      <CommandPanel
        commandFlash={commandFlash} tcnoAvailable={tcnoAvailable} busy={busy}
        onCommand={runCommand} onOpenAdd={onAdd}
      />
    </aside>
  );
});
