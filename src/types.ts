export const INTERVAL = 5 * 60 * 1000;
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  turnover: number;
}
export interface Settings {
  hours: 1 | 3 | 6;
  minTurnover: number;
  minRise: number;
  minRvol: number;
}
export const DEFAULT_SETTINGS: Settings = { hours: 3, minTurnover: 10_000_000, minRise: 2, minRvol: 3 };
export type Direction = 'long' | 'short';
export type WaveStatus = '1파 발견' | '눌림 진행' | '거줄음 확인' | '반등 관찰' | '되돌림 진행' | '하락 재개 관찰' | '구조 무효';
export interface Wave {
  id: string;
  direction: Direction;
  symbol: string;
  signalTime: number;
  signalIndex: number;
  startIndex: number;
  startPrice: number;
  rise: number;
  rvol: number;
  hourRise: number;
  overheated: boolean;
  confirmations: number;
  score: number;
  extreme: number;
  extremeIndex: number;
  pullback: number;
  waveTurnover: number;
  correctionTurnover: number | null;
  turnoverRatio: number | null;
  status: WaveStatus;
  candles: Candle[];
}
export interface Failure { symbol: string; reason: string }
export interface ScanResult {
  waves: Wave[];
  failures: Failure[];
  universe: number;
  eligible: number;
  completed: number;
  marketTime: number;
  finishedAt: number;
  settings: Settings;
}
export interface Progress { stage: string; done: number; total: number }
