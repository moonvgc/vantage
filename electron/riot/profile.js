import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { COMPETITIVE_TIERS, fetchWithTimeout, getAuthenticatedHeaders } from './store.js';

// Locker (owned items + equipped loadout + wallet) and match stats for one account. Riot supplies the
// ids and numbers; names and art come from valorant-api.com, exactly like the store path.

const ITEM_TYPES = {
  skinLevel: 'e7c63390-eda7-46e0-bb7a-a6abdacd2433',
  chroma: '3ad1b2b2-acdb-4524-852f-954a76ddae0a',
  agent: '01bb38e1-da47-4e6a-9b3d-945fe4655707',
  buddy: 'dd3bf334-87f3-40bd-b043-682a57a8dc3a',
  spray: 'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475',
  card: '3f296c07-64c3-494c-923b-fe692a4fa1bd',
  title: 'de7caa6b-adf7-4588-bbd1-143831e786c6'
};

const CURRENCIES = {
  vp: '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741',
  rp: 'e59aa87c-4cbf-517a-5983-6e81511be9b7',
  kc: '85ca954a-41f2-ce94-9b45-8ca3dd39a00d'
};

const QUEUE_LABELS = {
  competitive: 'Competitive', unrated: 'Unrated', swiftplay: 'Swiftplay', spikerush: 'Spike Rush',
  deathmatch: 'Deathmatch', hurm: 'Team Deathmatch', ggteam: 'Escalation', onefa: 'Replication',
  premier: 'Premier', snowball: 'Snowball Fight', newmap: 'New Map', '': 'Custom'
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getJson(url, headers) {
  const response = await fetchWithTimeout(url, { headers });
  if (response.status === 429) throw new Error('Riot rate limit reached — wait a minute and try again.');
  if (!response.ok) throw new Error(`Riot request failed (${response.status}).`);
  return response.json();
}

// valorant-api content (weapons alone is several MB) only changes with a game patch, so it is kept on
// disk for 12 hours: a launch then reads a file instead of downloading the same lists again. A stale
// copy is still used when the service is unreachable — old art beats no locker.
const DISK_TTL_MS = 12 * 3600_000;
let cacheDirPromise;
function cacheDir() {
  cacheDirPromise ??= import('electron')
    .then(({ app }) => (app?.getPath ? path.join(app.getPath('userData'), 'content-cache') : null))
    .catch(() => null);
  return cacheDirPromise;
}

async function publicJson(url) {
  const dir = await cacheDir();
  const file = dir ? path.join(dir, `${createHash('sha1').update(url).digest('hex')}.json`) : null;
  let stale = null;
  if (file) {
    try {
      const info = await fs.stat(file);
      const cached = JSON.parse(await fs.readFile(file, 'utf8'));
      if (Date.now() - info.mtimeMs < DISK_TTL_MS) return cached;
      stale = cached;
    } catch { /* no usable copy */ }
  }
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Valorant content request failed (${response.status}).`);
    const data = (await response.json()).data ?? [];
    if (file) fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(file, JSON.stringify(data))).catch(() => {});
    return data;
  } catch (error) {
    if (stale) return stale;
    throw error;
  }
}

// ---------- content index (lazy, once per session, never memoises a failure) ----------

let indexPromise;
function getIndex() {
  if (!indexPromise) indexPromise = buildIndex().catch((error) => { indexPromise = undefined; throw error; });
  return indexPromise;
}

async function buildIndex() {
  const optional = (url) => publicJson(url).catch(() => []);
  const [weapons, tiers, agents, maps, cards, buddies, sprays, titles] = await Promise.all([
    publicJson('https://valorant-api.com/v1/weapons'),
    optional('https://valorant-api.com/v1/contenttiers'),
    optional('https://valorant-api.com/v1/agents?isPlayableCharacter=true'),
    optional('https://valorant-api.com/v1/maps'),
    optional('https://valorant-api.com/v1/playercards'),
    optional('https://valorant-api.com/v1/buddies'),
    optional('https://valorant-api.com/v1/sprays'),
    optional('https://valorant-api.com/v1/playertitles')
  ]);
  const tierById = new Map(tiers.map((tier) => [tier.uuid, {
    rank: Number(tier.rank) || 0,
    label: tier.devName ?? tier.displayName ?? '',
    color: `#${String(tier.highlightColor ?? '').slice(0, 6).toUpperCase()}`,
    icon: tier.displayIcon ?? null
  }]));

  const weaponList = [];
  const skins = new Map(); // skin uuid -> record
  const skinByLevel = new Map(); // level uuid -> { skin, levelIndex }
  for (const weapon of weapons) {
    weaponList.push({
      id: weapon.uuid,
      name: weapon.displayName,
      category: String(weapon.category ?? '').replace('EEquippableCategory::', ''),
      icon: weapon.killStreamIcon ?? weapon.displayIcon ?? null,
      defaultSkinId: weapon.defaultSkinUuid ?? null
    });
    for (const skin of weapon.skins ?? []) {
      const record = {
        id: skin.uuid,
        name: skin.displayName,
        weaponId: weapon.uuid,
        weapon: weapon.displayName,
        category: String(weapon.category ?? '').replace('EEquippableCategory::', ''),
        image: skin.levels?.[0]?.displayIcon ?? skin.displayIcon ?? skin.chromas?.[0]?.fullRender ?? null,
        tier: tierById.get(skin.contentTierUuid) ?? null,
        levelCount: skin.levels?.length ?? 1,
        chromaCount: skin.chromas?.length ?? 1,
        isDefault: skin.uuid === weapon.defaultSkinUuid || /^Standard |^Random Favorite/i.test(skin.displayName ?? ''),
        // Same shape SkinPreviewModal reads, so a locker skin opens the existing showcase.
        video: skin.levels?.[0]?.streamedVideo ?? null,
        levels: (skin.levels ?? []).map((level) => ({ name: level.displayName, item: level.levelItem ?? null, video: level.streamedVideo ?? null, icon: level.displayIcon ?? null })),
        chromas: (skin.chromas ?? []).filter((chroma) => chroma.swatch).map((chroma) => ({
          id: chroma.uuid, name: (chroma.displayName ?? '').replace(/\s+/g, ' ').trim(), swatch: chroma.swatch,
          video: chroma.streamedVideo ?? null, render: chroma.fullRender ?? null
        })),
        chromaImages: new Map((skin.chromas ?? []).map((chroma) => [chroma.uuid, chroma.fullRender ?? chroma.displayIcon ?? null]))
      };
      skins.set(skin.uuid, record);
      (skin.levels ?? []).forEach((level, levelIndex) => skinByLevel.set(level.uuid, { skin: record, levelIndex }));
    }
  }

  const byUuid = (list, map) => new Map(list.filter((entry) => entry?.uuid).map((entry) => [entry.uuid, map(entry)]));
  const buddyByLevel = new Map();
  for (const buddy of buddies) {
    const record = { id: buddy.uuid, name: buddy.displayName, image: buddy.displayIcon ?? null };
    buddyByLevel.set(buddy.uuid, record);
    for (const level of buddy.levels ?? []) buddyByLevel.set(level.uuid, record);
  }
  return {
    weapons: weaponList,
    skins,
    skinByLevel,
    agents: byUuid(agents, (agent) => ({
      id: agent.uuid, name: agent.displayName, icon: agent.displayIconSmall ?? agent.displayIcon ?? null,
      portrait: agent.fullPortrait ?? null, role: agent.role?.displayName ?? null, base: Boolean(agent.isBaseContent)
    })),
    maps: new Map(maps.filter((map) => map?.mapUrl).map((map) => [map.mapUrl, { name: map.displayName, image: map.listViewIcon ?? map.splash ?? null, splash: map.splash ?? null }])),
    cards: byUuid(cards, (card) => ({ id: card.uuid, name: card.displayName, image: card.largeArt ?? card.displayIcon ?? null, wide: card.wideArt ?? null, small: card.smallArt ?? card.displayIcon ?? null })),
    buddies: buddyByLevel,
    sprays: byUuid(sprays, (spray) => ({ id: spray.uuid, name: spray.displayName, image: spray.fullTransparentIcon ?? spray.fullIcon ?? spray.displayIcon ?? null })),
    titles: byUuid(titles, (title) => ({ id: title.uuid, name: title.titleText ?? title.displayName ?? null }))
  };
}

