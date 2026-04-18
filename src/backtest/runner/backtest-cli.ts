/**
 * Backtest CLI — standalone Nest app.
 *
 * 사용 예시:
 *   npm run backtest              # 기본 티커 셋 + 기본 기간
 *   npm run backtest -- --from 20200101 --to 20251231 --policies none,legacy-hard,continuous
 *
 * 결과: docs/backtest-reports/backtest-{timestamp}.md
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Market } from '@prisma/client';
import { Market as MarketEnum } from '@prisma/client';
import { BacktestModule } from '../backtest.module';
import { HistoricalCollectorService, HistoricalTicker } from '../data/historical-collector.service';
import { InfiniteBuyStrategy } from '../../trading/strategy/infinite-buy.strategy';
import { RsiPolicy } from '../../trading/types';
import { runBacktest } from '../engine/backtest.engine';
import { computeMetrics, BacktestMetrics } from '../engine/metrics';
import * as fs from 'fs';
import * as path from 'path';

interface CliArgs {
  from: string;
  to: string;
  policies: RsiPolicy[];
  tickers?: string; // "overseas,domestic,all" or custom csv
  persist: boolean;
  force: boolean;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const defaults: CliArgs = {
    from: '20200101',
    to: '20251231',
    policies: ['none', 'continuous', 'hard-stop-70', 'hard-stop-75', 'hard-stop-80'],
    tickers: 'all',
    persist: true,
    force: false,
    outDir: path.resolve(process.cwd(), 'docs', 'backtest-reports'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--from': defaults.from = next; i++; break;
      case '--to': defaults.to = next; i++; break;
      case '--policies': defaults.policies = next.split(',') as RsiPolicy[]; i++; break;
      case '--tickers': defaults.tickers = next; i++; break;
      case '--no-persist': defaults.persist = false; break;
      case '--force': defaults.force = true; break;
      case '--out-dir': defaults.outDir = path.resolve(next); i++; break;
    }
  }
  return defaults;
}

const DEFAULT_TICKERS: HistoricalTicker[] = [
  { market: 'OVERSEAS' as Market, exchangeCode: 'NASD', stockCode: 'TQQQ', stockName: 'ProShares UltraPro QQQ' },
  { market: 'OVERSEAS' as Market, exchangeCode: 'NASD', stockCode: 'QQQ', stockName: 'Invesco QQQ Trust' },
  { market: 'OVERSEAS' as Market, exchangeCode: 'AMEX', stockCode: 'SPY', stockName: 'SPDR S&P 500 ETF' },
  { market: 'OVERSEAS' as Market, exchangeCode: 'AMEX', stockCode: 'SOXL', stockName: 'Direxion Semiconductors Bull 3X' },
  { market: 'OVERSEAS' as Market, exchangeCode: 'AMEX', stockCode: 'FAS', stockName: 'Direxion Financials Bull 3X' },
  { market: 'DOMESTIC' as Market, exchangeCode: 'KRX', stockCode: '122630', stockName: 'KODEX 레버리지' },
  { market: 'DOMESTIC' as Market, exchangeCode: 'KRX', stockCode: '069500', stockName: 'KODEX 200' },
  { market: 'DOMESTIC' as Market, exchangeCode: 'KRX', stockCode: '005930', stockName: '삼성전자' },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = new Logger('BacktestCLI');

  logger.log(`Starting backtest: ${args.from} ~ ${args.to}, policies=[${args.policies.join(', ')}]`);

  const app = await NestFactory.createApplicationContext(BacktestModule, {
    logger: ['error', 'warn', 'log'],
  });

  const collector = app.get(HistoricalCollectorService);
  const strategy = app.get(InfiniteBuyStrategy);

  // 1. 티커 선정
  const tickers = args.tickers === 'overseas'
    ? DEFAULT_TICKERS.filter((t) => t.market === 'OVERSEAS')
    : args.tickers === 'domestic'
    ? DEFAULT_TICKERS.filter((t) => t.market === 'DOMESTIC')
    : DEFAULT_TICKERS;

  logger.log(`Collecting historical data for ${tickers.length} tickers...`);
  const dataMap = await collector.collectBatch(tickers, {
    from: args.from,
    to: args.to,
    persist: args.persist,
    force: args.force,
  });

  // 2. 각 티커 × 각 정책 조합 백테스트
  interface Row {
    ticker: string;
    market: Market;
    policy: RsiPolicy;
    metrics: BacktestMetrics;
    finalQty: number;
  }
  const rows: Row[] = [];
  let skipped = 0;

  for (const ticker of tickers) {
    const bars = dataMap.get(ticker.stockCode) ?? [];
    if (bars.length < 220) {
      logger.warn(`[${ticker.stockCode}] not enough data (${bars.length} bars), skipping`);
      skipped++;
      continue;
    }

    for (const policy of args.policies) {
      const isOverseas = ticker.market === 'OVERSEAS';
      // 티커별 quota 조정 — perCycleQuota가 최소 한 주를 살 수 있도록.
      // 고가 ETF(QQQ, SPY)는 최근 $400~600 수준이라 quota=40000 필요 (per-cycle=$1000).
      const quota = isOverseas
        ? (['QQQ', 'SPY'].includes(ticker.stockCode) ? 40000 : 8000)
        : 8_000_000;
      const startingCash = quota * 2.5;

      const res = await runBacktest(strategy, bars, {
        market: ticker.market,
        exchangeCode: ticker.exchangeCode,
        stockCode: ticker.stockCode,
        stockName: ticker.stockName,
        quota,
        maxCycles: 40,
        stopLossRate: 0.5,
        startingCash,
        strategyParams: { rsiPolicy: policy },
        warmupBars: 210,
      });

      // 마지막 날 mark-to-market으로 종가 평가
      const metrics = computeMetrics(res.dailyValues, res.trades, startingCash);
      rows.push({
        ticker: ticker.stockCode,
        market: ticker.market,
        policy,
        metrics,
        finalQty: res.finalPosition.quantity,
      });
      logger.log(
        `[${ticker.stockCode}/${policy}] Return ${(metrics.totalReturn * 100).toFixed(1)}%, ` +
        `CAGR ${(metrics.cagr * 100).toFixed(1)}%, MaxDD ${(metrics.maxDrawdown * 100).toFixed(1)}%, ` +
        `Sharpe ${metrics.sharpeRatio.toFixed(2)}, trades ${metrics.tradeCount}`,
      );
    }
  }

  // 3. 리포트 작성
  fs.mkdirSync(args.outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(args.outDir, `backtest-${timestamp}.md`);

  const md = buildReport({
    args,
    rows,
    skippedCount: skipped,
    tickerCount: tickers.length,
  });
  fs.writeFileSync(outPath, md, 'utf-8');
  logger.log(`Report written: ${outPath}`);

  await app.close();
}

function buildReport(opts: {
  args: CliArgs;
  rows: Array<{ ticker: string; market: Market; policy: RsiPolicy; metrics: BacktestMetrics; finalQty: number }>;
  skippedCount: number;
  tickerCount: number;
}): string {
  const { args, rows, skippedCount, tickerCount } = opts;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  const lines: string[] = [];
  lines.push(`# 무한매수법 RSI 정책 백테스트`);
  lines.push('');
  lines.push(`- **기간**: ${args.from} ~ ${args.to}`);
  lines.push(`- **정책**: ${args.policies.join(', ')}`);
  lines.push(`- **티커**: ${tickerCount}개 (${skippedCount}개 데이터 부족으로 제외)`);
  lines.push(`- **생성 시각**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 전체 결과');
  lines.push('');
  lines.push('| Ticker | Market | Policy | 총수익률 | CAGR | MaxDD | DD기간 | Sharpe | 거래횟수 | 승률 |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    lines.push(
      `| ${r.ticker} | ${r.market} | ${r.policy} | ${pct(r.metrics.totalReturn)} | ${pct(r.metrics.cagr)} | ` +
      `${pct(r.metrics.maxDrawdown)} | ${r.metrics.maxDrawdownDuration}일 | ${r.metrics.sharpeRatio.toFixed(2)} | ` +
      `${r.metrics.tradeCount} | ${pct(r.metrics.winRate)} |`
    );
  }
  lines.push('');

  // 정책별 집계
  lines.push('## 정책별 요약 (평균)');
  lines.push('');
  lines.push('| Policy | 평균 CAGR | 평균 MaxDD | 평균 Sharpe | 평균 거래횟수 |');
  lines.push('|---|---:|---:|---:|---:|');
  const policies = Array.from(new Set(rows.map((r) => r.policy)));
  for (const pol of policies) {
    const sub = rows.filter((r) => r.policy === pol);
    const avgCagr = sub.reduce((s, r) => s + r.metrics.cagr, 0) / sub.length;
    const avgMdd = sub.reduce((s, r) => s + r.metrics.maxDrawdown, 0) / sub.length;
    const avgSharpe = sub.reduce((s, r) => s + r.metrics.sharpeRatio, 0) / sub.length;
    const avgTrades = sub.reduce((s, r) => s + r.metrics.tradeCount, 0) / sub.length;
    lines.push(
      `| ${pol} | ${pct(avgCagr)} | ${pct(avgMdd)} | ${avgSharpe.toFixed(2)} | ${avgTrades.toFixed(0)} |`
    );
  }
  lines.push('');

  // 티커별 정책 비교
  lines.push('## 티커별 정책 비교 (CAGR)');
  lines.push('');
  const tickers = Array.from(new Set(rows.map((r) => r.ticker)));
  lines.push(`| Ticker | ${policies.join(' | ')} |`);
  lines.push(`|---|${policies.map(() => '---:').join('|')}|`);
  for (const ti of tickers) {
    const cells = policies.map((pol) => {
      const row = rows.find((r) => r.ticker === ti && r.policy === pol);
      return row ? pct(row.metrics.cagr) : '-';
    });
    lines.push(`| ${ti} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## 해석 가이드');
  lines.push('');
  lines.push('- **CAGR**: 연평균 복리 수익률. 높을수록 좋음.');
  lines.push('- **MaxDD**: 피크 대비 최대 낙폭. 절대값이 작을수록 좋음 (0에 가까울수록 안정).');
  lines.push('- **Sharpe**: 위험 대비 수익. >1.0이면 양호, >2.0이면 우수.');
  lines.push('- **거래횟수**: 전체 BUY + SELL 시그널 체결 수.');
  lines.push('');
  lines.push('**주의**: 이 백테스트는 일봉 기반이므로 장중 실제 체결과 차이가 있을 수 있음. 슬리피지 0.5% 가정.');

  return lines.join('\n') + '\n';
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
