import { memo, useEffect, useRef, useState } from 'react';
import { divisionColor, rankIconUrl } from '../lib/format.js';
import { useProfileData } from '../hooks/useProfileData.js';
import { trackerUrl } from '../lib/trackerUrl.js';
import { PanelState } from './LockerPanel.jsx';
import { Icon } from './Icons.jsx';

// Two sources, switchable: Vantage computes stats itself from Riot's match history (no third party);
// tracker.gg is shown as its own page, embedded, because it offers no public API. vtl.lol was dropped:
// it never got past its bot check inside the app. The id stays 'sapphire' so a saved choice survives.
const SOURCES = [
  { id: 'sapphire', label: 'Vantage', hint: 'Riot match history' },
  { id: 'tracker', label: 'Tracker.gg', hint: 'tracker.gg profile' }
];

// {name} and {tag} are filled in URL-encoded. Editable in the panel, because the site changes its
// routes now and then and the app should not need an update for that.
const DEFAULT_TEMPLATE = 'https://tracker.gg/valorant/profile/riot/{name}%23{tag}/overview';
// Cloudflare's interstitial; while it shows, the page needs the user to see (and maybe click) it.
const CHALLENGE_TITLE = /just a moment|attention required|nur einen moment|checking your browser/i;

const QUEUES = [
  { id: 'competitive', label: 'Competitive' },
  { id: 'unrated', label: 'Unrated' },
  { id: 'swiftplay', label: 'Swiftplay' },
  { id: 'all', label: 'All modes' }
];

// Old name kept so saved choices survive the rebrand.
const PREFS_KEY = 'sapphire.stats';
function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function writePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch })); } catch { /* preference only */ }
}

