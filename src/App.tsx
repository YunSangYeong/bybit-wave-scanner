import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart } from './Chart';
import { errorMessage } from './api';
import { formatTime, money, percent, price } from './format';
import { scanMarket } from './scanner';
import { loadSettings, saveSettings, validSettings } from './settings';
import { type Direction, type Progress, type ScanResult, type Settings, type Wave, type WaveStatus } from './types';

const statusClass: Record<WaveStatus, string> = { '1파 발견': 'found', '눌림 진행': 'pulling', '거줄음 확인': 'quiet', '반등 관찰': 'rebound', '구조 무효': 'invalid', '되돌림 진행': 'pulling', '하락 재개 관찰': 'rebound' };
const statuses: WaveStatus[] = ['1파 발견', '눌림 진행', '되돌림 진행', '거줄음 확인', '반등 관찰', '하락 재개 관찰', '구조 무효'];
function RefreshIcon() { return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M19 11a7 7 0 0 0-12-4L4 10m16 4-3 3a7 7 0 0 1-12-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

function Detail({ wave, asOf, onClose }: { wave: Wave; asOf: number; onClose: () => void }) {
  const isLong = wave.direction === 'long';
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="detail" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="detail-top"><div><span className="eyebrow">WAVE ANALYSIS / 15 MIN</span><h2>{wave.symbol.replace(/USDT$/, '')}<small> / USDT</small></h2></div><button className="close" onClick={onClose} aria-label="상세 닫기">×</button></div>
    <div className="detail-sub"><span className={`direction-badge ${wave.direction}`}>{isLong ? '롱 · 상승' : '숏 · 하락'}</span><span className={`badge ${statusClass[wave.status]}`}>{wave.status}</span><span>{formatTime(wave.signalTime)} 1파 확정 · KST</span></div>
    <Chart wave={wave} />
    <dl className="detail-metrics">
      <div><dt>1파 시작 {isLong ? '저점' : '고점'}</dt><dd>{price(wave.startPrice)} <small>USDT</small></dd></div>
      <div><dt>1파 {isLong ? '최고가' : '최저가'}</dt><dd>{price(wave.extreme)} <small>USDT</small></dd></div>
      <div><dt>{isLong ? '최고가 대비 조정률' : '최저가 대비 되돌림률'}</dt><dd>{percent(wave.pullback)}</dd></div>
      <div><dt>최근 확정 종가</dt><dd>{price(wave.candles.at(-1)!.close)} <small>USDT</small></dd></div>
      <div><dt>1파 구간 평균 거래대금</dt><dd>{money(wave.waveTurnover)} <small>USDT</small></dd></div>
      <div><dt>조정 구간 평균 거래대금</dt><dd>{wave.correctionTurnover === null ? '조정봉 없음' : <>{money(wave.correctionTurnover)} <small>USDT</small></>}</dd></div>
      <div><dt>조정 / 1파 거래대금</dt><dd>{wave.turnoverRatio === null ? '—' : `${(wave.turnoverRatio * 100).toFixed(1)}%`}</dd></div>
      <div><dt>신호 당시 1시간 등락률</dt><dd>{percent(wave.hourRise)} {wave.overheated && <small className="hot">과열</small>}</dd></div>
    </dl>
    <p className="detail-note">{wave.confirmations}개 신호를 하나의 파동으로 묶었습니다. 가격 흐름은 {formatTime(asOf)} KST 기준 확정봉까지 분석합니다. 거줄음은 조정 평균 거래대금이 1파 평균의 70% 이하이고 {isLong ? '음봉' : '양봉'}이 있는 후보입니다. {isLong ? '반등 관찰' : '하락 재개 관찰'}은 {isLong ? '매수' : '매도'} 확정 신호가 아닙니다.</p>
    <a className="external-link" href={`https://www.bybit.com/trade/usdt/${encodeURIComponent(wave.symbol)}`} target="_blank" rel="noreferrer">Bybit에서 차트 검토 ↗</a>
  </dialog>;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: '검색 준비', done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Wave | null>(null);
  const [filter, setFilter] = useState('전체');
  const [sort, setSort] = useState('latest');
  const [direction, setDirection] = useState<Direction | 'all'>('all');
  const controller = useRef<AbortController | null>(null);
  const initialSettings = useRef(settings);
  const run = useCallback(async (config: Settings) => {
    if (!validSettings(config)) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setError(''); setSelected(null);
    try { const next = await scanMarket(config, active.signal, setProgress); if (!active.signal.aborted) setResult(next); }
    catch (failure) { if (!active.signal.aborted) setError(errorMessage(failure)); }
    finally { if (!active.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => { void run(initialSettings.current); return () => controller.current?.abort(); }, [run]);
  const update = (change: Partial<Settings>) => { const next = { ...settings, ...change }; setSettings(next); if (validSettings(next)) saveSettings(next); };
  const allWaves = result?.waves || [];
  const directionWaves = allWaves.filter(w => direction === 'all' || w.direction === direction);
  const directionCount = (value: Direction | 'all') => result ? allWaves.filter(w => value === 'all' || w.direction === value).length : '—';
  const statusCount = (status: string) => result ? directionWaves.filter(w => status === '전체' || w.status === status).length : '—';
  const waves = directionWaves.filter(w => filter === '전체' || w.status === filter)
    .slice().sort((a, b) => sort === 'score' ? b.score - a.score || b.signalTime - a.signalTime : b.signalTime - a.signalTime || b.score - a.score);
  const foundSymbols = new Set(result?.waves.map(w => w.symbol)).size;
  const percentDone = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
  const changed = result && JSON.stringify(settings) !== JSON.stringify(result.settings);

  return <>
    <header className="topbar"><div className="topbar-inner"><a className="brand" href={import.meta.env.BASE_URL} aria-label="WAVE 홈"><svg width="32" height="26" viewBox="0 0 32 26" fill="none" aria-hidden="true"><path d="m1 18 7-9 6 10L23 3l8 9" stroke="#49d6b0" strokeWidth="3" strokeLinejoin="round" /></svg> WAVE<span>SCANNER</span></a><span className="market-label"><i />BYBIT · PUBLIC</span></div></header>
    <main>
      <section className="hero"><div><span className="eyebrow">FIRST WAVE, CLEAR SIGNAL.</span><h1>시장의 첫 파동을<br /><em>포착하세요.</em></h1><p>거래대금이 터진 상승·하락 1파부터<br className="mobile-break" /> 거래량이 줄어든 눌림목까지.</p></div><div className="hero-stamp"><span>15m</span><small>확정봉 기반<br />USDT 무기한 선물</small></div></section>
      <section className="stats" aria-label="검색 요약">
        <div><span>탐색 대상</span><strong>{busy && progress.total ? progress.total : result?.eligible ?? '—'}<small> 종목</small></strong><p>유동성 필터 적용{result ? ` / 전체 ${result.universe}` : ''}</p></div>
        <div><span>1파 발견</span><strong className="mint">{result ? foundSymbols : '—'}<small> 종목</small></strong><p>{result ? `${result.waves.length}개 파동` : '검색 완료 후 표시'}</p></div>
        <div className="last-scan"><span>마지막 검색 완료</span><strong>{result ? formatTime(result.finishedAt) : '—'}</strong><p>KST · {result ? `최근 ${result.settings.hours}시간` : '자동 검색 대기'}</p></div>
      </section>
      <section className="control-panel">
        <div className="control-heading"><div><span className="section-kicker">SCAN CONFIGURATION</span><h2>검색 설정</h2></div><span className="subtle">닫힌 15분봉만 검사</span></div>
        <form onSubmit={event => { event.preventDefault(); void run(settings); }}>
          <fieldset disabled={busy}><legend>과거 검색 범위</legend><div className="range-options">{([1, 3, 6] as const).map(hours => <button key={hours} type="button" className={settings.hours === hours ? 'active' : ''} aria-pressed={settings.hours === hours} onClick={() => update({ hours })}>{hours}시간{hours === 3 && <span>기본</span>}</button>)}</div></fieldset>
          <details className="thresholds"><summary>탐지 기준 조정 <span>거래대금 · 상승률 · RVOL</span></summary><div className="setting-fields">
            <label>최소 24h 거래대금<small>만 USDT</small><input type="number" min="0" max="100000000" step="1" required disabled={busy} value={Number.isFinite(settings.minTurnover) ? settings.minTurnover / 10000 : ''} onChange={e => update({ minTurnover: e.target.value === '' ? NaN : Number(e.target.value) * 10000 })} /></label>
            <label>최소 15분 상승·하락률<small>%</small><input type="number" min="0.1" max="100" step="0.1" required disabled={busy} value={Number.isFinite(settings.minRise) ? settings.minRise : ''} onChange={e => update({ minRise: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
            <label>최소 거래대금 배수<small>RVOL · 배</small><input type="number" min="1" max="100" step="0.1" required disabled={busy} value={Number.isFinite(settings.minRvol) ? settings.minRvol : ''} onChange={e => update({ minRvol: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
          </div></details>
          <div className="scan-action"><p>{validSettings(settings) ? <>24h {money(settings.minTurnover)} USDT 이상 · ±{settings.minRise}% · {settings.minRvol}×</> : '유효한 검색 기준을 입력하세요.'}</p><button className="primary" type="submit" disabled={busy || !validSettings(settings)}><RefreshIcon />{busy ? '검색 중' : '새로고침'}</button></div>
        </form>
        {busy && <div className="progress" role="status"><div><span>{progress.stage}</span><strong>{progress.total ? `${progress.done} / ${progress.total} · ${percentDone}%` : '연결 중'}</strong></div><progress max={100} value={progress.total ? percentDone : undefined} /></div>}
      </section>
      {error && <div className="alert" role="alert"><strong>검색을 완료하지 못했습니다.</strong><p>{error}</p><p>가짜 데이터나 캐시 신호를 대신 표시하지 않습니다. 연결 상태를 확인한 뒤 새로고침하세요.{result && ' 아래 목록은 이전 검색 결과입니다.'}</p></div>}
      {result?.failures.length ? <div className="alert partial" role="status"><strong>부분 검색 결과 · 조회 실패 {result.failures.length}종목</strong><details><summary>실패 원인 보기</summary><ul>{result.failures.map(f => <li key={f.symbol}><b>{f.symbol}</b> {f.reason}</li>)}</ul></details></div> : null}
      <section className="results" aria-label="1파 탐지 결과"><div className="results-heading"><div><span className="section-kicker">DETECTED WAVES</span><h2>발견한 파동 <span>{result ? result.waves.length : '—'}</span></h2></div><label className="sort-label">정렬<select value={sort} onChange={e => setSort(e.target.value)}><option value="latest">최신순</option><option value="score">점수순</option></select></label></div>
        <div className="direction-filter" role="group" aria-label="방향 필터">{([['all', '전체 방향'], ['long', '롱'], ['short', '숏']] as const).map(([value, label]) => <button type="button" key={value} className={direction === value ? `selected ${value}` : ''} aria-pressed={direction === value} onClick={() => { setDirection(value); setFilter('전체'); }}>{label}({directionCount(value)})</button>)}<span>같은 데이터로 양방향 검색</span></div>
        <div className="filters" role="group" aria-label="상태 필터">{['전체', ...statuses].map(status => <button key={status} className={filter === status ? 'selected' : ''} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status}({statusCount(status)})</button>)}</div>
        {result && <p className="result-caption">{busy || error ? '이전 검색 결과 · ' : ''}{formatTime(result.marketTime)} KST 기준 · {result.settings.hours}시간 · {money(result.settings.minTurnover)} USDT · ±{result.settings.minRise}% · {result.settings.minRvol}×{changed && ' · 설정 변경 후 새로고침 필요'}</p>}
        {waves.length ? <div className="wave-list">{waves.map((wave, index) => <button className="wave-card" key={wave.id} onClick={() => setSelected(wave)}>
          <div className="card-top"><div className="coin"><span className="coin-icon">{wave.symbol[0]}</span><div><h3>{wave.symbol.replace(/USDT$/, '')}<small>USDT</small><span className={`direction-badge ${wave.direction}`}>{wave.direction === 'long' ? '롱' : '숏'}</span></h3><p>{formatTime(wave.signalTime)} KST · 1파 확정</p></div></div><span className={`badge ${statusClass[wave.status]}`}>{wave.status}</span></div>
          <div className="card-metrics"><div><span>{wave.direction === 'long' ? '1파 상승률' : '1파 하락률'}</span><strong className={wave.direction === 'long' ? 'positive' : 'negative'}>{wave.rise > 0 ? '+' : ''}{percent(wave.rise)}</strong></div><div><span>상대 거래대금</span><strong>{wave.rvol.toFixed(2)}<small>×</small></strong></div><div><span>{wave.direction === 'long' ? '현재 조정률' : '현재 되돌림률'}</span><strong>{percent(wave.pullback)}</strong></div></div>
          <div className="card-bottom"><div className="score"><span>탐지 점수</span><meter min="0" max="100" value={wave.score} /><strong>{wave.score}<small>/100</small></strong></div><span className="card-link">{wave.overheated ? <span className="hot">과열 · </span> : null}상세 차트 ↗</span></div><span className="sr-only">{index + 1}번째 결과 상세 보기</span>
        </button>)}</div> : <div className="empty"><div className="empty-symbol">⌁</div><h3>{busy ? '시장의 파동을 살펴보고 있어요' : !result ? '실제 시장 데이터 연결을 기다립니다' : result.failures.length ? '조회에 성공한 종목에서 신호가 없습니다' : filter !== '전체' || direction !== 'all' ? '이 상태의 파동이 없습니다' : '조건에 맞는 1파가 없습니다'}</h3><p>{busy ? '전체 종목을 확인하고 과거 확정봉을 차례로 검사합니다.' : !result ? '연결에 성공하면 최근 3시간의 신호를 자동으로 검색합니다.' : '검색 범위나 탐지 기준을 조정해 다시 살펴보세요.'}</p></div>}
      </section>
      <aside className="method-note"><span>i</span><div><strong>탐지 결과는 차트 검토를 위한 후보입니다.</strong><p>웹페이지가 열려 있을 때만 검색합니다. 닫힌 동안 실시간 탐지는 진행되지 않으며, 다시 열면 과거 봉을 조회합니다. 현재 가격은 검색 기준 시점의 최근 확정 종가이며 실시간 시세가 아닙니다.</p><p>24h 유동성은 검색 시점의 스냅샷입니다. 과거 신호의 가격·거래대금 조건에는 미래 봉을 사용하지 않습니다. RVOL은 코인 수량이 아닌 USDT 거래대금 배수입니다.</p></div></aside>
      <footer><span>WAVE SCANNER <b>v1.1</b></span><span>Bybit V5 Public API · KST</span></footer>
    </main>
    {selected && result && <Detail wave={selected} asOf={result.marketTime} onClose={() => setSelected(null)} />}
  </>;
}
