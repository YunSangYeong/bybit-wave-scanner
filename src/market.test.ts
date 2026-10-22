import { describe, expect, it } from 'vitest';
import { matchesMarket } from './market';

describe('official Bybit symbolType filters', () => {
  it('includes only explicitly recognized crypto types in coins-only results', () => {
    expect(matchesMarket('', 'crypto')).toBe(true);
    expect(matchesMarket('innovation', 'crypto')).toBe(true);
    for (const type of ['stock', 'ETF', 'commodity', 'forex', 'unknown', undefined]) expect(matchesMarket(type, 'crypto')).toBe(false);
  });
  it('distinguishes individual stocks from ETFs, other assets, and missing metadata', () => {
    expect(matchesMarket('stock', 'stock')).toBe(true);
    for (const type of ['', 'innovation', 'ETF', 'commodity', undefined]) expect(matchesMarket(type, 'stock')).toBe(false);
  });
  it('keeps all existing types in the default all-market search', () => {
    for (const type of ['', 'stock', 'ETF', 'commodity', 'forex', 'unknown', undefined]) expect(matchesMarket(type, 'all')).toBe(true);
  });
});
