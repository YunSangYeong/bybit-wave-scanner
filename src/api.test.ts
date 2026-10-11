import { afterEach, describe, expect, it, vi } from 'vitest';
import { BybitClient, parseCandles } from './api';
import { INTERVAL } from './types';

const envelope = (result: unknown, retCode = 0) => new Response(JSON.stringify({ retCode, retMsg: 'OK', result, time: 1_800_000_000_000 }), { status: 200 });
afterEach(() => { vi.useRealTimers(); });
describe('Bybit client', () => {
  it('fetches all pages, deduplicates instruments, and excludes other contracts', async () => {
    const item = { symbol: 'AAAUSDT', contractType: 'LinearPerpetual', quoteCoin: 'USDT', status: 'Trading' };
    const fetcher = vi.fn().mockResolvedValueOnce(envelope({ list: [item, { ...item, symbol: 'BADUSDC', quoteCoin: 'USDC' }], nextPageCursor: 'page2' }))
      .mockResolvedValueOnce(envelope({ list: [item, { ...item, symbol: 'BBBUSDT' }], nextPageCursor: '' }));
    const client = new BybitClient(new AbortController().signal, fetcher, 0);
    expect((await client.instruments()).map(i => i.symbol)).toEqual(['AAAUSDT', 'BBBUSDT']);
    const url = new URL(fetcher.mock.calls[1][0]);
    expect(url.searchParams.get('cursor')).toBe('page2');
    expect(url.searchParams.get('category')).toBe('linear');
  });
  it('rejects a repeated page cursor instead of claiming completeness', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(envelope({ list: [], nextPageCursor: 'repeat' })));
    await expect(new BybitClient(new AbortController().signal, fetcher, 0).instruments()).rejects.toThrow('반복');
  });
  it('retries rate limits and retains the shared request pacing', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(envelope({ timeSecond: '1800000000' }));
    const pending = new BybitClient(new AbortController().signal, fetcher, 200).serverTime();
    await vi.advanceTimersByTimeAsync(1999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2); expect(await pending).toBe(1_800_000_000_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not retry region blocks and fails later requests without another fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    const client = new BybitClient(new AbortController().signal, fetcher, 0);
    await expect(client.serverTime()).rejects.toThrow('접근 거부');
    await expect(client.tickers()).rejects.toThrow('접근 거부');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('respects cancellation before issuing a request', async () => {
    const abort = new AbortController(); abort.abort();
    const fetcher = vi.fn();
    await expect(new BybitClient(abort.signal, fetcher, 0).serverTime()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requests enough extra candles for the six-hour baseline', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ symbol: 'AAAUSDT', list: [] }));
    await new BybitClient(new AbortController().signal, fetcher, 0).candles('AAAUSDT', 6, 1_800_000_000_000);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(Number(url.searchParams.get('start'))).toBe(1_800_000_000_000 - 6 * 3_600_000 - 21 * INTERVAL);
    expect(url.searchParams.get('interval')).toBe('5');
  });
});
describe('candle validation', () => {
  it('parses USDT turnover rather than coin volume and sorts oldest first', () => {
    const rows = [['1800000300000', '100', '104', '99', '103', '20', '2030'], ['1800000000000', '100', '101', '99', '100', '10', '1000']];
    const c = parseCandles(rows); expect(c[0].time).toBe(1_800_000_000_000); expect(c[1].turnover).toBe(2030);
  });
  it('rejects malformed or duplicate price history', () => {
    const row = ['1800000000000', '100', '104', '99', '103', '20', '2030'];
    expect(() => parseCandles([row, row])).toThrow('중복');
    expect(() => parseCandles([[...row.slice(0, 6), '']])).toThrow('유효하지');
    expect(() => parseCandles([['1800000000000', '100', '90', '99', '103', '20', '2030']])).toThrow('유효하지');
  });
});
