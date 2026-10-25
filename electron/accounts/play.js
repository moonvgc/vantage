// Pure decisions behind the PLAY control: which request starts the game, which patchline
// this machine has installed, and whether a press should launch or refuse. The HTTP call
// lives in riotClient.js so this module stays loadable in plain node.

const FALLBACK_PATCHLINE = 'live';
const PRODUCT = 'valorant';

// The games PLAY can start. Valorant is the default and the reason this app exists; League shares the
// Riot account, so the same switch-then-launch flow works for it. `installDir` is the product folder
// name inside RiotClientInstalls.json, `processes` the executables that mean "the game is open".
export const GAMES = {
  valorant: { id: 'valorant', label: 'Valorant', product: 'valorant', installDir: 'valorant', processes: ['VALORANT.exe', 'VALORANT-Win64-Shipping.exe'] },
  lol: { id: 'lol', label: 'League of Legends', product: 'league_of_legends', installDir: 'league of legends', processes: ['League of Legends.exe', 'LeagueClient.exe', 'LeagueClientUx.exe'] }
};

export function resolveGame(id) {
  return GAMES[id] ?? GAMES.valorant;
}

// A patchline ends up as a launcher flag value, and it comes from a file on disk: an
// unclamped one could append flags of its own choosing to the launcher's command line.
function safePatchline(value) {
  const cleaned = String(value ?? '').replace(/[^a-z0-9]/gi, '');
  return cleaned || FALLBACK_PATCHLINE;
}

// RiotClientInstalls.json maps every installed product directory to the client that owns it,
// and that directory's last segment IS the patchline ("E:/Riot Games/VALORANT/live/" -> "live")
// — read it rather than assuming 'live', because a PBE install sits beside it under a different
// patchline. Match a whole path SEGMENT, not a substring: "VALORANT-BACKUP" is not the product
// directory, and reading it as one would hand the launcher an invented patchline.
export function gamePatchline(installs, installDir = PRODUCT) {
  for (const directory of Object.keys(installs?.associated_client ?? {})) {
    const segments = String(directory).split(/[\\/]+/).filter(Boolean);
    const index = segments.findIndex((segment) => segment.toLowerCase() === installDir);
    if (index !== -1) return safePatchline(segments[index + 1]);
  }
  return FALLBACK_PATCHLINE;
}

export function valorantPatchline(installs) {
  return gamePatchline(installs, PRODUCT);
}

// The request Riot Client's own Play button makes: a POST to the product-launcher plugin for
// one product + patchline. Handing the launcher `--launch-product/--launch-patchline` is NOT
// equivalent — that is an "app command" gated behind Riot's direct-launch opt-in (disabled on
// this build), and the attempt loses a process-singleton race and never starts the game.
export function launchRequestPath({ product = PRODUCT, patchline = FALLBACK_PATCHLINE } = {}) {
  return `/product-launcher/v1/products/${encodeURIComponent(product)}/patchlines/${safePatchline(patchline)}`;
}

// What a PLAY press means for one account. Riot Client only acts on a launch request while it
// is signed in — handed one while parked, it restores the session instead and drops the launch
// — so PLAY switches first: one press, switch then launch, and the user never sees the client.
export function planPlay({ isActive, valorantRunning }) {
  if (isActive) return valorantRunning ? 'already-running' : 'launch';
  // Switching closes every Riot process on the way through, the game included — fine when
  // nothing is open, a killed match when something is. A mis-click on another row must not end
  // a game in progress; refuse and say so instead of deciding for the user.
  if (valorantRunning) return 'close-game-first';
  return 'switch-then-launch';
}

// Delays before each launch request, in ms, first attempt included. More than one because the
// client can accept a request and then swallow it while its own lifecycle is still running
// (region election, EULA, client config, Vanguard check) right after a switch. Ascending so a
// client that is still busy is not hammered.
export const LAUNCH_RETRY_DELAYS = [0, 2_000, 5_000, 9_000];

// How long to wait for the game process to appear after one accepted request: a launch that
// works produces VALORANT.exe in about three seconds.
export const LAUNCH_APPEAR_TIMEOUT = 6_000;