// ---------- locker ----------

async function entitlements(base, puuid, headers, typeId) {
  try {
    const payload = await getJson(`${base}/store/v1/entitlements/${puuid}/${typeId}`, headers);
    return (payload?.Entitlements ?? []).map((entry) => entry?.ItemID).filter(Boolean);
  } catch { return []; }
}

export async function fetchLocker(session) {
  const { puuid, shard } = session;
  const headers = await getAuthenticatedHeaders(session);
  const base = `https://pd.${shard}.a.pvp.net`;
  const [index, wallet, loadout, levelIds, agentIds, buddyIds, sprayIds, cardIds, titleIds] = await Promise.all([
    getIndex(),
    getJson(`${base}/store/v1/wallet/${puuid}`, headers).catch(() => null),
    getJson(`${base}/personalization/v2/players/${puuid}/playerloadout`, headers).catch(() => null),
    entitlements(base, puuid, headers, ITEM_TYPES.skinLevel),
    entitlements(base, puuid, headers, ITEM_TYPES.agent),
    entitlements(base, puuid, headers, ITEM_TYPES.buddy),
    entitlements(base, puuid, headers, ITEM_TYPES.spray),
    entitlements(base, puuid, headers, ITEM_TYPES.card),
    entitlements(base, puuid, headers, ITEM_TYPES.title)
  ]);

  // Owning any level of a skin means owning the skin; the highest level owned is its upgrade state.
  const owned = new Map();
  for (const levelId of levelIds) {
    const hit = index.skinByLevel.get(levelId);
    if (!hit || hit.skin.isDefault) continue;
    const current = owned.get(hit.skin.id);
    if (!current || hit.levelIndex > current.levelIndex) owned.set(hit.skin.id, { skin: hit.skin, levelIndex: hit.levelIndex });
  }

  const equippedSkinIds = new Set((loadout?.Guns ?? []).map((gun) => gun.SkinID));
  const skins = [...owned.values()].map(({ skin, levelIndex }) => ({
    id: skin.id, name: skin.name, weapon: skin.weapon, category: skin.category, image: skin.image,
    tier: skin.tier, video: skin.video, levels: skin.levels, chromas: skin.chromas,
    level: levelIndex + 1, levelCount: skin.levelCount, equipped: equippedSkinIds.has(skin.id)
  })).sort((a, b) => (b.tier?.rank ?? -1) - (a.tier?.rank ?? -1) || a.name.localeCompare(b.name));

  const weaponOrder = new Map(index.weapons.map((weapon, position) => [weapon.id, position]));
  const guns = (loadout?.Guns ?? []).map((gun) => {
    const weapon = index.weapons.find((entry) => entry.id === gun.ID);
    const skin = index.skins.get(gun.SkinID);
    const isDefault = !skin || skin.isDefault;
    return {
      weaponId: gun.ID,
      weapon: weapon?.name ?? skin?.weapon ?? 'Weapon',
      category: weapon?.category ?? skin?.category ?? '',
      skin: isDefault ? null : skin.name,
      image: (skin?.chromaImages.get(gun.ChromaID)) ?? skin?.image ?? weapon?.icon ?? null,
      tier: isDefault ? null : skin.tier,
      buddy: gun.CharmID ? index.buddies.get(gun.CharmID)?.image ?? null : null
    };
  }).sort((a, b) => (weaponOrder.get(a.weaponId) ?? 99) - (weaponOrder.get(b.weaponId) ?? 99));

  const identity = loadout?.Identity ?? {};
  const agents = [...index.agents.values()]
    .map((agent) => ({ ...agent, owned: agent.base || agentIds.includes(agent.id) }))
    .sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name));
  const balances = wallet?.Balances ?? {};

  return {
    wallet: {
      vp: Number(balances[CURRENCIES.vp] ?? 0) || 0,
      rp: Number(balances[CURRENCIES.rp] ?? 0) || 0,
      kc: Number(balances[CURRENCIES.kc] ?? 0) || 0,
      available: Boolean(wallet)
    },
    card: index.cards.get(identity.PlayerCardID) ?? null,
    title: index.titles.get(identity.PlayerTitleID)?.name ?? null,
    skins,
    guns,
    agents,
    counts: {
      skins: skins.length,
      agents: agents.filter((agent) => agent.owned).length,
      agentsTotal: agents.length,
      buddies: new Set(buddyIds.map((id) => index.buddies.get(id)?.id).filter(Boolean)).size,
      sprays: sprayIds.length,
      cards: cardIds.length,
      titles: titleIds.length
    },
    fetchedAt: Date.now()
  };
}

