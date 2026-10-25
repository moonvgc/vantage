import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { promisify } from 'node:util';
import { readLockfile } from '../riot/lockfile.js';
import { GAMES, gamePatchline, launchRequestPath, LAUNCH_APPEAR_TIMEOUT, LAUNCH_RETRY_DELAYS, resolveGame } from './play.js';
import { clientCandidates, conventionalClientPath, protocolExecutable, registryCommand, uniqueClients } from './riotClientPath.js';

const exec = promisify(execFile);

// Riot Client serves its own API over 127.0.0.1 with a self-signed certificate.
const localAgent = new https.Agent({ rejectUnauthorized: false });

// RiotClientInstalls.json maps installed products to the client that owns them. It is the only
// place that says which patchline Valorant was installed under (a PBE install has its own entry),
// and one of the two records naming the client's own location.
function installsPath() {
  const programData = process.env.ProgramData ?? path.join(process.env.SystemDrive ?? 'C:', 'ProgramData');
  return path.join(programData, 'Riot Games', 'RiotClientInstalls.json');
}

async function readInstalls() {
  try { return JSON.parse(await fs.readFile(installsPath(), 'utf8')); }
  catch { return null; }
}

async function resolvePatchline(game = GAMES.valorant) {
  return gamePatchline(await readInstalls(), game.installDir);
}

// Windows' own record of where the client lives: the handler for the `riotclient://` protocol.
// Read on top of the install map because that map can be missing or stale — on a machine that
// has not run an update since the client was moved, this is the only place that still knows.
async function registeredClientPath() {
  try {
    const { stdout } = await exec('reg', ['query', 'HKEY_CLASSES_ROOT\\riotclient\\shell\\open\\command', '/ve']);
    return protocolExecutable(registryCommand(stdout));
  } catch { return null; }
}

// Every place this machine might have put RiotClientServices.exe, most authoritative first.
export async function clientExecutableCandidates() {
  const [installs, registered] = await Promise.all([readInstalls(), registeredClientPath()]);
  return uniqueClients([
    ...clientCandidates(installs),
    registered,
    conventionalClientPath(process.env.SystemDrive)
  ]);
}

// The first candidate that is actually on disk, or null. Exported so a harness can prove the
// order with files it creates on any drive, without touching a real Riot install.
export async function firstExisting(candidates) {
  for (const candidate of candidates ?? []) {
    try { await fs.access(candidate); return candidate; } catch { /* not this one */ }
  }
  return null;
}

// Riot Client is not required to live on the system drive, so its location is discovered rather
// than assumed. The old code composed C:\Riot Games\Riot Client\RiotClientServices.exe, which made
// every machine that installed the client elsewhere unusable, reported as a missing file.
async function resolveClientExecutable() {
  const candidates = await clientExecutableCandidates();
  const found = await firstExisting(candidates);
  if (found) return found;
  throw new Error(`Riot Client was not found on this PC. Looked in ${candidates.length} place(s): ${candidates.join(' · ')}. Install Riot Client, or start it once so Windows records where it lives.`);
}

// Both entries go through here so the client is located in exactly one place.
async function spawnClient(args) {
  const executable = await resolveClientExecutable();
  const client = spawn(executable, args, { detached: true, stdio: 'ignore' });
  client.unref();
}

export async function launchRiotClient() {
  await spawnClient([]);
}

// Starts Valorant by asking the RUNNING client, over the local API its own Play button uses.
// Deliberate and load-bearing — see launchRequestPath in play.js for why passing the launcher
// `--launch-product` does not work: that is an app command gated behind Riot's direct-launch
// opt-in (disabled on this build) and it loses a process-singleton race. The lockfile carries the
// port and password for basic auth, and nothing here hardcodes the install location.
// Not exported: one request is not a launch — callers want launchValorantWhenReady.
async function launchGame(game) {
  const lockfile = await readLockfile();
  const requestPath = launchRequestPath({ product: game.product, patchline: await resolvePatchline(game) });
  const authorization = Buffer.from(`riot:${lockfile.password}`).toString('base64');

  return await new Promise((resolve, reject) => {
    const request = https.request({
      hostname: '127.0.0.1',
      port: lockfile.port,
      path: requestPath,
      method: 'POST',
      agent: localAgent,
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength('{}')
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8').trim();
        if (response.statusCode >= 200 && response.statusCode < 300) resolve({ status: response.statusCode, body });
        else reject(Object.assign(new Error(`Riot Client refused the launch (${response.statusCode})${body ? `: ${body}` : '.'}`), { status: response.statusCode }));
      });
    });
    request.on('error', (error) => reject(new Error(`Could not reach Riot Client to launch the game: ${error.message}`, { cause: error })));
    request.setTimeout(20_000, () => request.destroy(new Error('Riot Client did not answer the launch request within 20 seconds.')));
    request.end('{}');
  });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForGameProcess(game, timeoutMs) {
  const started = Date.now();
  for (;;) {
    if (await isGameRunning(game.id)) return true;
    if (Date.now() - started >= timeoutMs) return false;
    await sleep(750);
  }
}

// Ask the client for a launch and keep asking until the game is actually running. One request is
// not enough: the client accepts a launch and then drops it while its own lifecycle is still
// settling (region election, EULA, client config, Vanguard check) — exactly the window just after
// a switch. The verdict here is the game PROCESS, never the response code, because a 200 that
// produces nothing is the failure this exists to stop reporting as a success.
export async function launchGameWhenReady(gameId = 'valorant', {
  delays = LAUNCH_RETRY_DELAYS,
  appearTimeout = LAUNCH_APPEAR_TIMEOUT
} = {}) {
  const game = resolveGame(gameId);
  // League's client takes noticeably longer than Valorant to put its first process up.
  const timeout = game.id === 'lol' ? Math.max(appearTimeout, 12_000) : appearTimeout;
  const refusals = [];
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try { await launchGame(game); }
    catch (error) {
      // 424 = "not up to date, launch blocked": retrying cannot help until the game is patched. Show
      // the Riot Client (its Update button is right there) and say so, instead of four blind retries.
      if (error.status === 424) {
        launchRiotClient().catch(() => {});
        throw Object.assign(new Error(`${game.label} needs an update. The Riot Client is open — press Update there, then PLAY again.`), { reason: 'needs-update' });
      }
      refusals.push(error.message);
      continue;
    }
    if (await waitForGameProcess(game, timeout)) return true;
  }
  const last = refusals[refusals.length - 1];
  throw new Error(last
    ? `Riot Client would not start the game: ${last}`
    : `Riot Client accepted the launch request but ${game.label} never started. Try PLAY again, or press Play in the Riot Client.`);
}

// Whether a game is open right now — used to refuse a second launch, not to detect anything
// about the account. One tasklist call for every known game, parsed here: cheaper than a call per executable.
export async function runningImages() {
  try {
    const { stdout } = await exec('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return new Set(stdout.split(/\r?\n/).map((line) => line.split('","')[0].replace(/^"/, '').toLowerCase()).filter(Boolean));
  } catch { return new Set(); }
}

export async function isGameRunning(gameId = 'valorant') {
  const images = await runningImages();
  return resolveGame(gameId).processes.some((name) => images.has(name.toLowerCase()));
}

// Any Riot game open at all: a switch closes every Riot process, so it must refuse while either runs.
export async function runningGame() {
  const images = await runningImages();
  return Object.values(GAMES).find((game) => game.processes.some((name) => images.has(name.toLowerCase())))?.id ?? null;
}
