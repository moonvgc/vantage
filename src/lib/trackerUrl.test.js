import { describe, expect, it } from 'vitest';
import { trackerUrl } from './trackerUrl.js';

describe('trackerUrl', () => {
  it('fills name and tag URL-encoded', () => {
    expect(trackerUrl('https://tracker.gg/valorant/profile/riot/{name}%23{tag}/overview', 'Rune Fox#EUW1'))
      .toBe('https://tracker.gg/valorant/profile/riot/Rune%20Fox%23EUW1/overview');
  });

  it('returns null without a full Riot ID or template', () => {
    expect(trackerUrl('https://x/{name}', 'Rune')).toBeNull();
    expect(trackerUrl('', 'Rune#1337')).toBeNull();
  });
});
