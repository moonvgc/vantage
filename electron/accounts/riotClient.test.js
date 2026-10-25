import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clientExecutableCandidates, firstExisting } from './riotClient.js';

// The discovery chain end to end, through the SHIPPED module — not a re-implementation of it.
// `installsPath()` reads `process.env.ProgramData`, so pointing that at a scratch directory puts a
// fabricated machine in front of the real code: its own install map, and a client executable that
// exists.
//
// What this proves: the path in the map is what the app will run — the old code could only produce
// C:\Riot Games\Riot Client\RiotClientServices.exe, so this test fails against it. What this does
// NOT prove: that the drive letter can differ, since the scratch directory sits on the same drive
// as the system here; that half was proven separately, against a real client directory on E:\.
let scratch;
let fakeProgramData;
let realProgramData;

const installsFile = () => path.join(fakeProgramData, 'Riot Games', 'RiotClientInstalls.json');

function fabricateClient(relativeDirectory) {
  const directory = path.join(scratch, 'riot', relativeDirectory);
  const executable = path.join(directory, 'RiotClientServices.exe');
  mkdirSync(directory, { recursive: true });
  writeFileSync(executable, 'not a real client');
  return executable;
}

function fabricateInstalls(installs) {
  mkdirSync(path.dirname(installsFile()), { recursive: true });
  writeFileSync(installsFile(), JSON.stringify(installs));
}

beforeEach(() => {
  realProgramData = process.env.ProgramData;
  scratch = mkdtempSync(path.join(tmpdir(), 'vlrqa-riotpath-'));
  fakeProgramData = path.join(scratch, 'programdata');
});

afterEach(() => {
  if (realProgramData === undefined) delete process.env.ProgramData;
  else process.env.ProgramData = realProgramData;
  rmSync(scratch, { recursive: true, force: true });
});

describe('clientExecutableCandidates', () => {
  it('reads the client path out of the install map instead of assuming a location', async () => {
    const client = fabricateClient('elsewhere/Riot Client');
    fabricateInstalls({ rc_default: client });
    process.env.ProgramData = fakeProgramData;

    expect(await clientExecutableCandidates()).toContain(client);
  });

  it('puts the mapped path ahead of the conventional system-drive guess', async () => {
    const client = fabricateClient('moved/Riot Client');
    fabricateInstalls({ rc_default: client });
    process.env.ProgramData = fakeProgramData;

    const candidates = await clientExecutableCandidates();
    // The regression, stated as an assertion: the guess is no longer the answer.
    expect(candidates[0]).toBe(client);
    expect(candidates[0]).not.toBe(candidates[candidates.length - 1]);
  });

  it('still offers the conventional location, last, as a fallback', async () => {
    // Kept because it is genuinely where most installs land, and it costs one `access` call.
    fabricateInstalls({ rc_default: fabricateClient('somewhere/Riot Client') });
    process.env.ProgramData = fakeProgramData;

    const candidates = await clientExecutableCandidates();
    const last = candidates[candidates.length - 1];
    expect(last).toMatch(/RiotClientServices\.exe$/i);
    expect(last.toLowerCase()).toContain('riot games');
  });

  it('offers nothing but the client executable', async () => {
    // Every candidate is spawned verbatim, so a value pointing at another program must never
    // reach the list.
    fabricateInstalls({
      rc_default: 'C:/League/LeagueClient.exe',
      associated_client: { 'E:/Riot Games/VALORANT/live/': 'E:/Riot Games/VALORANT/valorant.exe' }
    });
    process.env.ProgramData = fakeProgramData;

    for (const candidate of await clientExecutableCandidates()) {
      expect(candidate.toLowerCase()).toMatch(/riotclientservices\.exe$/);
    }
  });

  it('survives a missing or unreadable install map', async () => {
    // No RiotClientInstalls.json at all — the app must still produce its fallbacks rather than
    // throw out of a cache read.
    process.env.ProgramData = fakeProgramData;
    const candidates = await clientExecutableCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].toLowerCase()).toMatch(/riotclientservices\.exe$/);
  });
});

describe('firstExisting', () => {
  it('returns the first candidate that is on disk', async () => {
    const present = fabricateClient('present/Riot Client');
    expect(await firstExisting([path.join(scratch, 'absent', 'RiotClientServices.exe'), present])).toBe(present);
  });

  it('skips paths that do not exist rather than returning one', async () => {
    // Handing spawn() a path that is not there is how a launch fails with no message at all,
    // so the check is the point of the function.
    expect(await firstExisting([path.join(scratch, 'nope', 'RiotClientServices.exe')])).toBe(null);
  });

  it('handles an empty or missing list', async () => {
    expect(await firstExisting([])).toBe(null);
    expect(await firstExisting(null)).toBe(null);
    expect(await firstExisting(undefined)).toBe(null);
  });
});