function timeAgo(ms) {
  if (!ms) return '—';
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function Tile({ label, value, sub, accent }) {
  return (
    <div className={`tile${accent ? ` ${accent}` : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

function ShotBody({ shots }) {
  const total = shots.head + shots.body + shots.leg;
  const pct = (part) => (total ? Math.round((part / total) * 100) : 0);
  return (
    <div className="shots">
      <svg viewBox="0 0 40 92" width="40" height="92" aria-hidden="true">
        <circle cx="20" cy="10" r="8" className="sh-head" />
        <rect x="9" y="21" width="22" height="34" rx="6" className="sh-body" />
        <rect x="10" y="57" width="9" height="33" rx="4" className="sh-leg" />
        <rect x="21" y="57" width="9" height="33" rx="4" className="sh-leg" />
      </svg>
      <ul>
        <li><i className="sh-dot head" />Head <b>{pct(shots.head)}%</b></li>
        <li><i className="sh-dot body" />Body <b>{pct(shots.body)}%</b></li>
        <li><i className="sh-dot leg" />Legs <b>{pct(shots.leg)}%</b></li>
      </ul>
    </div>
  );
}

function BreakdownTable({ title, rows }) {
  return (
    <div className="breakdown">
      <h4>{title}</h4>
      {rows.length === 0 ? <p className="muted-note">No games.</p> : (
        <table>
          <thead><tr><th /><th>Games</th><th>Win</th><th>K/D</th><th>ACS</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="bd-name">{row.icon && <img src={row.icon} alt="" />}<span>{row.name}</span></td>
                <td>{row.games}</td>
                <td className={row.winRate >= 50 ? 'pos' : 'neg'}>{row.winRate}%</td>
                <td>{row.kd}</td>
                <td>{row.acs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VantageStats({ account }) {
  const [queue, setQueue] = useState(() => readPrefs().queue ?? 'competitive');
  const options = { queue, count: 10 };
  const { data, loading, error, reload } = useProfileData('stats', account.label, options, account.status === 'ready');
  const profile = account.store?.profile;
  const summary = data?.summary;

  return (
    <>
      <div className="stats-toolbar">
        <div className="chip-row">
          {QUEUES.map((entry) => (
            <button
              key={entry.id} type="button" className={`chip${entry.id === queue ? ' on' : ''}`}
              onClick={() => { setQueue(entry.id); writePrefs({ queue: entry.id }); }}
            >{entry.label}</button>
          ))}
        </div>
        <span className="muted-note">Last {summary?.matches ?? 10} matches</span>
        <button type="button" className="icon-btn" onClick={reload} disabled={loading} title="Reload stats" aria-label="Reload stats"><Icon name="refresh" size={13} /></button>
      </div>
      {!data && <PanelState loading={loading} error={error} onRetry={reload} label="stats" />}
      {data && error && <p className="inline-error"><Icon name="warn" size={12} /> {error}</p>}
      {data && (
        <div className={`stats-body${loading ? ' is-loading' : ''}`}>
          <div className="tiles">
            <div className="tile rank-tile">
              {profile?.rank && rankIconUrl(profile.rank, 'large') && <img src={rankIconUrl(profile.rank, 'large')} alt="" />}
              <div>
                <span className="tile-label">Current rank</span>
                <span className="tile-value" style={{ color: divisionColor(profile?.rank) }}>{profile?.rank ?? 'Unranked'}</span>
                <span className="tile-sub">{data.peakRank ? <>Peak <b style={{ color: divisionColor(data.peakRank) }}>{data.peakRank}</b></> : 'No peak recorded'}</span>
              </div>
            </div>
            <Tile label="Win rate" value={summary.winRate == null ? '—' : `${summary.winRate}%`} sub={`${summary.wins}W · ${summary.losses}L`} accent={summary.winRate >= 50 ? 'pos' : 'neg'} />
            <Tile label="K/D" value={summary.kd} sub={`${summary.kills} / ${summary.deaths} / ${summary.assists}`} />
            <Tile label="Headshot" value={`${summary.hs}%`} sub="of all hits" />
            <Tile label="ACS" value={summary.acs} sub="avg combat score" />
            <Tile label="ADR" value={summary.adr} sub="damage / round" />
            {data.season && <Tile label="This act" value={`${data.season.wins}W ${data.season.losses}L`} sub={`${data.season.games} ranked games`} />}
          </div>

          <div className="stats-split">
            <ShotBody shots={summary.shots} />
            <BreakdownTable title="Agents" rows={summary.agents} />
            <BreakdownTable title="Maps" rows={summary.maps} />
          </div>

          <h4 className="section-h">Match history</h4>
          {data.matches.length === 0
            ? <p className="muted-note pad">No matches in this queue yet.</p>
            : <ul className="matches">
                {data.matches.map((match) => (
                  <li key={match.id} className={`match ${match.draw ? 'draw' : match.won ? 'win' : 'loss'}`}>
                    {match.mapImage && <img className="match-map" src={match.mapImage} alt="" />}
                    <div className="match-agent">
                      {match.agentIcon && <img src={match.agentIcon} alt="" />}
                      <div><b>{match.agent}</b><span>{match.map} · {match.queue}</span></div>
                    </div>
                    <div className="match-score">
                      <b>{match.teamRounds ?? '—'} : {match.enemyRounds ?? '—'}</b>
                      <span>{match.draw ? 'Draw' : match.won ? 'Victory' : 'Defeat'}</span>
                    </div>
                    <div className="match-kda"><b>{match.kills} / {match.deaths} / {match.assists}</b><span>K / D / A</span></div>
                    <div className="match-num"><b>{match.acs}</b><span>ACS</span></div>
                    <div className="match-num"><b>{match.hs}%</b><span>HS</span></div>
                    <div className="match-when">{timeAgo(match.startedAt)}</div>
                  </li>
                ))}
              </ul>}
        </div>
      )}
    </>
  );
}

// The embedded page with a visible state: a spinner while it loads, and after 20 seconds of nothing a
// way out (reload / show anyway / open in browser) instead of a blank box that looks frozen.
function TrackerView({ src, onOpenExternal }) {
  const ref = useRef(null);
  const [phase, setPhase] = useState('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const view = ref.current;
    if (!view) return undefined;
    const slowTimer = setTimeout(() => setPhase((current) => (current === 'loading' ? 'slow' : current)), 20_000);
    let shownTimer;
    // Shown as soon as there is something to see: waiting for did-stop-loading left the box empty for
    // as long as tracker.gg kept streaming ads/analytics, and a bot check never "stops" at all.
    const onStop = () => { clearTimeout(slowTimer); setPhase('ready'); };
    const onTitle = (event) => { if (CHALLENGE_TITLE.test(event.title ?? '')) onStop(); };
    const onFail = (event) => {
      // -3 is an aborted navigation (a redirect or SPA route change), not a failure.
      if (event.errorCode === -3 || event.isMainFrame === false) return;
      clearTimeout(slowTimer);
      setPhase('failed');
    };
    const onDomReady = () => { shownTimer = setTimeout(onStop, 1200); };
    const events = [['did-stop-loading', onStop], ['did-finish-load', onStop], ['did-fail-load', onFail], ['dom-ready', onDomReady], ['page-title-updated', onTitle]];
    for (const [name, handler] of events) view.addEventListener(name, handler);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(shownTimer);
      for (const [name, handler] of events) view.removeEventListener(name, handler);
    };
  }, [src, reloadKey]);

  const reload = () => { setPhase('loading'); setReloadKey((key) => key + 1); };

  return (
    <div className="tracker-wrap">
      <webview key={`${src}:${reloadKey}`} ref={ref} className="tracker-view" src={src} partition="persist:trackers" />
      {phase !== 'ready' && (
        <div className={`tracker-overlay${phase === 'loading' ? ' soft' : ''}`}>
          {phase === 'loading'
            ? <><span className="spinner" /><span>Loading {new URL(src).hostname}…</span></>
            : <>
                <Icon name="warn" size={18} />
                <span>{phase === 'failed' ? 'The page could not be loaded.' : 'This is taking long — the site may be showing a bot check.'}</span>
                <div className="tracker-actions">
                  <button type="button" className="ghost-btn" onClick={reload}><Icon name="refresh" />Reload</button>
                  <button type="button" className="ghost-btn" onClick={() => setPhase('ready')}>Show page anyway</button>
                  <button type="button" className="primary-btn" onClick={onOpenExternal}><Icon name="external" />Open in browser</button>
                </div>
              </>}
        </div>
      )}
    </div>
  );
}

function TrackerStats({ account }) {
  // A blank saved template would leave the tab empty; fall back to the default route.
  const [template, setTemplate] = useState(() => readPrefs().templates?.tracker || DEFAULT_TEMPLATE);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template);

  const riotId = account.store?.accountName ?? account.accountName;
  const url = trackerUrl(template, riotId);
  const embeddable = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
  const openExternal = () => { if (url) window.valorant?.openTracker?.(url); };

  const save = () => {
    const next = draft.trim() || DEFAULT_TEMPLATE;
    setTemplate(next);
    writePrefs({ templates: { tracker: next } });
    setEditing(false);
  };

  return (
    <>
      <div className="stats-toolbar">
        <span className="url-pill" title={url ?? ''}>
          <Icon name="link" size={12} />
          {url ?? 'No Riot ID saved for this account'}
        </span>
        <button type="button" className="ghost-btn" onClick={() => { setDraft(template); setEditing((value) => !value); }}><Icon name="settings" />URL</button>
        <button type="button" className="ghost-btn" disabled={!url} onClick={openExternal}><Icon name="external" />Open in browser</button>
      </div>
      {editing && (
        <div className="template-edit">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Profile URL template" spellCheck={false} />
          <button type="button" className="primary-btn" onClick={save}>Save</button>
          <button type="button" className="ghost-btn" onClick={() => setDraft(DEFAULT_TEMPLATE)}>Default</button>
          <p className="muted-note">Use <code>{'{name}'}</code> and <code>{'{tag}'}</code>.</p>
        </div>
      )}
      {!url
        ? <div className="state-box"><Icon name="warn" size={18} /><div><b>No Riot ID</b><p>Refresh this account once so the app learns its name#tag.</p></div></div>
        : embeddable
          ? <TrackerView src={url} onOpenExternal={openExternal} />
          : <div className="state-box"><Icon name="external" size={18} /><div><b>Embedded view runs in the desktop app</b><p>In this preview, use “Open in browser”.</p></div></div>}
    </>
  );
}
export default memo(function StatsPanel({ account }) {
  const [sourceId, setSourceId] = useState(() => readPrefs().source ?? 'sapphire');
  const source = SOURCES.find((entry) => entry.id === sourceId) ?? SOURCES[0];
  const pick = (id) => { setSourceId(id); writePrefs({ source: id }); };

  if (account.status !== 'ready') {
    return <div className="state-box is-error"><Icon name="warn" size={18} /><div><b>Stats unavailable</b><p>This account has no working saved session.</p></div></div>;
  }

  return (
    <section className="panel stats" aria-label="Account stats">
      <div className="panel-head">
        <div className="seg">
          {SOURCES.map((entry) => (
            <button key={entry.id} type="button" className={`seg-btn${entry.id === source.id ? ' on' : ''}`} onClick={() => pick(entry.id)} title={entry.hint}>
              {entry.label}
            </button>
          ))}
        </div>
        <span className="muted-note">{source.hint}</span>
      </div>
      <div className="panel-body">
        {source.id === 'sapphire' ? <VantageStats account={account} /> : <TrackerStats account={account} />}
      </div>
    </section>
  );
});
