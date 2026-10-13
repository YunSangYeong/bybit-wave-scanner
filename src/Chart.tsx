import { useState } from 'react';
import { formatTime, money, price } from './format';
import { INTERVAL, type Wave } from './types';

export function Chart({ wave }: { wave: Wave }) {
  const isLong = wave.direction === 'long';
  const bars = wave.candles;
  const [selected, setSelected] = useState(bars.length - 1);
  const W = Math.max(720, bars.length * 10 + 92), H = 360;
  const left = 16, right = W - 84, top = 30, bottom = 255;
  const min = Math.min(...bars.map(c => c.low)) * 0.997;
  const max = Math.max(...bars.map(c => c.high)) * 1.003;
  const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
  const step = (right - left) / bars.length;
  const x = (i: number) => left + (i + 0.5) * step;
  const maxTurnover = Math.max(...bars.map(c => c.turnover), 1);
  const bar = bars[selected];
  return <div className="chart-block">
    <div className="chart-legend"><span className="legend-start">{isLong ? '시작 저점' : '시작 고점'}</span><span className="legend-signal">1파 확정</span><span className="legend-peak">{isLong ? '최고점' : '최저점'}</span><span className="legend-correction">조정 구간</span></div>
    <div className="chart-scroll" tabIndex={0} aria-label="15분봉 차트. 좌우로 스크롤할 수 있습니다.">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W }} role="img" aria-label={`${wave.symbol} 확정 15분봉 가격 및 USDT 거래대금 차트`}
        onPointerDown={event => {
          const box = event.currentTarget.getBoundingClientRect();
          setSelected(Math.max(0, Math.min(bars.length - 1, Math.floor(((event.clientX - box.left) * W / box.width - left) / step))));
        }}>
        <rect width={W} height={H} fill="#101c27" />
        {wave.extremeIndex < bars.length - 1 && <rect x={x(wave.extremeIndex) + step / 2} y={top} width={right - x(wave.extremeIndex) - step / 2} height={bottom - top} fill="#d9ad5520" />}
        {[0, 1, 2, 3, 4].map(i => {
          const value = min + (max - min) * i / 4;
          return <g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#283744" /><text x={right + 8} y={y(value) + 4} fill="#97a9b6" fontSize="11">{price(value)}</text></g>;
        })}
        <line x1={left} x2={right} y1={y(wave.startPrice)} y2={y(wave.startPrice)} stroke="#8eb8ff" strokeDasharray="4 4" />
        <line x1={left} x2={right} y1={y(wave.extreme)} y2={y(wave.extreme)} stroke="#dbb465" strokeDasharray="4 4" />
        {bars.map((c, i) => {
          const color = c.close >= c.open ? '#49d6b0' : '#f68c85';
          return <g key={c.time}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={color} />
            <rect x={x(i) - step * 0.3} y={Math.min(y(c.open), y(c.close))} width={step * 0.6} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} fill={color} />
            <rect x={x(i) - step * 0.3} y={320 - c.turnover / maxTurnover * 46} width={step * 0.6} height={Math.max(1, c.turnover / maxTurnover * 46)} fill={color} opacity="0.65" />
          </g>;
        })}
        <line x1={x(wave.signalIndex)} x2={x(wave.signalIndex)} y1={top} y2={bottom} stroke={isLong ? '#49d6b0' : '#f68c85'} strokeDasharray="3 3" />
        <circle cx={x(wave.startIndex)} cy={y(wave.startPrice)} r="4" fill="#8eb8ff" />
        <circle cx={x(wave.extremeIndex)} cy={y(wave.extreme)} r="4" fill="#dbb465" />
        <text x={left} y="17" fill="#97a9b6" fontSize="11">가격 · USDT</text>
        <text x={left} y="272" fill="#97a9b6" fontSize="10">거래대금 · USDT</text>
        {[0, Math.floor(bars.length / 2), bars.length - 1].map(i => <text key={i} x={x(i)} y="344" textAnchor={i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle'} fill="#97a9b6" fontSize="11">{formatTime(bars[i].time)}</text>)}
        <line x1={x(selected)} x2={x(selected)} y1={top} y2={320} stroke="#fff" opacity="0.5" />
      </svg>
    </div>
    <div className="candle-inspector">
      <button aria-label="이전 캔들" disabled={selected === 0} onClick={() => setSelected(i => i - 1)}>←</button>
      <div><strong>{formatTime(bar.time + INTERVAL)} 확정 · KST</strong><span>시 {price(bar.open)} / 고 {price(bar.high)} / 저 {price(bar.low)} / 종 {price(bar.close)}</span><span>거래대금 {money(bar.turnover)} USDT</span></div>
      <button aria-label="다음 캔들" disabled={selected === bars.length - 1} onClick={() => setSelected(i => i + 1)}>→</button>
    </div>
  </div>;
}
