import { describe, expect, it } from 'vitest';
import { ema } from './indicators';

describe('SMA-seeded EMA', () => {
  it('starts at the SMA and uses alpha = 2/(period+1)', () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([10, 10, 10, 16], 3).at(-1)).toBe(13);
  });
  it('does not invent EMA50/200 before enough closed observations exist', () => {
    expect(ema(Array(49).fill(100), 50).every(value => value === null)).toBe(true);
    expect(ema(Array(199).fill(100), 200).every(value => value === null)).toBe(true);
    expect(ema(Array(200).fill(100), 200)[199]).toBe(100);
  });
  it('preserves historical values when subsequent prices arrive', () => {
    const closes = Array.from({ length: 800 }, (_, i) => 100 + Math.sin(i / 10));
    for (const period of [50, 200]) {
      expect(ema([...closes, 10000], period).slice(0, -1)).toEqual(ema(closes, period));
    }
  });
});
