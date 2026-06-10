/**
 * Backtest CLI — standalone Nest app.
 *
 * 사용 예시:
 *   npm run backtest              # 기본: infinite-buy, 기본 티커 셋 + 기본 기간
 *   npm run backtest -- --from 20200101 --to 20251231 --policies none,legacy-hard,continuous
 *   npm run backtest -- --strategy momentum-breakout --from 20230601 --to 20260531 \
 *     --tickers 005930,122630,069500 --k 0.3,0.5,0.7 --stop-loss 0.02
 *
 * 결과: docs/backtest-reports/backtest-{timestamp}.md
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { Market } from '@prisma/client';
import { BacktestModule } from '../backtest.module';
import { HistoricalCollectorService, HistoricalTicker } from '../data/historical-collector.service';
import { InfiniteBuyStrategy } from '../../trading/strategy/infinite-buy.strategy';
import { MomentumBreakoutStrategy } from '../../trading/strategy/momentum-breakout.strategy';
import { RsiPolicy } from '../../trading/types';
import { runBacktest } from '../engine/backtest.engine';
import { computeMetrics, BacktestMetrics } from '../engine/metrics';
import * as fs from 'fs';
import * as path from 'path';

type BacktestStrategyName = 'infinite-buy' | 'momentum-breakout';

interface CliArgs {
  strategy: BacktestStrategyName;
  from: string;
  to: string;
  policies: RsiPolicy[];
  tickers?: string; // "overseas,domestic,all" 프리셋 또는 종목코드 csv (momentum)
  persist: boolean;
  force: boolean;
  outDir: string;
  // momentum-breakout 전용
  kValues: number[];
  stopLossRate: number;
  takeProfitRate?: number; // 지정 시 익절 활성화
  stopFill: 'low' | 'close';
  slippage?: number;
  sellTaxRate?: number; // 미지정 시 종목별 기본값 (ETF 0, 일반 주식 0.18%)
}

const BACKTEST_STRATEGIES: BacktestStrategyName[] = ['infinite-buy', 'momentum-breakout'];

/** 숫자 CLI 인자 검증 — NaN/범위 밖 값이 조용히 흘러들어 잘못된 리포트를 만들지 않게 한다 */
function parseRate(flag: string, raw: string | undefined, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${flag} 값이 잘못됐습니다: "${raw}" (허용 범위 ${min}~${max})`);
  }
  return value;
}

function parseKValues(raw: string | undefined): number[] {
  const values = (raw ?? '').split(',').map((token) => Number(token.trim()));
  if (values.length === 0 || values.some((k) => !Number.isFinite(k) || k <= 0 || k > 2)) {
    throw new Error(`--k 값이 잘못됐습니다: "${raw}" (예: --k 0.3,0.5,0.7 — 0 초과 2 이하)`);
  }
  return values;
}

function parseArgs(argv: string[]): CliArgs {
  const defaults: CliArgs = {
    strategy: 'infinite-buy',
    from: '20200101',
    to: '20251231',
    policies: ['none', 'continuous', 'hard-stop-70', 'hard-stop-75', 'hard-stop-80'],
    tickers: 'all',
    persist: true,
    force: false,
    outDir: path.resolve(process.cwd(), 'docs', 'backtest-reports'),
    kValues: [0.5],
    stopLossRate: 0.02,
    stopFill: 'low',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--strategy': defaults.strategy = next as BacktestStrategyName; i++; break;
      case '--from': defaults.from = next; i++; break;
      case '--to': defaults.to = next; i++; break;
      case '--policies': defaults.policies = next.split(',') as RsiPolicy[]; i++; break;
      case '--tickers': defaults.tickers = next; i++; break;
      case '--no-persist': defaults.persist = false; break;
      case '--force': defaults.force = true; break;
      case '--out-dir': defaults.outDir = path.resolve(next); i++; break;
      case '--k': defaults.kValues = parseKValues(next); i++; break;
      case '--stop-loss': defaults.stopLossRate = parseRate(arg, next, 0.001, 0.5); i++; break;
      case '--take-profit': defaults.takeProfitRate = parseRate(arg, next, 0.001, 1); i++; break;
      case '--stop-fill': defaults.stopFill = next === 'close' ? 'close' : 'low'; i++; break;
      case '--slippage': defaults.slippage = parseRate(arg, next, 0, 0.05); i++; break;
      case '--sell-tax': defaults.sellTaxRate = parseRate(arg, next, 0, 0.05); i++; break;
    }
  }
  if (!BACKTEST_STRATEGIES.includes(defaults.strategy)) {
    throw new Error(
      `--strategy 값이 잘못됐습니다: "${defaults.strategy}" (지원: ${BACKTEST_STRATEGIES.join(', ')})`,
    );
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

  const app = await NestFactory.createApplicationContext(BacktestModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    if (args.strategy === 'momentum-breakout') {
      await runMomentumBacktest(app, args, logger);
    } else {
      await runInfiniteBuyBacktest(app, args, logger);
    }
  } finally {
    await app.close();
  }
}

// ── infinite-buy (기존 경로 — 행동 보존) ─────────────────────

async function runInfiniteBuyBacktest(
  app: INestApplicationContext,
  args: CliArgs,
  logger: Logger,
): Promise<void> {
  logger.log(`Starting backtest: ${args.from} ~ ${args.to}, policies=[${args.policies.join(', ')}]`);

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
  const outPath = resolveReportPath(args.outDir);
  const md = buildReport({
    args,
    rows,
    skippedCount: skipped,
    tickerCount: tickers.length,
  });
  fs.writeFileSync(outPath, md, 'utf-8');
  logger.log(`Report written: ${outPath}`);
}

// ── momentum-breakout (당일청산 변동성 돌파) ──────────────────

/** 국내 데이트레이드 기본 비용 모델: 수수료 0.015% × 2 + 매도 거래세 (ETF는 면제) */
const MOMENTUM_BUY_FEE_RATE = 0.00015;
const MOMENTUM_SELL_FEE_RATE = 0.00015;
const MOMENTUM_STOCK_SELL_TAX_RATE = 0.0018;
const MOMENTUM_DEFAULT_SLIPPAGE = 0.002;
const MOMENTUM_QUOTA = 10_000_000;
const MOMENTUM_WARMUP_BARS = 30; // MA20 + RSI14면 충분 (MA200 불필요)

/** 증권거래세 면제 대상 KRX ETF (기본 티커 셋 한정 — 그 외 종목은 --sell-tax로 지정) */
const KRX_ETF_CODES = new Set(['069500', '122630']);

function resolveSellTaxRate(stockCode: string, override?: number): number {
  if (override !== undefined && Number.isFinite(override)) return override;
  return KRX_ETF_CODES.has(stockCode) ? 0 : MOMENTUM_STOCK_SELL_TAX_RATE;
}

function resolveMomentumTickers(tickersArg: string | undefined): HistoricalTicker[] {
  const domesticDefaults = DEFAULT_TICKERS.filter((t) => t.market === 'DOMESTIC');
  if (!tickersArg || ['all', 'domestic'].includes(tickersArg)) return domesticDefaults;
  if (tickersArg === 'overseas') {
    throw new Error('momentum-breakout은 국내 전용 전략입니다 (--tickers overseas 불가)');
  }

  // 종목코드 csv — 알려진 기본 티커면 이름 재사용, 아니면 KRX 종목으로 간주
  return tickersArg.split(',').map((raw) => {
    const code = raw.trim();
    const known = DEFAULT_TICKERS.find((t) => t.stockCode === code);
    if (known) {
      if (known.market !== 'DOMESTIC') {
        throw new Error(`momentum-breakout은 국내 전용 전략입니다 (${code}는 ${known.market})`);
      }
      return known;
    }
    return { market: 'DOMESTIC' as Market, exchangeCode: 'KRX', stockCode: code, stockName: code };
  });
}

async function runMomentumBacktest(
  app: INestApplicationContext,
  args: CliArgs,
  logger: Logger,
): Promise<void> {
  logger.log(
    `Starting momentum-breakout backtest: ${args.from} ~ ${args.to}, ` +
    `K=[${args.kValues.join(', ')}], stopLoss=${args.stopLossRate}, ` +
    `takeProfit=${args.takeProfitRate ?? 'off'}, stopFill=${args.stopFill}`,
  );

  const collector = app.get(HistoricalCollectorService);
  const strategy = app.get(MomentumBreakoutStrategy);
  const tickers = resolveMomentumTickers(args.tickers);

  logger.log(`Collecting historical data for ${tickers.length} tickers...`);
  const dataMap = await collector.collectBatch(tickers, {
    from: args.from,
    to: args.to,
    persist: args.persist,
    force: args.force,
  });

  interface MomentumRow {
    ticker: string;
    stockName: string;
    kValue: number;
    metrics: BacktestMetrics;
    totalPnl: number;
    avgPnlPerTrade: number;
  }
  const rows: MomentumRow[] = [];
  let skipped = 0;

  for (const ticker of tickers) {
    const bars = dataMap.get(ticker.stockCode) ?? [];
    if (bars.length < MOMENTUM_WARMUP_BARS + 10) {
      logger.warn(`[${ticker.stockCode}] not enough data (${bars.length} bars), skipping`);
      skipped++;
      continue;
    }

    const sellTaxRate = resolveSellTaxRate(ticker.stockCode, args.sellTaxRate);

    for (const kValue of args.kValues) {
      const res = await runBacktest(strategy, bars, {
        market: ticker.market,
        exchangeCode: ticker.exchangeCode,
        stockCode: ticker.stockCode,
        stockName: ticker.stockName,
        quota: MOMENTUM_QUOTA,
        maxCycles: 40, // momentum은 사용하지 않지만 엔진 계약상 필요
        stopLossRate: args.stopLossRate,
        startingCash: MOMENTUM_QUOTA,
        warmupBars: MOMENTUM_WARMUP_BARS,
        indicatorLag: 1, // 진입 필터(MA20/RSI)는 전일까지의 지표로 — lookahead 제거
        slippageRate: args.slippage ?? MOMENTUM_DEFAULT_SLIPPAGE,
        feeConfig: {
          buyFeeRate: MOMENTUM_BUY_FEE_RATE,
          sellFeeRate: MOMENTUM_SELL_FEE_RATE,
          sellTaxRate,
        },
        stopFill: args.stopFill,
        strategyParams: {
          kValue,
          stopLossRate: args.stopLossRate,
          ...(args.takeProfitRate !== undefined
            ? { takeProfitEnabled: true, takeProfitRate: args.takeProfitRate }
            : {}),
        },
      });

      const metrics = computeMetrics(res.dailyValues, res.trades, MOMENTUM_QUOTA);
      const totalPnl = res.trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const avgPnlPerTrade = metrics.sellCount > 0 ? totalPnl / metrics.sellCount : 0;
      rows.push({
        ticker: ticker.stockCode,
        stockName: ticker.stockName ?? ticker.stockCode,
        kValue,
        metrics,
        totalPnl,
        avgPnlPerTrade,
      });
      logger.log(
        `[${ticker.stockCode}/K=${kValue}] Return ${(metrics.totalReturn * 100).toFixed(1)}%, ` +
        `MaxDD ${(metrics.maxDrawdown * 100).toFixed(1)}%, trades ${metrics.sellCount}, ` +
        `winRate ${(metrics.winRate * 100).toFixed(1)}%, avgPnL ${avgPnlPerTrade.toFixed(0)}`,
      );
    }
  }

  const outPath = resolveReportPath(args.outDir);
  const md = buildMomentumReport({ args, rows, skippedCount: skipped, tickerCount: tickers.length });
  fs.writeFileSync(outPath, md, 'utf-8');
  logger.log(`Report written: ${outPath}`);
}

function buildMomentumReport(opts: {
  args: CliArgs;
  rows: Array<{
    ticker: string;
    stockName: string;
    kValue: number;
    metrics: BacktestMetrics;
    totalPnl: number;
    avgPnlPerTrade: number;
  }>;
  skippedCount: number;
  tickerCount: number;
}): string {
  const { args, rows, skippedCount, tickerCount } = opts;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

  const lines: string[] = [];
  lines.push('# 변동성 돌파 (당일청산) 백테스트');
  lines.push('');
  lines.push(`- **기간**: ${args.from} ~ ${args.to}`);
  lines.push(`- **K값**: ${args.kValues.join(', ')}`);
  lines.push(`- **손절률**: ${pct(args.stopLossRate)} / **익절**: ${args.takeProfitRate !== undefined ? pct(args.takeProfitRate) : '비활성 (종가 청산)'}`);
  lines.push(`- **손절 판정**: ${args.stopFill === 'low' ? 'low 터치 기반 (보수적)' : 'close 기반 (낙관적)'}`);
  lines.push(`- **비용 모델**: 수수료 ${pct(MOMENTUM_BUY_FEE_RATE)}×2 + 거래세 ${args.sellTaxRate !== undefined ? pct(args.sellTaxRate) : `종목별 (ETF 0%, 주식 ${pct(MOMENTUM_STOCK_SELL_TAX_RATE)})`}, 슬리피지 ${pct(args.slippage ?? MOMENTUM_DEFAULT_SLIPPAGE)}`);
  lines.push(`- **1회 투입금**: ${won(MOMENTUM_QUOTA)}`);
  lines.push(`- **티커**: ${tickerCount}개 (${skippedCount}개 데이터 부족으로 제외)`);
  lines.push(`- **생성 시각**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 전체 결과');
  lines.push('');
  lines.push('| Ticker | K | 총수익률 | CAGR | MaxDD | Sharpe | 거래수 | 승률 | 손익비 | 거래당 평균손익 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const payoff = r.metrics.avgLoss !== 0 ? Math.abs(r.metrics.avgWin / r.metrics.avgLoss) : 0;
    lines.push(
      `| ${r.ticker} | ${r.kValue} | ${pct(r.metrics.totalReturn)} | ${pct(r.metrics.cagr)} | ` +
      `${pct(r.metrics.maxDrawdown)} | ${r.metrics.sharpeRatio.toFixed(2)} | ${r.metrics.sellCount} | ` +
      `${pct(r.metrics.winRate)} | ${payoff.toFixed(2)} | ${won(r.avgPnlPerTrade)} |`,
    );
  }
  lines.push('');

  // K별 집계
  const kValues = Array.from(new Set(rows.map((r) => r.kValue)));
  if (kValues.length > 1) {
    lines.push('## K값별 요약 (평균)');
    lines.push('');
    lines.push('| K | 평균 총수익률 | 평균 MaxDD | 평균 승률 | 평균 거래수 |');
    lines.push('|---:|---:|---:|---:|---:|');
    for (const k of kValues) {
      const sub = rows.filter((r) => r.kValue === k);
      const avg = (fn: (r: typeof rows[number]) => number) => sub.reduce((s, r) => s + fn(r), 0) / sub.length;
      lines.push(
        `| ${k} | ${pct(avg((r) => r.metrics.totalReturn))} | ${pct(avg((r) => r.metrics.maxDrawdown))} | ` +
        `${pct(avg((r) => r.metrics.winRate))} | ${avg((r) => r.metrics.sellCount).toFixed(0)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## 해석 가이드 / 한계');
  lines.push('');
  lines.push('- **승률 × 손익비**: 변동성 돌파는 승률 40~55% + 손익비 > 1 조합이 일반적. 거래당 평균손익이 양수인지가 핵심.');
  lines.push('- **거래비용**: 당일청산 왕복 비용(수수료+거래세+슬리피지)이 이미 반영됨 — 거래당 평균손익은 net 기준.');
  lines.push('- **일봉 근사 한계**: 트레일링 스탑 미반영 (장중 고가 경로 미상), 손절 체결은 터치 기반 근사,');
  lines.push('  실거래의 soft 조건(시간보정 거래량/VWAP/수급)은 lookahead 방지를 위해 백테스트에서 미적용.');
  lines.push('  → 실거래 신호는 백테스트보다 적고 보수적이다. 최종 검증은 시뮬레이션(페이퍼)으로 수행할 것.');

  return lines.join('\n') + '\n';
}

// ── 공통 ─────────────────────────────────────────────────────

function resolveReportPath(outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(outDir, `backtest-${timestamp}.md`);
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
