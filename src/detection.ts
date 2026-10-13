import { INTERVAL, type Candle, type Direction, type Settings, type Wave } from './types';

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const change = (price: number, base: number) => Math.round((price / base - 1) * 100 * 1e10) / 1e10;
const signOf = (direction: Direction) => direction === 'long' ? 1 : -1;
const favorable = (c: Candle, direction: Direction) => direction === 'long' ? c.high : c.low;
const adverse = (c: Candle, direction: Direction) => direction === 'long' ? c.low : c.high;

/** Input may include an open candle. Only candles closed at the frozen market clock are used. */
export function closedCandles(candles: Candle[], asOf: number): Candle[] {
  return candles.filter(c => c.time + INTERVAL <= asOf).sort((a, b) => a.time - b.time);
}

export function analyzeWave(wave: Wave, candles: Candle[]): Wave {
  const { direction } = wave;
  const sign = signOf(direction);
  const after = candles.slice(wave.signalIndex);
  let extremeIndex = wave.signalIndex;
  after.forEach((c, offset) => {
    if (sign * (favorable(c, direction) - favorable(candles[extremeIndex], direction)) > 0) extremeIndex = wave.signalIndex + offset;
  });
  const extreme = favorable(candles[extremeIndex], direction);
  const correction = candles.slice(extremeIndex + 1);
  const waveTurnover = mean(candles.slice(wave.startIndex, extremeIndex + 1).map(c => c.turnover));
  const correctionTurnover = correction.length ? mean(correction.map(c => c.turnover)) : null;
  const turnoverRatio = correctionTurnover !== null && waveTurnover > 0 ? correctionTurnover / waveTurnover : null;
  const latest = candles.at(-1)!;
  const previous = candles.at(-2);
  const invalid = after.some(c => sign * (adverse(c, direction) - wave.startPrice) < 0);
  const reduced = turnoverRatio !== null && turnoverRatio <= 0.7 && correction.some(c => sign * (c.close - c.open) < 0);
  const resumed = reduced && correction.length >= 2 && previous &&
    sign * (latest.close - favorable(previous, direction)) > 0 && sign * (latest.close - latest.open) > 0;
  const status = invalid ? '구조 무효' : resumed ? (direction === 'long' ? '반등 관찰' : '하락 재개 관찰') :
    reduced ? '거줄음 확인' : correction.length ? (direction === 'long' ? '눌림 진행' : '되돌림 진행') : '1파 발견';
  return { ...wave, extreme, extremeIndex, pullback: sign * (1 - latest.close / extreme) * 100,
    waveTurnover, correctionTurnover, turnoverRatio, status, candles };
}

/** Each direction keeps its own grouping state; detection never reads candles after i. */
function detectDirection(symbol: string, candles: Candle[], settings: Settings, asOf: number, direction: Direction): Wave[] {
  const sign = signOf(direction);
  const since = asOf - settings.hours * 60 * 60 * 1000;
  const waves: Wave[] = [];
  let active: Wave | undefined;
  let runningExtreme = 0;
  let separated = false;
  for (let i = 20; i < candles.length; i++) {
    const c = candles[i];
    if (active) {
      // Start boundary break or >=50% retracement of the directional wave permits another wave.
      if (sign * (adverse(c, direction) - active.startPrice) < 0 ||
        sign * (runningExtreme - adverse(c, direction)) >= sign * (runningExtreme - active.startPrice) * 0.5) separated = true;
      if (sign * (favorable(c, direction) - runningExtreme) > 0) runningExtreme = favorable(c, direction);
    }
    if (c.time + INTERVAL < since) continue;
    const prior = candles.slice(i - 20, i);
    if (prior.some((bar, j) => candles[i - 20 + j + 1].time - bar.time !== INTERVAL)) continue;
    const baseline = mean(prior.map(bar => bar.turnover));
    if (baseline <= 0) continue;
    const rise = change(c.close, candles[i - 1].close);
    const rvol = c.turnover / baseline;
    const boundary = direction === 'long' ? Math.max(...prior.map(bar => bar.high)) : Math.min(...prior.map(bar => bar.low));
    if (sign * rise < settings.minRise || rvol < settings.minRvol || sign * (c.close - boundary) <= 0) continue;
    if (active && !separated) { active.confirmations++; continue; }
    const starts = candles.slice(i - 2, i + 1).map(bar => adverse(bar, direction));
    const startPrice = direction === 'long' ? Math.min(...starts) : Math.max(...starts);
    const startIndex = i - 2 + starts.indexOf(startPrice);
    const hourRise = change(c.close, candles[i - 4].close);
    const overheated = sign * hourRise > 12;
    const score = Math.round(Math.min(40, sign * rise / settings.minRise * 20) + Math.min(40, rvol / settings.minRvol * 20) + (overheated ? 0 : 20));
    active = { id: `${symbol}-${direction}-${c.time}`, direction, symbol, signalTime: c.time + INTERVAL, signalIndex: i,
      startIndex, startPrice, rise, rvol, hourRise, overheated, confirmations: 1, score,
      extreme: favorable(c, direction), extremeIndex: i, pullback: 0, waveTurnover: 0, correctionTurnover: null,
      turnoverRatio: null, status: '1파 발견', candles: [] };
    runningExtreme = favorable(c, direction);
    separated = false;
    waves.push(active);
  }
  return waves.map(wave => analyzeWave(wave, candles));
}

/** Both sides use the same downloaded closed candles and the same settings. */
export function detectWaves(symbol: string, input: Candle[], settings: Settings, asOf: number): Wave[] {
  const candles = closedCandles(input, asOf);
  return [...detectDirection(symbol, candles, settings, asOf, 'long'), ...detectDirection(symbol, candles, settings, asOf, 'short')]
    .sort((a, b) => a.signalTime - b.signalTime);
}
