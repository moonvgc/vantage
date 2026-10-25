import { describe, expect, it } from 'vitest';
import {
  clientCandidates,
  conventionalClientPath,
  protocolExecutable,
  registryCommand,
  uniqueClients
} from './riotClientPath.js';

// Finding RiotClientServices.exe is pure text work, tested here because the case that matters is
// the one this PC does not have: a client installed somewhere other than C:\Riot Games. The app
// used to compose that path, so such machines were unusable, reported as a missing file.

const E = 'E:/Riot Games/Riot Client/RiotClientServices.exe';
const D = 'D:\\Games\\Riot Client\\RiotClientServices.exe';

describe('clientCandidates', () => {
  it('reads the client path Riot records for the client itself', () => {
    expect(clientCandidates({ rc_default: E })).toEqual([E]);
  });

  it('prefers rc_default, then rc_live, then the mapped clients', () => {
    expect(clientCandidates({
      rc_default: 'C:/a/RiotClientServices.exe',
      rc_live: 'C:/b/RiotClientServices.exe',
      associated_client: { 'E:/Riot Games/VALORANT/live/': E },
      patchlines: { KeystoneFoundationLiveWin: 'C:/d/RiotClientServices.exe' }
    })).toEqual(['C:/a/RiotClientServices.exe', 'C:/b/RiotClientServices.exe', E, 'C:/d/RiotClientServices.exe']);
  });

  it('finds the client on a drive that is not the system drive', () => {
    // The whole point: nothing here assumes C:, so a machine that put Riot Games on E: works.
    expect(clientCandidates({ rc_default: D })).toEqual([D]);
  });

  it('names the same file once when several entries point at it', () => {
    const installs = {
      rc_default: E, rc_live: E,
      associated_client: { 'E:/VALORANT/live/': E },
      patchlines: { KeystoneFoundationLiveWin: E }
    };
    expect(clientCandidates(installs)).toEqual([E]);
    // Windows paths are case-insensitive, so a second spelling is the same file.
    expect(clientCandidates({ rc_default: E, rc_live: E.toLowerCase() })).toEqual([E]);
  });

  it('drops values that are not the client executable', () => {
    // `associated_client` can point at something other than the client we spawn.
    expect(clientCandidates({
      rc_default: 'C:/League/LeagueClient.exe',
      associated_client: { 'E:/x/': null, 'E:/y/': 42, 'E:/z/': '   ' }
    })).toEqual([]);
  });

  it('returns nothing rather than throwing when the map is missing or malformed', () => {
    expect(clientCandidates(null)).toEqual([]);
    expect(clientCandidates(undefined)).toEqual([]);
    expect(clientCandidates('nope')).toEqual([]);
    expect(clientCandidates([])).toEqual([]);
    expect(clientCandidates({ associated_client: null, patchlines: null })).toEqual([]);
  });
});

describe('uniqueClients', () => {
  it('keeps the first spelling of each path and drops the rest', () => {
    expect(uniqueClients([E, E.toLowerCase(), D])).toEqual([E, D]);
  });

  it('drops non-client values and anything that is not a list', () => {
    expect(uniqueClients(['a.exe', E, null, undefined, 7])).toEqual([E]);
    expect(uniqueClients(null)).toEqual([]);
  });
});

describe('registryCommand', () => {
  // Shape of `reg query <key> /ve`: a path line, a blank line, then the value.
  const output = [
    '',
    'HKEY_CLASSES_ROOT\\riotclient\\shell\\open\\command',
    '    (Default)    REG_SZ    "C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --app-command="%1"',
    ''
  ].join('\r\n');

  it('extracts the command from real reg.exe output', () => {
    expect(registryCommand(output)).toBe('"C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --app-command="%1"');
  });

  it('accepts an expandable-string value', () => {
    expect(registryCommand('    (Default)    REG_EXPAND_SZ    "C:\\x\\RiotClientServices.exe"'))
      .toBe('"C:\\x\\RiotClientServices.exe"');
  });

  it('returns null when there is no value line', () => {
    expect(registryCommand('HKEY_CLASSES_ROOT\\riotclient\r\n')).toBe(null);
    expect(registryCommand('')).toBe(null);
    expect(registryCommand(null)).toBe(null);
    expect(registryCommand(undefined)).toBe(null);
  });
});

describe('protocolExecutable', () => {
  it('takes the executable out of a quoted command line', () => {
    expect(protocolExecutable('"C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --app-command="%1"'))
      .toBe('C:\\Riot Games\\Riot Client\\RiotClientServices.exe');
  });

  it('handles a quoted path with no arguments', () => {
    expect(protocolExecutable('"D:\\Riot Games\\Riot Client\\RiotClientServices.exe"'))
      .toBe('D:\\Riot Games\\Riot Client\\RiotClientServices.exe');
  });

  it('falls back to everything up to the name when the path is not quoted', () => {
    expect(protocolExecutable('E:\\Riot Games\\Riot Client\\RiotClientServices.exe --app-command="%1"'))
      .toBe('E:\\Riot Games\\Riot Client\\RiotClientServices.exe');
  });

  it('refuses a handler that points at something else', () => {
    // The registry is machine state: a stale or foreign handler must not become the executable
    // this app spawns.
    expect(protocolExecutable('"C:\\Windows\\System32\\cmd.exe" /c calc')).toBe(null);
    expect(protocolExecutable('')).toBe(null);
    expect(protocolExecutable(null)).toBe(null);
    expect(protocolExecutable(undefined)).toBe(null);
  });
});

describe('conventionalClientPath', () => {
  it('composes the usual location on the system drive', () => {
    expect(conventionalClientPath('C:')).toMatch(/RiotClientServices\.exe$/i);
    expect(conventionalClientPath('C:')).toContain('Riot Games');
  });

  it('follows the system drive when it is not C:', () => {
    expect(conventionalClientPath('D:')).toMatch(/^D:\\/i);
  });

  it('falls back to C: when the drive is missing or empty', () => {
    expect(conventionalClientPath(undefined)).toMatch(/^C:\\/i);
    expect(conventionalClientPath('')).toMatch(/^C:\\/i);
    expect(conventionalClientPath('   ')).toMatch(/^C:\\/i);
  });
});
