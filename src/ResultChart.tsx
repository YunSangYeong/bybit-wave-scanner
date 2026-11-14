import { useEffect, useRef, useState } from 'react';
import { BybitClient, errorMessage } from './api';
import { Chart } from './Chart';
import { closedCandles } from './detection';
import type { Candle, Wave } from './types';

/** One paced client and bounded cache per search, shared by inline and detail charts. */
export class ChartHistory {
  private controller = new AbortController();
  private client = new BybitClient(this.controller.signal);
  private cache = new Map<string, Promise<Candle[]>>();
  constructor(readonly asOf: number) {}
  load(symbol: string) {
    let request = this.cache.get(symbol);
    if (!request) {
      request = this.client.emaCandles(symbol, this.asOf).then(bars => closedCandles(bars, this.asOf));
      this.cache.set(symbol, request);
      request.catch(() => this.cache.delete(symbol));
    }
    return request;
  }
  dispose() { this.controller.abort(); this.cache.clear(); }
}

export function ResultChart({ wave, history, immediate = false }: { wave: Wave; history: ChartHistory; immediate?: boolean }) {
  const host = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(immediate);
  const [bars, setBars] = useState<Candle[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (immediate) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [immediate]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setBars(null); setError('');
    void history.load(wave.symbol).then(value => { if (active) setBars(value); })
      .catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
  }, [visible, history, wave.symbol]);
  return <section ref={host} className="result-chart" aria-label={`${wave.symbol} 기본 차트`}>
    <h4>{wave.symbol} · 확정 15분봉</h4>
    {visible ? <Chart wave={wave} emaHistory={bars} /> : <div className="chart-placeholder">화면에 가까워지면 차트를 자동 표시합니다.</div>}
    <p className="ema-note" role="status">{error ? `EMA 조회 실패: ${error}` : bars ? 'EMA50·EMA200 · EMA200은 두 배 굵기 · 검색 시점 확정봉 기준' : '가격은 검색 데이터입니다. EMA 과거 확정봉을 자동으로 불러옵니다.'}</p>
  </section>;
}
