import { memo, useMemo, useState } from 'react';
import { tierRgb } from '../lib/tierColor.js';
import { Icon } from './Icons.jsx';

const VIEWS = [
  { id: 'loadout', label: 'Loadout' },
  { id: 'skins', label: 'Skins' },
  { id: 'agents', label: 'Agents' }
];

const CATEGORIES = ['All', 'Rifle', 'SMG', 'Sidearm', 'Sniper', 'Shotgun', 'Heavy', 'Melee'];
const CATEGORY_KEYS = { Rifle: 'Rifle', SMG: 'SMG', Sidearm: 'Sidearm', Sniper: 'Sniper', Shotgun: 'Shotgun', Heavy: 'Heavy', Melee: 'Melee' };

export function PanelState({ loading, error, onRetry, label }) {
  if (error) {
    return (
      <div className="state-box is-error">
        <Icon name="warn" size={18} />
        <div>
          <b>Could not load {label}</b>
          <p>{error}</p>
        </div>
        <button type="button" className="ghost-btn" onClick={onRetry}><Icon name="refresh" />Retry</button>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="state-box">
        <span className="spinner" aria-hidden="true" />
        <div><b>Loading {label}…</b><p>Asking Riot for this account&apos;s data.</p></div>
      </div>
    );
  }
  return null;
}

function tierStyle(tier) {
  const rgb = tierRgb(tier?.color);
  return rgb ? { '--tier': tier.color, '--tier-rgb': rgb } : undefined;
}

function LoadoutGrid({ guns }) {
  return (
    <div className="loadout-grid">
      {guns.map((gun) => (
        <article key={gun.weaponId} className={`gun-card${gun.tier ? ' tiered' : ''}${gun.category === 'Melee' ? ' melee' : ''}`} style={tierStyle(gun.tier)}>
          <div className="gun-img">
            {gun.image
              ? <img src={gun.image} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              : <span className="muted-note">No image</span>}
          </div>
          <div className="gun-meta">
            <span className="gun-weapon">{gun.weapon}</span>
            <span className="gun-skin" title={gun.skin ?? 'Standard'}>{gun.skin ?? 'Standard'}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function SkinGrid({ skins, onPreview }) {
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skins.filter((skin) => (category === 'All' || skin.category === CATEGORY_KEYS[category])
      && (!needle || skin.name.toLowerCase().includes(needle)));
  }, [skins, category, query]);

  return (
    <>
      <div className="filter-bar">
        <div className="chip-row">
          {CATEGORIES.map((entry) => (
            <button key={entry} type="button" className={`chip${entry === category ? ' on' : ''}`} onClick={() => setCategory(entry)}>{entry}</button>
          ))}
        </div>
        <label className="search-field">
          <Icon name="search" size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skins…" aria-label="Search skins" />
        </label>
      </div>
      {visible.length === 0
        ? <p className="muted-note pad">No skins match.</p>
        : <div className="skin-grid">
            {visible.map((skin) => {
              const previewable = Boolean(skin.video) || (skin.levels?.length ?? 0) > 1;
              return (
                <article key={skin.id} className={`skin-card${skin.tier ? ' tiered' : ''}`} style={tierStyle(skin.tier)}>
                  {skin.equipped && <span className="badge equipped">Equipped</span>}
                  <div className="skin-img">
                    {skin.image
                      ? <img src={skin.image} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      : <span className="muted-note">No image</span>}
                  </div>
                  <div className="skin-meta">
                    <span className="skin-name" title={skin.name}>{skin.name}</span>
                    <div className="skin-row">
                      <span className="skin-weapon">{skin.weapon}</span>
                      {skin.levelCount > 1 && <span className="skin-lvl">Lv {skin.level}/{skin.levelCount}</span>}
                    </div>
                  </div>
                  {previewable && (
                    <button type="button" className="icon-btn skin-pv" onClick={() => onPreview(skin)} title="Open showcase" aria-label={`Preview ${skin.name}`}>
                      <Icon name="eye" size={13} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>}
    </>
  );
}

function AgentGrid({ agents }) {
  return (
    <div className="agent-grid">
      {agents.map((agent) => (
        <article key={agent.id} className={`agent-card${agent.owned ? '' : ' locked'}`} title={agent.owned ? agent.name : `${agent.name} — not unlocked`}>
          {agent.icon && <img src={agent.icon} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
          <span className="agent-name">{agent.name}</span>
          <span className="agent-role">{agent.owned ? agent.role ?? '' : 'Locked'}</span>
        </article>
      ))}
    </div>
  );
}

export function WalletChips({ wallet }) {
  if (!wallet?.available) return null;
  return (
    <div className="wallet">
      <span className="coin vp" title="Valorant Points"><i>VP</i>{wallet.vp.toLocaleString('en-US')}</span>
      <span className="coin rp" title="Radianite Points"><i>RP</i>{wallet.rp.toLocaleString('en-US')}</span>
      <span className="coin kc" title="Kingdom Credits"><i>KC</i>{wallet.kc.toLocaleString('en-US')}</span>
    </div>
  );
}

// The locker request is owned by App (the hero banner and wallet read it too), so it arrives as a prop.
export default memo(function LockerPanel({ account, locker, onPreview }) {
  const [view, setView] = useState('loadout');
  const { data, loading, error, reload } = locker;

  if (account.status !== 'ready') {
    return <div className="state-box is-error"><Icon name="warn" size={18} /><div><b>Locker unavailable</b><p>This account has no working saved session.</p></div></div>;
  }

  const counts = data?.counts;
  return (
    <section className="panel locker" aria-label="Locker">
      <div className="panel-head">
        <div className="seg">
          {VIEWS.map((entry) => (
            <button key={entry.id} type="button" className={`seg-btn${view === entry.id ? ' on' : ''}`} onClick={() => setView(entry.id)}>
              {entry.label}
              {entry.id === 'skins' && counts && <em>{counts.skins}</em>}
              {entry.id === 'agents' && counts && <em>{counts.agents}/{counts.agentsTotal}</em>}
            </button>
          ))}
        </div>
        {counts && (
          <div className="count-row">
            <span><b>{counts.buddies}</b> Buddies</span>
            <span><b>{counts.sprays}</b> Sprays</span>
            <span><b>{counts.cards}</b> Cards</span>
            <span><b>{counts.titles}</b> Titles</span>
          </div>
        )}
        <button type="button" className="icon-btn" onClick={reload} disabled={loading} title="Reload locker" aria-label="Reload locker">
          <Icon name="refresh" size={13} />
        </button>
      </div>
      {!data && <PanelState loading={loading} error={error} onRetry={reload} label="locker" />}
      {data && error && <p className="inline-error"><Icon name="warn" size={12} /> {error}</p>}
      {data && (
        <div className="panel-body">
          {view === 'loadout' && <LoadoutGrid guns={data.guns} />}
          {view === 'skins' && <SkinGrid skins={data.skins} onPreview={onPreview} />}
          {view === 'agents' && <AgentGrid agents={data.agents} />}
        </div>
      )}
    </section>
  );
});
