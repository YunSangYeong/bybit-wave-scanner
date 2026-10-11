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
    expect(w.startLow).toBe(99);
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
    expect(later.peak).toBe(106);
  });
  it('groups continuation signals and separates signals after structure breaks', () => {
    const c = withSignal();
    c.push({ time: asOf(c), open: 103, close: 105, high: 106, low: 103, turnover: 8000 });
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
    for (let i = 0; i < 13; i++) c.push({ ...c[0], time: asOf(c), open: 103, close: 103, high: 104, low: 102 });
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
