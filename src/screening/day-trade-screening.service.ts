import { Injectable, Logger } from '@nestjs/common';
import { Market, Prisma, SimulationStatus } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { SimulationSessionManager } from '../simulation/simulation-session-manager.service';
import { SlackService } from '../notification/slack.service';
import { PrismaService } from '../prisma.service';
import {
  buildDayTradeScore,
  computeDayTradeIndicators,
  DAY_TRADE_SEED_ETFS,
  isStrictKrxEtf,
  rankDayTradeCandidates,
} from './day-trade-selector';
import { kstDateNDaysAgo, kstTodayStr } from './utils/date.util';
import {
  DayTradeCandidateScore,
  DayTradeRunResult,
  DayTradeScreeningSettings,
} from './types/day-trade.type';

const DAY_TRADE_SETTINGS_KEY = 'day-trade-screening';
const DAY_TRADE_STRATEGY_NAME = 'momentum-breakout';
const DAILY_PRICE_LOOKBACK_DAYS = 60; // 달력일 기준 — 거래일 ~40개 확보 (MA20+ATR14에 충분)
const DEFAULT_SETTINGS: DayTradeScreeningSettings = {
  enabled: true,
  topN: 3,
  simCapital: 2_000_000,
};

/**
 * 당일청산(변동성 돌파) 후보 선정 파이프라인.
 * 매 거래일 08:30 KST — 전일 확정 일봉 기준으로 거래세 면제 ETF를 필터/점수화하고
 * 상위 후보를 시뮬레이션 세션에 자동 투입한다. 실거래 등록은 수동.
 */
@Injectable()
export class DayTradeScreeningService {
  private readonly logger = new Logger(DayTradeScreeningService.name);

  constructor(
    private readonly kisDomestic: KisDomesticService,
    private readonly sessionManager: SimulationSessionManager,
    private readonly slackService: SlackService,
    private readonly prisma: PrismaService,
  ) {}

  async runDailySelection(date: string = kstTodayStr()): Promise<DayTradeRunResult> {
    const settings = await this.getSettings();
    if (!settings.enabled) {
      return {
        skipped: true,
        skipReason: '데이트레이드 스크리닝이 비활성화되어 있습니다.',
        saved: 0,
        simulated: 0,
      };
    }

    const warnings = await this.completePreviousSessions(date);
    const universe = await this.collectUniverse();
    if (universe.length === 0) {
      return { skipped: true, skipReason: '평가할 ETF 유니버스가 비어 있습니다.', saved: 0, simulated: 0 };
    }

    const scores = await this.evaluateUniverse(universe, date);
    const ranked = rankDayTradeCandidates(scores);
    await this.saveCandidates(date, ranked);

    const passing = ranked.filter((s) => !s.excluded);
    const targets = passing.slice(0, settings.topN);
    const simulatedCodes = await this.feedSimulations(date, targets, settings.simCapital);

    await this.notify(date, ranked, simulatedCodes, warnings);

    return {
      skipped: false,
      saved: ranked.length,
      simulated: simulatedCodes.size,
      topStockName: passing[0]?.stockName,
    };
  }

