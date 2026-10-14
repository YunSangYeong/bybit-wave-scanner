import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// All intercepted responses below are synthetic, isolated browser-test fixtures.
// The production bundle never imports this script and never has a demo-data fallback.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173/bybit-wave-scanner/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true, args: ['--no-sandbox'],
});
const now = Math.floor(Date.now() / 900000) * 900000;
const errors = [];
const data = result => ({ retCode: 0, retMsg: 'OK', result, time: now });
const instrument = symbol => ({ symbol, contractType: 'LinearPerpetual', quoteCoin: 'USDT', status: 'Trading' });
const rows = Array.from({ length: 100 }, (_, i) => [String(now - (100 - i) * 900000), '100', '101', '99', '100', '10', '1000']);
rows[94] = [rows[94][0], '100', '104', '99', '103', '40', '4000'];
for (let i = 95; i < 100; i++) rows[i] = [rows[i][0], '103', '103.5', '101.5', '102', '3', '300'];
let klineCalls = 0;
let failing = false;
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
await context.route('https://api.bybit.com/**', async route => {
  const url = new URL(route.request().url());
  let response;
  if (url.pathname.endsWith('/time')) response = data({ timeSecond: String(now / 1000) });
  if (url.pathname.endsWith('/instruments-info')) response = data({ list: [instrument('BTCUSDT'), instrument('ETHUSDT')], nextPageCursor: '' });
  if (url.pathname.endsWith('/tickers')) response = data({ list: ['BTCUSDT', 'ETHUSDT'].map(symbol => ({ symbol, turnover24h: '20000000', lastPrice: '102' })) });
  if (url.pathname.endsWith('/kline')) {
    assert.equal(url.searchParams.get('interval'), '15', 'API requests 15-minute candles');
    klineCalls++;
    if (failing && url.searchParams.get('symbol') === 'ETHUSDT') {
      await route.fulfill({ status: 200, json: { retCode: 10001, retMsg: 'Fixture failure', result: {}, time: now } }); return;
    }
    const prices = url.searchParams.get('symbol') === 'ETHUSDT' ? rows.map(row => [row[0], String(200 - Number(row[1])), String(200 - Number(row[3])), String(200 - Number(row[2])), String(200 - Number(row[4])), row[5], row[6]]) : rows;
    response = data({ symbol: url.searchParams.get('symbol'), list: prices.toReversed() });
  }
  await route.fulfill({ status: 200, json: response });
});
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'page overflow');
try {
  await page.goto(base);
  await page.getByRole('button', { name: '새로고침', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.wave-card').length === 2);
  assert.equal(klineCalls, 2, 'automatic search');
  assert.equal(await page.locator('.wave-card .quiet').count(), 2);
  await noOverflow();
  await page.getByRole('button', { name: '롱(1)', exact: true }).waitFor();
  await page.getByRole('button', { name: '숏(1)', exact: true }).waitFor();
  await page.getByRole('button', { name: '전체(2)', exact: true }).waitFor();
  await page.getByRole('button', { name: '거줄음 확인(2)', exact: true }).waitFor();
  await page.getByRole('button', { name: /^롱\(/ }).click();
  assert.equal(await page.locator('.wave-card').count(), 1);
  assert.match(await page.locator('.wave-card').innerText(), /BTC/);
  await page.getByRole('button', { name: '전체(1)', exact: true }).waitFor();
  await page.getByRole('button', { name: '거줄음 확인(1)', exact: true }).waitFor();
  await page.getByRole('button', { name: '숏(1)', exact: true }).waitFor();
  await page.getByRole('button', { name: /^숏\(/ }).click();
  assert.equal(await page.locator('.wave-card').count(), 1);
  assert.match(await page.locator('.wave-card').innerText(), /ETH/);
  assert.match(await page.locator('.wave-card').innerText(), /-3\.00%/);
  assert.match(await page.locator('.wave-card').innerText(), /현재 되돌림률/);
  await page.locator('.wave-card').click();
  await page.getByRole('dialog').waitFor();
  await page.getByText('1파 시작 고점', { exact: true }).waitFor();
  await page.getByText('1파 최저가', { exact: true }).waitFor();
  await page.getByText('최저가 대비 되돌림률', { exact: true }).waitFor();
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  await page.getByRole('button', { name: /^전체 방향\(/ }).click();
  assert.equal(klineCalls, 2, 'direction filters do not redownload candles');
  await page.getByRole('button', { name: /^구조 무효\(/ }).click();
  await page.getByText('이 상태의 파동이 없습니다', { exact: true }).waitFor();
  await page.getByRole('button', { name: '거줄음 확인(2)', exact: true }).waitFor();
  await page.getByRole('button', { name: '전체(2)', exact: true }).waitFor();
  await page.getByRole('button', { name: /^전체\(/ }).click();
  await page.locator('.wave-card').first().click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('img', { name: /확정 15분봉/ }).count(), 1);
  await page.getByRole('button', { name: '이전 캔들', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '다음 캔들', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.setViewportSize({ width: 360, height: 780 }); await noOverflow();
  await page.getByText('탐지 기준 조정', { exact: false }).first().click();
  await page.getByRole('spinbutton', { name: '최소 24h 거래대금' }).fill('1500');
  await page.getByText(/설정 변경 후 새로고침 필요/).waitFor();
  await page.getByRole('button', { name: '1시간', exact: true }).click();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.result-caption')?.textContent.includes('1시간') && !document.querySelector('.progress'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.result-caption')?.textContent.includes('1시간') && !document.querySelector('.progress'));
  assert.equal(await page.locator('.wave-card').count(), 0, '90-minute-old signals must be excluded from the one-hour range');
  await page.getByRole('button', { name: '롱(0)', exact: true }).waitFor();
  await page.getByRole('button', { name: '숏(0)', exact: true }).waitFor();
  await page.getByRole('button', { name: '전체(0)', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '1시간', exact: true }).getAttribute('aria-pressed'), 'true', 'saved settings');
  failing = true;
  await page.getByRole('button', { name: /^3시간/ }).click();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.getByText('부분 검색 결과 · 조회 실패 1종목', { exact: true }).waitFor();
  assert.equal(await page.locator('.wave-card').count(), 1, 'only successful real-shape responses appear');
  await page.getByRole('button', { name: '롱(1)', exact: true }).waitFor();
  await page.getByRole('button', { name: '숏(0)', exact: true }).waitFor();
  await page.getByRole('button', { name: '거줄음 확인(1)', exact: true }).waitFor();
  await page.getByText('실패 원인 보기', { exact: true }).click();
  await page.getByText(/Fixture failure/).waitFor();
  await noOverflow();
  await page.setViewportSize({ width: 1024, height: 900 }); await noOverflow();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop-fixture.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/mobile-fixture.png', fullPage: true });
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('PASS: mobile 360/375px and desktop layout, automatic two-direction search, long/short filters and short chart labels, candle controls, settings persistence, refresh, partial results. Synthetic fixtures only.');

  // A separate page performs an unmocked browser request to inspect actual Bybit/CORS access.
  const live = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const livePage = await live.newPage();
  await livePage.goto(base);
  const probe = await livePage.evaluate(async () => {
    try {
      const response = await fetch('https://api.bybit.com/v5/market/time', { signal: AbortSignal.timeout(15000) });
      return { reachable: response.ok, status: response.status, body: (await response.text()).slice(0, 240) };
    } catch (error) { return { reachable: false, reason: String(error) }; }
  });
  console.log('LIVE Bybit browser probe (not fixture):', JSON.stringify(probe));
  await live.close();
} catch (error) {
  console.error('Browser failure state:', await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
