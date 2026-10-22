/** SMA-seeded EMA of closed candle closes. No value is invented before period observations. */
export function ema(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = Array(closes.length).fill(null);
  if (!Number.isInteger(period) || period < 1) throw new Error('EMA 기간은 양의 정수여야 합니다.');
  if (closes.length < period) return result;
  const alpha = 2 / (period + 1);
  let value = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  result[period - 1] = value;
  for (let i = period; i < closes.length; i++) {
    value += alpha * (closes[i] - value);
    result[i] = value;
  }
  return result;
}
