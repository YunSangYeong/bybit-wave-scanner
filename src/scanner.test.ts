import { describe, expect, it, vi } from 'vitest';
import { scanMarket } from './scanner';
import { DEFAULT_SETTINGS, INTERVAL, type Candle } from './types';

const now = 1_800_000_000_000;
const instrument = (symbol: string) => ({ symbol, contractType: 'LinearPerpetual', quoteCoin: 'USDT', status: 'Trading' });
function fixture(): Candle[] {
  const bars = Array.from({ length: 58 }, (_, i) => ({ time: now - (58 - i) * INTERVAL, open: 100, high: 101, low: 99, close: 100, turnover: 1000 }));
  bars[40] = { ...bars[40], close: 103, high: 104, turnover: 4000 };
  return bars;
}
function client() {
  return { serverTime: vi.fn().mockResolvedValue(now), instruments: vi.fn().mockResolvedValue(['AAAUSDT', 'BBBUSDT', 'SMALLUSDT'].map(instrument)),
    tickers: vi.fn().mockResolvedValue([{ symbol: 'AAAUSDT', turnover24h: '11000000' }, { symbol: 'BBBUSDT', turnover24h: '12000000' }, { symbol: 'SMALLUSDT', turnover24h: '10' }]),
    candles: vi.fn().mockResolvedValue(fixture()) };
}
describe('full market scan', () => {
  it('applies the snapshot liquidity filter and verifies all eligible symbols', async () => {
    const c = client(); const progress = vi.fn();
    const result = await scanMarket(DEFAULT_SETTINGS, new AbortController().signal, progress, c);
    expect(result.universe).toBe(3); expect(result.eligible).toBe(2); expect(result.completed).toBe(2);
    expect(result.waves).toHaveLength(2); expect(result.failures).toHaveLength(0);
    expect(c.candles.mock.calls.every(args => args[0] !== 'SMALLUSDT')).toBe(true);
    expect(c.candles.mock.calls.every(args => args[2] === now)).toBe(true);
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ done: 2, total: 2 });
  });
  it('returns actual successful results with explicit per-symbol failures', async () => {
    const c = client();
    c.candles.mockImplementation(async (symbol: string) => { if (symbol === 'BBBUSDT') throw new Error('HTTP 500'); return fixture(); });
    const result = await scanMarket(DEFAULT_SETTINGS, new AbortController().signal, () => {}, c);
    expect(result.waves).toHaveLength(1);
    expect(result.failures).toEqual([{ symbol: 'BBBUSDT', reason: 'HTTP 500' }]);
  });
  it('marks missing tickers and incomplete candles as failures, not empty successful scans', async () => {
    const c = client(); c.tickers.mockResolvedValue([{ symbol: 'AAAUSDT', turnover24h: '11000000' }]);
    c.candles.mockResolvedValue(fixture().slice(30));
    const result = await scanMarket(DEFAULT_SETTINGS, new AbortController().signal, () => {}, c);
    expect(result.failures).toHaveLength(3); expect(result.waves).toHaveLength(0);
    expect(result.failures.find(f => f.symbol === 'AAAUSDT')?.reason).toContain('부족');
  });
  it('does not substitute local time or synthetic prices when the exchange clock fails', async () => {
    const c = client(); c.serverTime.mockRejectedValue(new Error('CORS blocked'));
    await expect(scanMarket(DEFAULT_SETTINGS, new AbortController().signal, () => {}, c)).rejects.toThrow('CORS blocked');
    expect(c.candles).not.toHaveBeenCalled();
  });
});