  private async getSettings(): Promise<DayTradeScreeningSettings> {
    try {
      const saved = await this.prisma.appSetting.findUnique({
        where: { key: DAY_TRADE_SETTINGS_KEY },
      });
      const value = (saved?.value as Partial<DayTradeScreeningSettings>) ?? {};
      return {
        enabled: value.enabled ?? DEFAULT_SETTINGS.enabled,
        topN: value.topN && value.topN > 0 ? Math.floor(value.topN) : DEFAULT_SETTINGS.topN,
        simCapital:
          value.simCapital && value.simCapital > 0 ? value.simCapital : DEFAULT_SETTINGS.simCapital,
      };
    } catch (e) {
      this.logger.warn(`day-trade 설정 로드 실패, 기본값 사용: ${e.message}`);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * 전일 [DT] 세션 정리.
   * 포지션이 없으면 COMPLETED, 남아 있으면 전략의 이월청산 안전망이 동작하도록
   * RUNNING을 유지하고 경고만 남긴다. 오늘 생성분(screeningDate === date)은 건드리지 않는다.
   */
  private async completePreviousSessions(date: string): Promise<string[]> {
    const warnings: string[] = [];
    try {
      const sessions = await this.prisma.simulationSession.findMany({
        where: {
          strategyName: DAY_TRADE_STRATEGY_NAME,
          status: SimulationStatus.RUNNING,
          strategyParams: { path: ['dayTradeAuto'], equals: true },
        },
        include: { positions: true },
      });

      for (const session of sessions) {
        const params = (session.strategyParams as Record<string, any>) ?? {};
        if (params.screeningDate === date) continue;

        const hasOpenPosition = session.positions.some((p) => p.quantity > 0);
        if (hasOpenPosition) {
          warnings.push(
            `[DT] ${session.stockName}(${session.stockCode}) 전일 세션에 포지션이 남아 RUNNING 유지 (이월청산 대기)`,
          );
          continue;
        }
        await this.sessionManager.updateStatus(session.id, SimulationStatus.COMPLETED);
        this.logger.log(`[DT] 전일 시뮬 세션 종료: ${session.name}`);
      }
    } catch (e) {
      warnings.push(`전일 세션 정리 실패: ${e.message}`);
      this.logger.warn(`[DT] 전일 세션 정리 실패: ${e.message}`);
    }
    return warnings;
  }

  /** 시드 ETF ∪ 랭킹 내 strict ETF. 08:30 랭킹이 전일 기준/빈 응답이어도 시드가 안전망 */
  private async collectUniverse(): Promise<{ stockCode: string; stockName: string }[]> {
    const byCode = new Map<string, string>();
    for (const seed of DAY_TRADE_SEED_ETFS) byCode.set(seed.stockCode, seed.stockName);

    const rankings = await Promise.allSettled([
      this.kisDomestic.getVolumeRanking(),
      this.kisDomestic.getFluctuationRanking(),
    ]);
    const labels = ['volume rank', 'fluctuation rank'];
    rankings.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.warn(`[DT] ${labels[i]} 조회 실패: ${result.reason?.message ?? result.reason}`);
        return;
      }
      for (const item of result.value ?? []) {
        const code = item.mksc_shrn_iscd;
        const name = item.hts_kor_isnm || code;
        if (!code || byCode.has(code)) continue;
        if (!isStrictKrxEtf(name, code)) continue;
        byCode.set(code, name);
      }
    });

