import { describe, it, expect } from 'vitest';
import { orderAccounts, SORT_MODES } from './accountOrder.js';
import { parseRank } from './format.js';

const account = (label, extra = {}) => ({ label, active: false, store: null, ...extra });
const ready = (label, level, rank) => account(label, { store: { profile: { level, rank } } });

const labels = (list) => list.map((a) => a.label);

describe('orderAccounts — active-first invariant', () => {
  it('moves the signed-in account to the top even when it arrives last', () => {
    const input = [account('alpha'), account('beta'), account('gamma', { active: true })];
    expect(labels(orderAccounts(input))).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('keeps the incoming order of the non-active accounts', () => {
    // The backend sorts by lastCheckedAt desc; re-sorting here would override it.
    const input = [account('zulu'), account('alpha'), account('mike')];
    expect(labels(orderAccounts(input))).toEqual(['zulu', 'alpha', 'mike']);
  });

  it('is a no-op when the signed-in account is already first', () => {
    const input = [account('first', { active: true }), account('second'), account('third')];
    expect(labels(orderAccounts(input))).toEqual(['first', 'second', 'third']);
  });

  it('keeps every account in a multi-active list, actives first', () => {
    // Should not happen, but must not drop accounts if it does.
    const input = [account('a'), account('b', { active: true }), account('c'), account('d', { active: true })];
    const result = orderAccounts(input);
    expect(result).toHaveLength(4);
    expect(labels(result).slice(0, 2).sort()).toEqual(['b', 'd']);
  });

  it('returns an empty list for an empty list', () => {
    expect(orderAccounts([])).toEqual([]);
  });

  it('tolerates a missing or non-array input without throwing', () => {
    expect(orderAccounts(null)).toEqual([]);
    expect(orderAccounts(undefined)).toEqual([]);
    expect(orderAccounts('nope')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [account('alpha'), account('beta', { active: true })];
    const copy = [...input];
    orderAccounts(input, 'label');
    expect(input).toEqual(copy);
  });

  it('treats a missing `active` field as not signed in', () => {
    const input = [{ label: 'x' }, { label: 'y', active: true }];
    expect(labels(orderAccounts(input))).toEqual(['y', 'x']);
  });
});

describe('orderAccounts — secondary sort modes', () => {
  const list = [
    account('zulu'),
    account('Alpha'),
    account('mike', { active: true })
  ];

  it('sorts the rest by label, case-insensitively, keeping active first', () => {
    expect(labels(orderAccounts(list, 'label'))).toEqual(['mike', 'Alpha', 'zulu']);
  });

  it('sorts by level descending, keeping active first', () => {
    const input = [ready('low', 10, 'Iron 1'), ready('high', 300, 'Immortal 3'), ready('mid', 120, 'Gold 2', )];
    expect(labels(orderAccounts(input, 'level'))).toEqual(['high', 'mid', 'low']);
  });

  it('sorts by rank tier descending, with unranked last', () => {
    const input = [
      ready('gold', 90, 'Gold 2'),
      account('unranked'),
      ready('asc', 90, 'Ascendant 2'),
      ready('dia', 90, 'Diamond 1')
    ];
    expect(labels(orderAccounts(input, 'rank', parseRank))).toEqual(['asc', 'dia', 'gold', 'unranked']);
  });

  it('falls back to the incoming order for an unknown mode', () => {
    expect(labels(orderAccounts(list, 'nonsense'))).toEqual(['mike', 'zulu', 'Alpha']);
  });

  it('exposes the supported modes', () => {
    expect(SORT_MODES).toContain('active');
    expect(SORT_MODES).toContain('label');
    expect(SORT_MODES).toContain('level');
    expect(SORT_MODES).toContain('rank');
  });

  it('never lets a secondary sort move the signed-in account off the top', () => {
    for (const mode of SORT_MODES) {
      const input = [ready('aaa', 999, 'Radiant'), account('zzz', { active: true })];
      const result = orderAccounts(input, mode, parseRank);
      expect(result[0].label).toBe('zzz');
      expect(result[0].active).toBe(true);
    }
  });
});
