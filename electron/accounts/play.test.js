import { describe, expect, it } from 'vitest';
import { LAUNCH_RETRY_DELAYS, launchRequestPath, planPlay, valorantPatchline } from './play.js';

// Pure text/decision work: which request starts the game, which patchline is installed, and what a
// PLAY press means. An accepted request says nothing about whether a game window appears.

describe('valorantPatchline', () => {
  const installed = (dir) => ({ associated_client: { [dir]: 'C:/Riot Games/Riot Client/RiotClientServices.exe' } });

  it('reads the patchline out of the installed Valorant directory', () => {
    expect(valorantPatchline(installed('E:/Riot Games/VALORANT/live/'))).toBe('live');
  });

  it('reports a PBE install as pbe rather than assuming live', () => {
    expect(valorantPatchline(installed('E:/Riot Games/VALORANT/pbe/'))).toBe('pbe');
  });

  it('does not need a trailing separator', () => {
    expect(valorantPatchline(installed('E:\\Riot Games\\VALORANT\\live'))).toBe('live');
  });

  it('matches the product segment whatever its casing', () => {
    expect(valorantPatchline(installed('e:/riot games/valorant/live/'))).toBe('live');
  });

  it('ignores products that are not Valorant', () => {
    expect(valorantPatchline(installed('C:/Riot Games/League of Legends/live/'))).toBe('live');
  });

  it('is not fooled by a directory that merely contains the word', () => {
    // Segment matching, not substring: 'VALORANT-BACKUP' is not the Valorant product
    // directory, so its sibling folder must not be read as a patchline.
    expect(valorantPatchline(installed('E:/VALORANT-BACKUP/banana/'))).toBe('live');
  });

  it('falls back to live when the install map is missing or unreadable', () => {
    expect(valorantPatchline(null)).toBe('live');
    expect(valorantPatchline({})).toBe('live');
    expect(valorantPatchline({ associated_client: null })).toBe('live');
  });

  it('falls back when the product directory names no patchline', () => {
    expect(valorantPatchline(installed('E:/Riot Games/VALORANT/'))).toBe('live');
  });
});

describe('launchRequestPath', () => {
  it('points at the client plugin route its own Play button calls', () => {
    expect(launchRequestPath({ patchline: 'live' }))
      .toBe('/product-launcher/v1/products/valorant/patchlines/live');
  });

  it('defaults to Valorant on live', () => {
    expect(launchRequestPath()).toBe('/product-launcher/v1/products/valorant/patchlines/live');
  });

  it('addresses the PBE patchline when that is what is installed', () => {
    expect(launchRequestPath({ patchline: 'pbe' }))
      .toBe('/product-launcher/v1/products/valorant/patchlines/pbe');
  });

  it('refuses to let a patchline climb out of its path segment', () => {
    // A malformed patchline from disk must not be able to address a different route.
    const path = launchRequestPath({ patchline: 'live/../../admin' });
    expect(path).toBe('/product-launcher/v1/products/valorant/patchlines/liveadmin');
    expect(path).not.toContain('..');
  });

  it('falls back to live for a patchline that sanitises to nothing', () => {
    expect(launchRequestPath({ patchline: '///' }))
      .toBe('/product-launcher/v1/products/valorant/patchlines/live');
  });

  it('escapes the product too, since it shares the path', () => {
    expect(launchRequestPath({ product: 'a/b' }))
      .toBe('/product-launcher/v1/products/a%2Fb/patchlines/live');
  });
});

describe('planPlay', () => {
  it('launches straight away when the game is closed and this account is signed in', () => {
    expect(planPlay({ isActive: true, valorantRunning: false })).toBe('launch');
  });

  it('refuses to relaunch a game that is already open under this account', () => {
    expect(planPlay({ isActive: true, valorantRunning: true })).toBe('already-running');
  });

  it('switches first when another account owns the session', () => {
    // The client only acts on a launch request while it is signed in, so a press on any other row
    // must sign in first. PLAY stays ONE press: switch, wait, launch. Refusing here is what made the
    // control useless — every saved account sat in exactly this state.
    expect(planPlay({ isActive: false, valorantRunning: false })).toBe('switch-then-launch');
  });

  it('refuses rather than closing a game that is open under another account', () => {
    // A switch closes every Riot process, the running game included. Mid-match that is a killed
    // game, so a press on another row must refuse and let the user decide.
    expect(planPlay({ isActive: false, valorantRunning: true })).toBe('close-game-first');
  });
});

describe('LAUNCH_RETRY_DELAYS', () => {
  it('asks straight away rather than waiting first', () => {
    // Riot Client is usually settled by the time a press lands, and making it wait would add
    // seconds to every launch that was going to work anyway.
    expect(LAUNCH_RETRY_DELAYS[0]).toBe(0);
  });

  it('asks more than once, because the client can accept a request and then swallow it', () => {
    // Right after a switch the client's own lifecycle is still running (region election,
    // EULA, client config, Vanguard check). A launch request that arrives in that window is
    // acknowledged and dropped, so one attempt is not enough.
    expect(LAUNCH_RETRY_DELAYS.length).toBeGreaterThan(1);
  });

  it('backs off, so a client that is still busy is not hammered', () => {
    for (let index = 1; index < LAUNCH_RETRY_DELAYS.length; index += 1) {
      expect(LAUNCH_RETRY_DELAYS[index]).toBeGreaterThanOrEqual(LAUNCH_RETRY_DELAYS[index - 1]);
    }
    expect(LAUNCH_RETRY_DELAYS.every((delay) => Number.isFinite(delay) && delay >= 0)).toBe(true);
  });
});
