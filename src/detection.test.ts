import { describe, expect, it } from 'vitest';
import { analyzeWave, detectWaves } from './detection';
import { DEFAULT_SETTINGS, INTERVAL, type Candle } from './types';

// Deliberate synthetic fixtures exist only in tests; the application never imports them.
const start = 1_800_000_000_000;
function baseline(count = 25): Candle[] {
  return Array.from({ length: count }, (_, i) => ({ time: start + i * INTERVAL, open: 100, high: 101, low: 99, close: 100, turnover: 1000 }));
}
function withSignal(): Candle[] {
  const candles = baseline();
  candles[24] = { ...candles[24], open: 100, close: 103, high: 104, turnover: 4000 };
  return candles;
}
const asOf = (candles: Candle[]) => candles.at(-1)!.time + INTERVAL;

describe('historical 1-wave detection', () => {
  it('uses turnover, previous 20 bars, a 15m close change, and records candle close time', () => {
    const c = withSignal();
    const [w] = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c));
    expect(w.rise).toBeCloseTo(3);
    expect(w.rvol).toBe(4);
    expect(w.signalTime).toBe(asOf(c));
    expect(w.startPrice).toBe(99);
    expect(w.status).toBe('1파 발견');
  });
  it('does not detect an unclosed candle even if it meets every condition', () => {
    const c = withSignal();
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c) - 1)).toEqual([]);
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(1);
  });
  it.each(['rise', 'turnover', 'breakout'] as const)('rejects a failed %s condition', condition => {
    const c = withSignal();
    if (condition === 'rise') c[24].close = 101.5;
    if (condition === 'turnover') c[24].turnover = 2999;
    if (condition === 'breakout') c[23].high = 104;
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(0);
  });
  it('accepts exact thresholds without including the signal in the baseline', () => {
    const c = withSignal(); c[24].close = 102; c[24].turnover = 3000;
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(1);
  });
  it('does not change historical signal metrics when later candles are added', () => {
    const c = withSignal();
    const first = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    c.push({ ...c[24], time: asOf(c), high: 106, open: 103, close: 105, low: 102, turnover: 90_000 });
    const later = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    expect([later.signalTime, later.rise, later.rvol, later.hourRise, later.score]).toEqual([first.signalTime, first.rise, first.rvol, first.hourRise, first.score]);
    expect(later.extreme).toBe(106);
  });
  it('groups continuation signals and separates signals after structure breaks', () => {
    const c = withSignal();
    c.push({ time: asOf(c), open: 103, close: 105.1, high: 106, low: 103, turnover: 8000 });
    let waves = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c));
    expect(waves).toHaveLength(1); expect(waves[0].confirmations).toBe(2);
    c.push({ time: asOf(c), open: 105, close: 100, high: 105, low: 98, turnover: 1000 });
    c.push({ time: asOf(c), open: 100, close: 108, high: 109, low: 100, turnover: 10_000 });
    waves = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c));
    expect(waves).toHaveLength(2); expect(waves[0].status).toBe('구조 무효');
  });
  it('rejects a baseline with missing candles', () => {
    const c = withSignal(); c.splice(10, 1);
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(0);
  });
  it('honors the search range by signal close time', () => {
    const c = withSignal();
    for (let i = 0; i < 5; i++) c.push({ ...c[0], time: asOf(c), open: 103, close: 103, high: 104, low: 102 });
    expect(detectWaves('TESTUSDT', c, { ...DEFAULT_SETTINGS, hours: 1 }, asOf(c))).toHaveLength(0);
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(1);
  });
  it('marks >12% hourly rises as overheated, not exactly 12%', () => {
    const c = withSignal(); c[24].close = 112; c[24].high = 114;
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0].overheated).toBe(false);
    c[24].close = 112.01;
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0].overheated).toBe(true);
  });
});

describe('pullback states', () => {
  it('detects reduced turnover with bearish candles, then observes a rebound', () => {
    const c = withSignal(); const w = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    c.push({ time: asOf(c), open: 103, close: 102, high: 103.5, low: 101.5, turnover: 300 });
    let analyzed = analyzeWave(w, c);
    expect(analyzed.status).toBe('거줄음 확인'); expect(analyzed.turnoverRatio).toBeCloseTo(0.15);
    expect(analyzed.pullback).toBeCloseTo((1 - 102 / 104) * 100);
    c.push({ time: asOf(c), open: 102, close: 103.8, high: 103.9, low: 102, turnover: 400 });
    analyzed = analyzeWave(w, c);
    expect(analyzed.status).toBe('반등 관찰');
  });
  it('uses pulling status for high turnover and invalidation takes precedence', () => {
    const c = withSignal(); const w = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    c.push({ time: asOf(c), open: 103, close: 102, high: 103, low: 101, turnover: 4000 });
    expect(analyzeWave(w, c).status).toBe('눌림 진행');
    c.push({ time: asOf(c), open: 102, close: 99, high: 102, low: 98, turnover: 100 });
    expect(analyzeWave(w, c).status).toBe('구조 무효');
  });
});

