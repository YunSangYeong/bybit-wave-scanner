import { DEFAULT_SETTINGS, type Settings } from './types';
const KEY = 'wave-scanner-settings-v1';
export function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Settings;
  return [1, 3, 6].includes(s.hours) && Number.isFinite(s.minTurnover) && s.minTurnover >= 0 && s.minTurnover <= 1e12 &&
    Number.isFinite(s.minRise) && s.minRise > 0 && s.minRise <= 100 &&
    Number.isFinite(s.minRvol) && s.minRvol >= 1 && s.minRvol <= 100;
}
export function loadSettings(): Settings {
  try { const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null'); return validSettings(value) ? value : { ...DEFAULT_SETTINGS }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Private browsing may disable storage. */ }
}
