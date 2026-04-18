/**
 * Pure metric computations for backtest results.
 *
 * Input convention:
 *   - dailyValues: portfolio value snapshot per trading day (chronological).
 *     dailyValues[0] = starting equity (start of first day, unchanged).
 *     dailyValues[i] = end-of-day i portfolio value (cash + mark-to-market positions).
 */

export interface BacktestTrade {
  date: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  reason?: string;
  pnl?: number; // realized PnL, only for SELL
}

export interface BacktestMetrics {
  startingEquity: number;
  endingEquity: number;
  totalReturn: number;    // decimal (0.35 = +35%)
  cagr: number;           // decimal annualized return
  volatilityAnnual: number; // decimal annualized stdev of daily returns
  sharpeRatio: number;    // assumes rf=0
  maxDrawdown: number;    // decimal (-0.3 means -30% at worst)
  maxDrawdownDuration: number; // days from peak to recovery (or end)
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  winRate: number;        // winning SELL trades / total SELL trades with pnl
  avgWin: number;
  avgLoss: number;
  profitFactor: number;   // sum(winPnl) / abs(sum(lossPnl))
  totalDays: number;
  tradingDays: number;
}

const TRADING_DAYS_PER_YEAR = 252;

export function computeMetrics(
  dailyValues: number[],
  trades: BacktestTrade[],
  startingEquity: number,
): BacktestMetrics {
  const N = dailyValues.length;
  const endingEquity = N > 0 ? dailyValues[N - 1] : startingEquity;
  const totalReturn = startingEquity > 0 ? endingEquity / startingEquity - 1 : 0;

  const years = Math.max(N / TRADING_DAYS_PER_YEAR, 1 / TRADING_DAYS_PER_YEAR);
  const cagr = startingEquity > 0 && endingEquity > 0
    ? (endingEquity / startingEquity) ** (1 / years) - 1
    : 0;

  // Daily returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < N; i++) {
    if (dailyValues[i - 1] > 0) {
      dailyReturns.push(dailyValues[i] / dailyValues[i - 1] - 1);
    }
  }
  const meanR = dailyReturns.length > 0
    ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length
    : 0;
  const varR = dailyReturns.length > 0
    ? dailyReturns.reduce((s, v) => s + (v - meanR) ** 2, 0) / dailyReturns.length
    : 0;
  const stdR = Math.sqrt(varR);
  const volatilityAnnual = stdR * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const sharpeRatio = stdR > 0 ? (meanR * TRADING_DAYS_PER_YEAR) / volatilityAnnual : 0;

  // Max drawdown
  let peak = dailyValues[0] ?? startingEquity;
  let maxDD = 0;
  let peakIdx = 0;
  let worstPeakIdx = 0;
  let worstTroughIdx = 0;
  for (let i = 0; i < N; i++) {
    if (dailyValues[i] > peak) {
      peak = dailyValues[i];
      peakIdx = i;
    }
    const dd = peak > 0 ? (dailyValues[i] - peak) / peak : 0;
    if (dd < maxDD) {
      maxDD = dd;
      worstPeakIdx = peakIdx;
      worstTroughIdx = i;
    }
  }
  // Duration: days from worst peak to recovery (or end)
  let recoveryIdx = N - 1;
  for (let i = worstTroughIdx + 1; i < N; i++) {
    if (dailyValues[i] >= dailyValues[worstPeakIdx]) {
      recoveryIdx = i;
      break;
    }
  }
  const maxDrawdownDuration = maxDD < 0 ? recoveryIdx - worstPeakIdx : 0;

  // Trade stats (only SELLs have PnL)
  const buyCount = trades.filter((t) => t.side === 'BUY').length;
  const sellCount = trades.filter((t) => t.side === 'SELL').length;
  const realizedSells = trades.filter((t) => t.side === 'SELL' && t.pnl !== undefined);
  const wins = realizedSells.filter((t) => (t.pnl ?? 0) > 0);
  const losses = realizedSells.filter((t) => (t.pnl ?? 0) < 0);
  const winRate = realizedSells.length > 0 ? wins.length / realizedSells.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0;
  const totalWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? Infinity : 0);

  return {
    startingEquity,
    endingEquity,
    totalReturn,
    cagr,
    volatilityAnnual,
    sharpeRatio,
    maxDrawdown: maxDD,
    maxDrawdownDuration,
    tradeCount: trades.length,
    buyCount,
    sellCount,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    totalDays: N,
    tradingDays: dailyReturns.length + 1,
  };
}

export function formatMetrics(m: BacktestMetrics): Record<string, string> {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  return {
    '기간': `${m.tradingDays}일`,
    '시작자본': m.startingEquity.toLocaleString(),
    '종료자본': m.endingEquity.toLocaleString(undefined, { maximumFractionDigits: 0 }),
    '총수익률': pct(m.totalReturn),
    'CAGR': pct(m.cagr),
    'Sharpe': m.sharpeRatio.toFixed(2),
    'MaxDD': pct(m.maxDrawdown),
    'DD기간(일)': String(m.maxDrawdownDuration),
    '연변동성': pct(m.volatilityAnnual),
    '거래횟수': String(m.tradeCount),
    '승률': pct(m.winRate),
    'ProfitFactor': isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞',
  };
}
