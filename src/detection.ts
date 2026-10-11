import { INTERVAL, type Candle, type Settings, type Wave } from './types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const change = (price: number, base: number) => Math.round((price / base - 1) * 100 * 1e10) / 1e10;

/** Input may include an open candle. Only candles closed at the frozen market clock are used. */
export function closedCandles(candles: Candle[], asOf: number): Candle[] {
  return candles.filter(c => c.time + INTERVAL <= asOf).sort((a, b) => a.time - b.time);
}

export function analyzeWave(wave: Wave, candles: Candle[]): Wave {
  const after = candles.slice(wave.signalIndex);
  let peakIndex = wave.signalIndex;
  after.forEach((c, offset) => {
    if (c.high > candles[peakIndex].high) peakIndex = wave.signalIndex + offset;
  });
  const peak = candles[peakIndex].high;
  const correction = candles.slice(peakIndex + 1);
  const waveTurnover = mean(candles.slice(wave.startIndex, peakIndex + 1).map(c => c.turnover));
  const correctionTurnover = correction.length ? mean(correction.map(c => c.turnover)) : null;
  const turnoverRatio = correctionTurnover !== null && waveTurnover > 0 ? correctionTurnover / waveTurnover : null;
  const latest = candles.at(-1)!;
  const previous = candles.at(-2);
  const invalid = after.some(c => c.low < wave.startLow);
  const reduced = turnoverRatio !== null && turnoverRatio <= 0.7 && correction.some(c => c.close < c.open);
  const rebound = reduced && correction.length >= 2 && previous && latest.close > previous.high && latest.close > latest.open;
  const status = invalid ? '구조 무효' : rebound ? '반등 관찰' : reduced ? '거줄음 확인' : correction.length ? '눌림 진행' : '1파 발견';
  return { ...wave, peak, peakIndex, pullback: (1 - latest.close / peak) * 100,
    waveTurnover, correctionTurnover, turnoverRatio, status, candles };
}

/** Historical signals use only [i-20, i] data. Later candles only describe subsequent structure. */
export function detectWaves(symbol: string, input: Candle[], settings: Settings, asOf: number): Wave[] {
  const candles = closedCandles(input, asOf);
  const since = asOf - settings.hours * 60 * 60 * 1000;
  const waves: Wave[] = [];
  let active: Wave | undefined;
  let runningPeak = 0;
  let separated = false;
  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    if (active) {
      // A broken start low or >=50% retracement of the rise permits a new wave.
      if (c.low < active.startLow || (runningPeak - c.low) >= (runningPeak - active.startLow) * 0.5) separated = true;
      runningPeak = Math.max(runningPeak, c.high);
    }
    if (c.time + INTERVAL < since) continue;
    const prior = candles.slice(i - 20, i);
    // Never bridge a gap: 15m/1h changes and baseline must represent actual consecutive candles.
    if (prior.some((bar, j) => candles[i - 20 + j + 1].time - bar.time !== INTERVAL)) continue;
    const baseline = mean(prior.map(bar => bar.turnover));
    if (baseline <= 0) continue;
    const rise = change(c.close, candles[i - 3].close);
    const rvol = c.turnover / baseline;
    if (rise < settings.minRise || rvol < settings.minRvol || c.close <= Math.max(...prior.map(bar => bar.high))) continue;
    if (active && !separated) { active.confirmations++; continue; }
    const startLow = Math.min(...candles.slice(i - 2, i + 1).map(bar => bar.low));
    const startIndex = candles.findIndex((bar, index) => index >= i - 2 && index <= i && bar.low === startLow);
    const hourRise = change(c.close, candles[i - 12].close);
    // A transparent ranking score, never a probability or buy recommendation.
    const score = Math.round(Math.min(40, rise / settings.minRise * 20) + Math.min(40, rvol / settings.minRvol * 20) + (hourRise <= 12 ? 20 : 0));
    active = { id: `${symbol}-${c.time}`, symbol, signalTime: c.time + INTERVAL, signalIndex: i,
      startIndex, startLow, rise, rvol, hourRise, overheated: hourRise > 12, confirmations: 1, score,
      peak: c.high, peakIndex: i, pullback: 0, waveTurnover: 0, correctionTurnover: null,
      turnoverRatio: null, status: '1파 발견', candles: [] };
    runningPeak = c.high;
    separated = false;
    waves.push(active);
  }
  return waves.map(wave => analyzeWave(wave, candles));
}