// ---------- stats ----------

// Match details never change once played, so they are kept for the session: a second STATS visit
// costs one history request instead of ten detail requests.
const matchCache = new Map();

function peakFromMmr(mmr) {
  let peak = 0;
  for (const season of Object.values(mmr?.QueueSkills?.competitive?.SeasonalInfoBySeasonID ?? {})) {
    for (const tier of Object.keys(season?.WinsByTier ?? {})) peak = Math.max(peak, Number(tier) || 0);
  }
  return peak > 2 ? COMPETITIVE_TIERS[peak] ?? null : null;
}

function seasonFromMmr(mmr) {
  const latest = mmr?.LatestCompetitiveUpdate?.SeasonID;
  const season = mmr?.QueueSkills?.competitive?.SeasonalInfoBySeasonID?.[latest];
  if (!season) return null;
  const games = Number(season.NumberOfGames) || 0;
  const wins = Number(season.NumberOfWinsWithPlacements ?? season.NumberOfWins) || 0;
  return { games, wins, losses: Math.max(0, games - wins) };
}

function summariseMatch(details, puuid, index) {
  const me = details?.players?.find((player) => player.subject === puuid);
  if (!me) return null;
  const info = details.matchInfo ?? {};
  const rounds = Number(me.stats?.roundsPlayed) || details.roundResults?.length || 0;
  let head = 0; let body = 0; let leg = 0; let damage = 0;
  for (const round of details.roundResults ?? []) {
    const mine = round.playerStats?.find((entry) => entry.subject === puuid);
    for (const hit of mine?.damage ?? []) {
      head += Number(hit.headshots) || 0; body += Number(hit.bodyshots) || 0; leg += Number(hit.legshots) || 0;
      damage += Number(hit.damage) || 0;
    }
  }
  const myTeam = details.teams?.find((team) => team.teamId === me.teamId);
  const enemy = details.teams?.find((team) => team.teamId !== me.teamId);
  const agent = index.agents.get(String(me.characterId).toLowerCase());
  const map = index.maps.get(info.mapId);
  const kills = Number(me.stats?.kills) || 0;
  const deaths = Number(me.stats?.deaths) || 0;
  const assists = Number(me.stats?.assists) || 0;
  return {
    id: info.matchId,
    queue: QUEUE_LABELS[info.queueID] ?? info.queueID ?? 'Custom',
    startedAt: Number(info.gameStartMillis) || null,
    lengthMs: Number(info.gameLengthMillis) || null,
    map: map?.name ?? 'Unknown map',
    mapImage: map?.image ?? null,
    agent: agent?.name ?? 'Unknown',
    agentIcon: agent?.icon ?? null,
    kills, deaths, assists,
    score: Number(me.stats?.score) || 0,
    rounds,
    acs: rounds ? Math.round((Number(me.stats?.score) || 0) / rounds) : 0,
    adr: rounds ? Math.round(damage / rounds) : 0,
    damage,
    shots: { head, body, leg },
    hs: head + body + leg ? Math.round((head / (head + body + leg)) * 100) : 0,
    won: myTeam ? Boolean(myTeam.won) : null,
    draw: myTeam && enemy ? !myTeam.won && !enemy.won : false,
    teamRounds: myTeam?.roundsWon ?? null,
    enemyRounds: enemy?.roundsWon ?? null,
    rank: COMPETITIVE_TIERS[Number(me.competitiveTier)] ?? null
  };
}

