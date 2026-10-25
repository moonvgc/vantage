// Dev-only locker + stats for the browser preview (imported by devMock.js only). Art is pulled from the
// public content service (CORS-open) so the grids can be judged with real images; ownership, wallet and
// match numbers are random but stable per label.

const TIER_LIST = [
  { rank: 0, label: 'Select', color: '#5A9FE2' },
  { rank: 1, label: 'Deluxe', color: '#009587' },
  { rank: 2, label: 'Premium', color: '#D1548D' },
  { rank: 3, label: 'Exclusive', color: '#F5955B' },
  { rank: 4, label: 'Ultra', color: '#FAD663' }
];

const memo = {};
function content(path, filter = (list) => list) {
  memo[path] ??= fetch(`https://valorant-api.com/v1/${path}`)
    .then((response) => response.json())
    .then((payload) => filter(payload.data ?? []))
    .catch(() => []);
  return memo[path];
}

function seeded(label) {
  let state = [...String(label)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  // mulberry32: a plain LCG's low bits repeat badly enough to make ten matches all wins.
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mockLocker(label) {
  const random = seeded(label);
  const [weapons, agents] = await Promise.all([content('weapons'), content('agents?isPlayableCharacter=true')]);
  const skins = [];
  const guns = [];
  for (const weapon of weapons) {
    const category = String(weapon.category ?? '').replace('EEquippableCategory::', '');
    const candidates = (weapon.skins ?? []).filter((skin) => !/^Standard |^Random Favorite/.test(skin.displayName) && skin.uuid !== weapon.defaultSkinUuid);
    const mine = candidates.filter(() => random() < 0.12);
    mine.forEach((skin, position) => {
      skins.push({
        id: skin.uuid, name: skin.displayName, weapon: weapon.displayName, category,
        image: skin.levels?.[0]?.displayIcon ?? skin.displayIcon ?? null,
        tier: TIER_LIST[Math.floor(random() * 5)],
        video: skin.levels?.[0]?.streamedVideo ?? null,
        levels: (skin.levels ?? []).map((level) => ({ name: level.displayName, item: level.levelItem ?? null, video: level.streamedVideo ?? null, icon: level.displayIcon ?? null })),
        chromas: (skin.chromas ?? []).filter((chroma) => chroma.swatch).map((chroma) => ({ id: chroma.uuid, name: chroma.displayName, swatch: chroma.swatch, video: chroma.streamedVideo ?? null, render: chroma.fullRender ?? null })),
        level: 1 + Math.floor(random() * Math.max(1, skin.levels?.length ?? 1)), levelCount: skin.levels?.length ?? 1,
        equipped: position === 0
      });
    });
    const equipped = mine[0];
    guns.push({
      weaponId: weapon.uuid, weapon: weapon.displayName, category,
      skin: equipped?.displayName ?? null,
      image: equipped ? (equipped.levels?.[0]?.displayIcon ?? equipped.displayIcon) : (weapon.killStreamIcon ?? weapon.displayIcon),
      tier: equipped ? skins.find((skin) => skin.id === equipped.uuid)?.tier ?? null : null,
      buddy: null
    });
  }
  skins.sort((a, b) => b.tier.rank - a.tier.rank || a.name.localeCompare(b.name));
  const agentList = agents.map((agent) => ({
    id: agent.uuid, name: agent.displayName, icon: agent.displayIconSmall ?? agent.displayIcon, portrait: agent.fullPortrait,
    role: agent.role?.displayName ?? null, base: agent.isBaseContent, owned: agent.isBaseContent || random() < 0.6
  })).sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name));
  return {
    wallet: { vp: Math.floor(random() * 6000), rp: Math.floor(random() * 60), kc: Math.floor(random() * 10000), available: true },
    card: { id: 'mock-card', name: 'Mock Card', image: null, wide: 'https://media.valorant-api.com/playercards/9fb348bc-41a0-91ad-8a3e-818035c4e561/wideart.png', small: null },
    title: 'Vantage Tester',
    skins, guns, agents: agentList,
    counts: { skins: skins.length, agents: agentList.filter((agent) => agent.owned).length, agentsTotal: agentList.length, buddies: 14, sprays: 37, cards: 52, titles: 21 },
    fetchedAt: Date.now()
  };
}

