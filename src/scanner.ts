import { BybitClient, errorMessage } from './api';
import { closedCandles, detectWaves } from './detection';
import { INTERVAL, type Failure, type Progress, type ScanResult, type Settings, type Wave } from './types';

export async function scanMarket(settings: Settings, signal: AbortSignal,
  progress: (value: Progress) => void,
  client: Pick<BybitClient, 'serverTime' | 'instruments' | 'tickers' | 'candles'> = new BybitClient(signal)): Promise<ScanResult> {
  progress({ stage: '거래소 기준 시각 확인', done: 0, total: 0 });
  const marketTime = await client.serverTime();
  progress({ stage: '전체 종목 목록 조회', done: 0, total: 0 });
  const instruments = await client.instruments();
  progress({ stage: '24시간 유동성 확인', done: 0, total: 0 });
  const tickers = new Map((await client.tickers()).map(ticker => [ticker.symbol, ticker]));
  const failures: Failure[] = [];
  const eligible = instruments.filter(instrument => {
    const ticker = tickers.get(instrument.symbol);
    const turnover = ticker && ticker.turnover24h.trim() !== '' ? Number(ticker.turnover24h) : NaN;
    if (!Number.isFinite(turnover) || turnover! < 0) {
      failures.push({ symbol: instrument.symbol, reason: '24시간 거래대금 누락 또는 유효하지 않은 응답' });
      return false;
    }
    return turnover! >= settings.minTurnover;
  }).sort((a, b) => Number(tickers.get(b.symbol)!.turnover24h) - Number(tickers.get(a.symbol)!.turnover24h));
  const waves: Wave[] = [];
  let cursor = 0;
  let completed = 0;
  progress({ stage: '확정 15분봉 검색', done: 0, total: eligible.length });
  const worker = async () => {
    while (cursor < eligible.length) {
      if (signal.aborted) throw new DOMException('검색 취소', 'AbortError');
      const symbol = eligible[cursor++].symbol;
      try {
        const candles = closedCandles(await client.candles(symbol, settings.hours, marketTime), marketTime);
        const first = Math.ceil((marketTime - settings.hours * 3_600_000) / INTERVAL) * INTERVAL - INTERVAL;
        const expectedStart = first - 20 * INTERVAL;
        const expectedEnd = Math.floor(marketTime / INTERVAL) * INTERVAL - INTERVAL;
        const complete = candles.length >= 21 && candles[0].time <= expectedStart && candles.at(-1)!.time === expectedEnd &&
          candles.every((c, i) => i === 0 || c.time - candles[i - 1].time === INTERVAL);
        if (!complete) throw new Error('조회 범위 또는 기준봉 20개 부족 / 캔들 누락 (신규 상장 포함)');
        waves.push(...detectWaves(symbol, candles, settings, marketTime));
      } catch (error) {
        if (signal.aborted) throw error;
        failures.push({ symbol, reason: errorMessage(error) });
      }
      completed++;
      progress({ stage: '확정 15분봉 검색', done: completed, total: eligible.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, eligible.length) }, worker));
  return { waves: waves.sort((a, b) => b.signalTime - a.signalTime || b.score - a.score),
    failures, universe: instruments.length, eligible: eligible.length, completed, marketTime,
    finishedAt: Date.now(), settings: { ...settings } };
}