function aggregate(matches) {
  const sum = (key) => matches.reduce((total, match) => total + (match[key] ?? 0), 0);
  const kills = sum('kills'); const deaths = sum('deaths'); const assists = sum('assists');
  const rounds = sum('rounds');
  const shots = matches.reduce((total, match) => ({
    head: total.head + match.shots.head, body: total.body + match.shots.body, leg: total.leg + match.shots.leg
  }), { head: 0, body: 0, leg: 0 });
  const totalShots = shots.head + shots.body + shots.leg;
  const wins = matches.filter((match) => match.won).length;
  const decided = matches.filter((match) => match.won !== null && !match.draw).length;
  const tally = (key, iconKey) => {
    const groups = new Map();
    for (const match of matches) {
      const entry = groups.get(match[key]) ?? { name: match[key], icon: match[iconKey], games: 0, wins: 0, kills: 0, deaths: 0, score: 0, rounds: 0 };
      entry.games += 1; entry.wins += match.won ? 1 : 0; entry.kills += match.kills; entry.deaths += match.deaths;
      entry.score += match.score; entry.rounds += match.rounds;
      groups.set(match[key], entry);
    }
    return [...groups.values()].map((entry) => ({
      name: entry.name, icon: entry.icon, games: entry.games,
      winRate: Math.round((entry.wins / entry.games) * 100),
      kd: entry.deaths ? +(entry.kills / entry.deaths).toFixed(2) : entry.kills,
      acs: entry.rounds ? Math.round(entry.score / entry.rounds) : 0
    })).sort((a, b) => b.games - a.games);
  };
  return {
    matches: matches.length,
    wins,
    losses: decided - wins,
    winRate: decided ? Math.round((wins / decided) * 100) : null,
    kills, deaths, assists,
    kd: deaths ? +(kills / deaths).toFixed(2) : kills,
    kda: deaths ? +((kills + assists) / deaths).toFixed(2) : kills + assists,
    acs: rounds ? Math.round(sum('score') / rounds) : 0,
    adr: rounds ? Math.round(sum('damage') / rounds) : 0,
    hs: totalShots ? Math.round((shots.head / totalShots) * 100) : 0,
    shots,
    agents: tally('agent', 'agentIcon').slice(0, 5),
    maps: tally('map', 'mapImage').slice(0, 5)
  };
}