// Reflect prices around 100: every long pattern becomes the corresponding short pattern.
const mirror = (candles: Candle[]): Candle[] => candles.map(c => ({ ...c,
  open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));

describe('short waves', () => {
  it('detects a 15m decline and prior-low breakdown with the same RVOL and score', () => {
    const long = withSignal(); const c = mirror(long);
    const [w] = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c));
    expect(w.direction).toBe('short'); expect(w.rise).toBe(-3); expect(w.hourRise).toBe(-3);
    expect(w.startPrice).toBe(101); expect(w.extreme).toBe(96); expect(w.rvol).toBe(4);
    expect(w.score).toBe(detectWaves('TESTUSDT', long, DEFAULT_SETTINGS, asOf(long))[0].score);
    expect(w.status).toBe('1파 발견');
    expect(w.id).toContain('-short-');
  });
  it.each(['rise', 'turnover', 'breakout'] as const)('rejects a failed short %s condition', condition => {
    const c = mirror(withSignal());
    if (condition === 'rise') c[24].close = 98.5;
    if (condition === 'turnover') c[24].turnover = 2999;
    if (condition === 'breakout') c[23].low = 96;
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(0);
  });
  it('accepts exactly -2% and 3x, rejects an open signal candle and missing baseline', () => {
    const c = mirror(withSignal()); c[24].close = 98; c[24].turnover = 3000;
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(1);
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c) - 1)).toHaveLength(0);
    c.splice(10, 1);
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(0);
  });
  it('preserves short detection metrics when future lows arrive', () => {
    const c = mirror(withSignal()); const first = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    c.push({ time: asOf(c), open: 97, close: 95, low: 94, high: 98, turnover: 500 });
    const later = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    expect([later.signalTime, later.rise, later.rvol, later.hourRise, later.score]).toEqual([first.signalTime, first.rise, first.rvol, first.hourRise, first.score]);
    expect(later.extreme).toBe(94);
  });
  it('marks a >12% hourly decline as overheated, but not exactly 12%', () => {
    const c = mirror(withSignal()); c[24].close = 88; c[24].low = 87;
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0].overheated).toBe(false);
    c[24].close = 87.99;
    const w = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    expect(w.overheated).toBe(true); expect(w.score).toBeLessThanOrEqual(80);
  });
  it('groups short continuation and starts a new wave after the start high breaks', () => {
    const long = withSignal();
    long.push({ time: asOf(long), open: 103, close: 105.1, high: 106, low: 103, turnover: 8000 });
    let c = mirror(long); let waves = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c));
    expect(waves).toHaveLength(1); expect(waves[0].confirmations).toBe(2);
    long.push({ time: asOf(long), open: 105, close: 100, high: 105, low: 98, turnover: 1000 });
    long.push({ time: asOf(long), open: 100, close: 108, high: 109, low: 100, turnover: 10000 });
    c = mirror(long); waves = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c));
    expect(waves).toHaveLength(2); expect(waves[0].status).toBe('구조 무효');
    expect(waves.every(w => w.direction === 'short')).toBe(true);
  });
  it('confirms reduced turnover in bullish corrections, then observes bearish continuation', () => {
    const c = mirror(withSignal()); const w = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    c.push({ time: asOf(c), open: 97, close: 98, high: 98.5, low: 96.5, turnover: 300 });
    const quiet = analyzeWave(w, c);
    expect(quiet.status).toBe('거줄음 확인'); expect(quiet.turnoverRatio).toBeCloseTo(0.15);
    expect(quiet.pullback).toBeCloseTo((98 / 96 - 1) * 100);
    c.push({ time: asOf(c), open: 98, close: 96.2, high: 98, low: 96.1, turnover: 400 });
    expect(analyzeWave(w, c).status).toBe('하락 재개 관찰');
    c.push({ time: asOf(c), open: 97, close: 100, high: 101.1, low: 97, turnover: 300 });
    expect(analyzeWave(w, c).status).toBe('구조 무효');
  });
  it('uses short pullback status for high turnover, and exact start-high contact stays valid', () => {
    const c = mirror(withSignal()); const w = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))[0];
    c.push({ time: asOf(c), open: 97, close: 98, low: 97, high: 101, turnover: 4000 });
    expect(analyzeWave(w, c).status).toBe('되돌림 진행');
    c.push({ time: asOf(c), open: 100, close: 97, high: 101.01, low: 96.5, turnover: 100 });
    expect(analyzeWave(w, c).status).toBe('구조 무효');
  });
  it('can find both directions on one symbol without merging opposite waves', () => {
    const c = withSignal();
    for (let i = 0; i < 22; i++) c.push({ time: asOf(c), open: 103, close: 103, high: 104, low: 102, turnover: 1000 });
    c.push({ time: asOf(c), open: 103, close: 99, high: 103, low: 98, turnover: 4000 });
    const waves = detectWaves('TESTUSDT', c, { ...DEFAULT_SETTINGS, hours: 6 }, asOf(c));
    expect(waves.map(w => w.direction)).toEqual(['long', 'short']);
    expect(new Set(waves.map(w => w.id)).size).toBe(2);
  });
});

describe('15-minute timeframe with unchanged time-based conditions', () => {
  it.each(['long', 'short'] as const)('uses one 15m bar, not a 45m change, for %s signals', direction => {
    let c = withSignal();
    c[23] = { ...c[23], close: 102, high: 102 };
    if (direction === 'short') c = mirror(c);
    // The 45m change is 3%, but the actual 15m change is below 2%.
    expect(detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c))).toHaveLength(0);
  });
  it('keeps the hourly comparison at four 15m bars, not twelve bars', () => {
    const c = withSignal();
    c[20] = { ...c[20], close: 125, high: 126 };
    c[24] = { ...c[24], close: 140, high: 141 };
    const [w] = detectWaves('TESTUSDT', c, DEFAULT_SETTINGS, asOf(c));
    expect(w.hourRise).toBe(12); expect(w.overheated).toBe(false);
  });
});
