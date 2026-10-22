import { afterEach, expect, it, vi } from 'vitest';
import { loadSettings, validSettings } from './settings';
import { DEFAULT_SETTINGS } from './types';

afterEach(() => vi.unstubAllGlobals());
it('migrates previous saved settings without losing custom thresholds', () => {
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ hours: 6, minTurnover: 15000000, minRise: 3, minRvol: 4 }) });
  expect(loadSettings()).toEqual({ market: 'all', hours: 6, minTurnover: 15000000, minRise: 3, minRvol: 4 });
});
it('rejects unknown market filters and retains valid saved choices', () => {
  expect(validSettings({ ...DEFAULT_SETTINGS, market: 'unsupported' })).toBe(false);
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, market: 'stock' }) });
  expect(loadSettings().market).toBe('stock');
});