export async function fetchStats(session, { queue = 'competitive', count = 10 } = {}) {
  const { puuid, shard } = session;
  const headers = await getAuthenticatedHeaders(session);
  const base = `https://pd.${shard}.a.pvp.net`;
  const limit = Math.min(20, Math.max(1, Number(count) || 10));
  const queueParam = queue && queue !== 'all' ? `&queue=${encodeURIComponent(queue)}` : '';
  const [index, history, mmr] = await Promise.all([
    getIndex(),
    getJson(`${base}/match-history/v1/history/${puuid}?startIndex=0&endIndex=${limit}${queueParam}`, headers),
    getJson(`${base}/mmr/v1/players/${puuid}`, headers).catch(() => null)
  ]);

  // Sequential with a small gap: ten parallel detail requests is exactly the burst Riot answers with 429.
  const matches = [];
  for (const entry of (history?.History ?? []).slice(0, limit)) {
    let details = matchCache.get(entry.MatchID);
    if (!details) {
      try {
        details = await getJson(`${base}/match-details/v1/matches/${entry.MatchID}`, headers);
        matchCache.set(entry.MatchID, details);
        await sleep(120);
      } catch (error) {
        if (/rate limit/i.test(error.message) && matches.length) break;
        if (/rate limit/i.test(error.message)) throw error;
        continue;
      }
    }
    const summary = summariseMatch(details, puuid, index);
    if (summary) matches.push(summary);
  }

  return {
    queue,
    peakRank: peakFromMmr(mmr),
    season: seasonFromMmr(mmr),
    summary: aggregate(matches),
    matches,
    fetchedAt: Date.now()
  };
}