    return [...byCode.entries()].map(([stockCode, stockName]) => ({ stockCode, stockName }));
  }

  private async evaluateUniverse(
    universe: { stockCode: string; stockName: string }[],
    date: string,
  ): Promise<DayTradeCandidateScore[]> {
    const scores: DayTradeCandidateScore[] = [];
    const from = kstDateNDaysAgo(DAILY_PRICE_LOOKBACK_DAYS);

    for (const item of universe) {
      try {
        const prices = await this.kisDomestic.getDailyPrices(item.stockCode, from, date);
        const indicators = computeDayTradeIndicators(prices, date);
        if (!indicators) {
          // 봉 부족은 하드필터 탈락이 아닌 평가 전제조건 미달 — DB 저장 없이 로그로만 추적
          this.logger.log(`[${item.stockCode}] ${item.stockName} 확정 일봉 부족으로 평가 제외`);
          continue;
        }
        await this.sleep(60); // KIS rate limit
        const price = await this.kisDomestic.getPrice(item.stockCode);
        scores.push(
          buildDayTradeScore(item.stockCode, price.stockName || item.stockName, indicators, {
            investCautionYn: price.investCautionYn,
            shortOverheatYn: price.shortOverheatYn,
            marketWarnCode: price.marketWarnCode,
          }),
        );
      } catch (e) {
        this.logger.warn(`[${item.stockCode}] 데이트레이드 평가 실패: ${e.message}`);
      }
      await this.sleep(60); // KIS rate limit
    }
    return scores;
  }

  private async saveCandidates(date: string, ranked: DayTradeCandidateScore[]): Promise<void> {
    for (const c of ranked) {
      const payload = {
        stockName: c.stockName,
        rank: c.rank,
        score: new Prisma.Decimal(c.score.toFixed(2)),
        prevRangePct: new Prisma.Decimal(c.indicators.prevRangePct.toFixed(4)),
        atrPct: new Prisma.Decimal(c.indicators.atrPct.toFixed(4)),
        avgTradeValue20d: BigInt(Math.round(c.indicators.avgTradeValue20d)),
        aboveMa20: c.indicators.aboveMa20,
        excluded: c.excluded,
        excludeReason: c.excludeReason ?? null,
        indicators: c.indicators as unknown as Prisma.InputJsonValue,
      };
      await this.prisma.dayTradeCandidate.upsert({
        where: {
          screeningDate_market_stockCode: {
            screeningDate: date,
            market: Market.DOMESTIC,
            stockCode: c.stockCode,
          },
        },
        update: payload,
        create: {
          screeningDate: date,
          market: Market.DOMESTIC,
          exchangeCode: c.exchangeCode,
          stockCode: c.stockCode,
          ...payload,
        },
      });
    }
  }

  /** 상위 후보를 시뮬 세션으로 투입. 같은 날 같은 종목 세션이 있으면 재사용 (멱등) */
  private async feedSimulations(
    date: string,
    targets: DayTradeCandidateScore[],
    simCapital: number,
  ): Promise<Set<string>> {
    const simulated = new Set<string>();
    for (const target of targets) {
      try {
        const existing = await this.prisma.simulationSession.findFirst({
          where: {
            stockCode: target.stockCode,
            strategyName: DAY_TRADE_STRATEGY_NAME,
            strategyParams: { path: ['screeningDate'], equals: date },
          },
          select: { id: true },
        });

        let sessionId: string;
        if (existing) {
          sessionId = existing.id;
        } else {
          const session = await this.sessionManager.createSession({
            name: `[DT] ${date} ${target.stockName}`,
            description: '데이트레이드 스크리닝 자동 투입 (페이퍼 검증용)',
            market: Market.DOMESTIC,
            exchangeCode: 'KRX',
            stockCode: target.stockCode,
            stockName: target.stockName,
            strategyName: DAY_TRADE_STRATEGY_NAME,
            quota: simCapital,
            strategyParams: JSON.stringify({ dayTradeAuto: true, screeningDate: date }),
          });
          sessionId = session.id;
          this.logger.log(`[DT] 시뮬 세션 생성: [DT] ${date} ${target.stockName}`);
        }

        await this.prisma.dayTradeCandidate.update({
          where: {
            screeningDate_market_stockCode: {
              screeningDate: date,
              market: Market.DOMESTIC,
              stockCode: target.stockCode,
            },
          },
          data: { simulationSessionId: sessionId },
        });
        simulated.add(target.stockCode);
      } catch (e) {
        this.logger.warn(`[${target.stockCode}] 시뮬 투입 실패: ${e.message}`);
      }
    }
    return simulated;
  }

  private async notify(
    date: string,
    ranked: DayTradeCandidateScore[],
    simulatedCodes: Set<string>,
    warnings: string[],
  ): Promise<void> {
    try {
      const passing = ranked.filter((s) => !s.excluded);
      const seedCodes = new Set(DAY_TRADE_SEED_ETFS.map((s) => s.stockCode));
      const excludedNotables = ranked
        .filter((s) => s.excluded && seedCodes.has(s.stockCode))
        .map((s) => ({ stockName: s.stockName, reason: s.excludeReason ?? '기준 미달' }));

      await this.slackService.sendDayTradeCandidates({
        date,
        candidates: passing.map((s) => ({
          stockCode: s.stockCode,
          stockName: s.stockName,
          rank: s.rank,
          score: s.score,
          prevRangePct: s.indicators.prevRangePct,
          atrPct: s.indicators.atrPct,
          avgTradeValue20d: s.indicators.avgTradeValue20d,
          simulated: simulatedCodes.has(s.stockCode),
        })),
        excluded: excludedNotables,
        warnings,
      });
    } catch (e) {
      this.logger.warn(`[DT] Slack 리포트 전송 실패: ${e.message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