export async function mockStats(label, options = {}) {
  const random = seeded(`${label}:${options.queue ?? 'competitive'}`);
  const [agents, maps] = await Promise.all([
    content('agents?isPlayableCharacter=true'),
    content('maps', (list) => list.filter((map) => map.tacticalDescription))
  ]);
  const queues = ['Competitive', 'Unrated', 'Swiftplay'];
  const matches = Array.from({ length: options.count ?? 10 }, (_, index) => {
    const agent = agents[Math.floor(random() * Math.min(8, agents.length || 1))];
    const map = maps[Math.floor(random() * (maps.length || 1))];
    const rounds = 18 + Math.floor(random() * 8);
    const kills = 8 + Math.floor(random() * 22);
    const deaths = 9 + Math.floor(random() * 14);
    const assists = Math.floor(random() * 10);
    const head = 5 + Math.floor(random() * 20);
    const body = 20 + Math.floor(random() * 40);
    const leg = Math.floor(random() * 6);
    const won = random() > 0.45;
    const score = Math.round(rounds * (140 + random() * 160));
    return {
      id: `mock-match-${index}`, queue: options.queue === 'all' ? queues[index % 3] : queues[0],
      startedAt: Date.now() - index * 5_400_000 - 3_600_000, lengthMs: 2_100_000 + Math.floor(random() * 900_000),
      map: map?.displayName ?? 'Ascent', mapImage: map?.listViewIcon ?? null,
      agent: agent?.displayName ?? 'Jett', agentIcon: agent?.displayIconSmall ?? null,
      kills, deaths, assists, score, rounds, acs: Math.round(score / rounds), adr: 100 + Math.floor(random() * 90), damage: 0,
      shots: { head, body, leg }, hs: Math.round((head / (head + body + leg)) * 100),
      won, draw: false, teamRounds: won ? 13 : rounds - 13, enemyRounds: won ? rounds - 13 : 13, rank: 'Ascendant 2'
    };
  });
  const sum = (key) => matches.reduce((total, match) => total + match[key], 0);
  const tally = (key, icon) => {
    const groups = new Map();
    for (const match of matches) {
      const entry = groups.get(match[key]) ?? { name: match[key], icon: match[icon], games: 0, wins: 0, kills: 0, deaths: 0, score: 0, rounds: 0 };
      entry.games += 1; entry.wins += match.won ? 1 : 0; entry.kills += match.kills; entry.deaths += match.deaths;
      entry.score += match.score; entry.rounds += match.rounds;
      groups.set(match[key], entry);
    }
    return [...groups.values()].map((entry) => ({
      name: entry.name, icon: entry.icon, games: entry.games, winRate: Math.round((entry.wins / entry.games) * 100),
      kd: +(entry.kills / entry.deaths).toFixed(2), acs: Math.round(entry.score / entry.rounds)
    })).sort((a, b) => b.games - a.games).slice(0, 5);
  };
  const shots = matches.reduce((total, match) => ({ head: total.head + match.shots.head, body: total.body + match.shots.body, leg: total.leg + match.shots.leg }), { head: 0, body: 0, leg: 0 });
  const wins = matches.filter((match) => match.won).length;
  await sleep(500);
  return {
    queue: options.queue ?? 'competitive', peakRank: 'Immortal 1', season: { games: 64, wins: 35, losses: 29 },
    summary: {
      matches: matches.length, wins, losses: matches.length - wins, winRate: Math.round((wins / matches.length) * 100),
      kills: sum('kills'), deaths: sum('deaths'), assists: sum('assists'),
      kd: +(sum('kills') / sum('deaths')).toFixed(2), kda: +((sum('kills') + sum('assists')) / sum('deaths')).toFixed(2),
      acs: Math.round(sum('score') / sum('rounds')), adr: Math.round(sum('adr') / matches.length),
      hs: Math.round((shots.head / (shots.head + shots.body + shots.leg)) * 100), shots,
      agents: tally('agent', 'agentIcon'), maps: tally('map', 'mapImage')
    },
    matches, fetchedAt: Date.now()
  };
}
