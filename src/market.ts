export type MarketFilter = 'all' | 'crypto' | 'stock';
export const MARKET_LABELS: Record<MarketFilter, string> = { all: '전체', crypto: '코인만', stock: '주식만' };

/** Explicit Bybit linear symbolType values only; missing/new types are not guessed from names. */
export function matchesMarket(symbolType: string | undefined, market: MarketFilter): boolean {
  if (market === 'all') return true;
  if (typeof symbolType !== 'string') return false;
  if (market === 'stock') return symbolType === 'stock';
  return symbolType === '' || symbolType === 'innovation';
}
