import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StockScore, SuggestedStrategy, detectEtf } from './types';

const MAX_SCREENING_RESULTS = 20;
const MAX_SCREENING_ETFS = 5;
const EXCHANGE_TO_COUNTRY: Record<string, { code: string; label: string }> = {
  KRX: { code: 'KR', label: '한국' },
  NASD: { code: 'US', label: '미국' },
  NYSE: { code: 'US', label: '미국' },
  AMEX: { code: 'US', label: '미국' },
  SEHK: { code: 'HK', label: '홍콩' },
  SHAA: { code: 'CN', label: '중국' },
  SZAA: { code: 'CN', label: '중국' },
  TKSE: { code: 'JP', label: '일본' },
  HASE: { code: 'VN', label: '베트남' },
  VNSE: { code: 'VN', label: '베트남' },
};
const COUNTRY_TO_EXCHANGES = Object.entries(EXCHANGE_TO_COUNTRY).reduce<Record<string, string[]>>(
  (acc, [exchangeCode, country]) => {
    if (!acc[country.code]) acc[country.code] = [];
    acc[country.code].push(exchangeCode);
    return acc;
  },
  {},
);

export function pickRecommendationsForStorage(
  scores: StockScore[],
  maxTotal = MAX_SCREENING_RESULTS,
  maxEtf = MAX_SCREENING_ETFS,
): StockScore[] {
  const normalizedScores = scores.map((item) => ({
    ...item,
    isEtf: item.isEtf || detectEtf(item.stockName, item.stockCode),
  }));

  const sortedStocks = normalizedScores
    .filter((item) => !item.isEtf)
    .sort((a, b) => b.totalScore - a.totalScore);
  const sortedEtfs = normalizedScores
    .filter((item) => item.isEtf)
    .sort((a, b) => b.totalScore - a.totalScore);

  const selectedEtfs = sortedEtfs.slice(0, maxEtf);
  const stockSlots = Math.max(0, maxTotal - selectedEtfs.length);
  const selectedStocks = sortedStocks.slice(0, stockSlots);

  return [...selectedStocks, ...selectedEtfs]
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, maxTotal);
}

/**
 * 전략 이름 필터 콜백 타입.
 * `StrategyRegistry`에서 실행 가능한 전략만 남기도록 facade 단에서 주입.
 */
export type StrategyFilter = (strategies: SuggestedStrategy[]) => SuggestedStrategy[];

/**
 * 스크리닝 결과/딥분석 레코드 저장/조회 전용 서비스.
 * 점수 계산·지표 산출은 수행하지 않고 Prisma CRUD만 담당한다.
 */
@Injectable()
export class ScreeningRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveResults(
    date: string,
    scores: StockScore[],
    filterExecutableStrategies: StrategyFilter,
  ): Promise<void> {
    if (scores.length === 0) return;

    const market = scores[0].market;
    const exchangeCodes = [...new Set(scores.map((item) => item.exchangeCode))];
    const existingRows = await this.prisma.stockRecommendation.findMany({
      where: {
        screeningDate: date,
        market: market as any,
        exchangeCode: { in: exchangeCodes },
      },
      select: {
        exchangeCode: true,
        stockCode: true,
        deepAnalysisId: true,
        deepAnalysisStatus: true,
        deepAnalysisMessage: true,
        deepAnalysisUpdatedAt: true,
      },
    });
    const existingDeepAnalysisMap = new Map(
      existingRows.map((row) => [
        `${row.exchangeCode}:${row.stockCode}`,
        row,
      ]),
    );

    await this.prisma.stockRecommendation.deleteMany({
      where: {
        screeningDate: date,
        market: market as any,
        exchangeCode: { in: exchangeCodes },
      },
    });

    const selected = pickRecommendationsForStorage(scores);
    for (let index = 0; index < selected.length; index++) {
      const item = selected[index];
      const isEtf = item.isEtf || detectEtf(item.stockName, item.stockCode);
      const existingAnalysis = existingDeepAnalysisMap.get(`${item.exchangeCode}:${item.stockCode}`);
      const hasCompletedDeepAnalysis = existingAnalysis?.deepAnalysisId && existingAnalysis.deepAnalysisStatus === 'SUCCESS';

      await this.prisma.stockRecommendation.create({
        data: {
          screeningDate: date,
          market: item.market,
          exchangeCode: item.exchangeCode,
          stockCode: item.stockCode,
          stockName: item.stockName,
          totalScore: item.totalScore,
          trendScore: item.trendScore,
          timingScore: item.timingScore,
          fundamentalScore: item.fundamentalScore,
          riskSupplyScore: item.riskSupplyScore,
          rank: index + 1,
          reasons: item.reasons as any,
          indicators: item.indicators as any,
          suggestedStrategies: filterExecutableStrategies(item.suggestedStrategies) as any,
          currentPrice: item.currentPrice,
          changeRate: item.changeRate,
          volume: item.volume,
          marketCap: item.marketCap,
          isEtf,
          factorScores: (item.factorScores ?? null) as any,
          deepAnalysisId: hasCompletedDeepAnalysis ? existingAnalysis.deepAnalysisId : item.deepAnalysisId,
          deepAnalysisStatus: hasCompletedDeepAnalysis ? 'SUCCESS' : 'PENDING',
          deepAnalysisMessage: hasCompletedDeepAnalysis
            ? existingAnalysis.deepAnalysisMessage
            : '딥 분석 대기 중입니다.',
          deepAnalysisUpdatedAt: hasCompletedDeepAnalysis
            ? existingAnalysis.deepAnalysisUpdatedAt
            : new Date(),
        },
      });
    }
  }

  async getLatestRecommendationDate(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCodes?: string[],
  ): Promise<string | null> {
    const latest = await this.prisma.stockRecommendation.findFirst({
      where: {
        market: market as any,
        ...(exchangeCodes?.length ? { exchangeCode: { in: exchangeCodes } } : {}),
      },
      orderBy: [
        { screeningDate: 'desc' },
        { createdAt: 'desc' },
      ],
      select: { screeningDate: true },
    });
    return latest?.screeningDate ?? null;
  }

  async getRecommendations(
    date: string,
    market: string | undefined,
    country: string | undefined,
    limit: number,
    filterExecutableStrategies: StrategyFilter,
  ) {
    const exchangeCodes = country ? COUNTRY_TO_EXCHANGES[country] ?? [] : undefined;
    const rows = await this.prisma.stockRecommendation.findMany({
      where: {
        screeningDate: date,
        ...(market ? { market: market as any } : {}),
        ...(country ? { exchangeCode: { in: exchangeCodes } } : {}),
      },
      orderBy: [
        { totalScore: 'desc' },
        { createdAt: 'asc' },
      ],
      take: limit > 0 ? limit : undefined,
    });
    return rows.map((row, index) => ({
      ...row,
      rank: index + 1,
      suggestedStrategies: filterExecutableStrategies(
        (row.suggestedStrategies as SuggestedStrategy[] | null) ?? [],
      ),
    }));
  }

  async getScreeningDates(limit = 10) {
    const results = await this.prisma.stockRecommendation.findMany({
      select: { screeningDate: true },
      distinct: ['screeningDate'],
      orderBy: { screeningDate: 'desc' },
      take: limit,
    });
    return results.map((item) => item.screeningDate);
  }

  async getScreeningDateSummaries(limit = 10) {
    const dates = await this.getScreeningDates(limit);
    if (dates.length === 0) return [];

    const rows = await this.prisma.stockRecommendation.groupBy({
      by: ['screeningDate', 'exchangeCode'],
      where: { screeningDate: { in: dates } },
      _count: true,
      _avg: { totalScore: true },
    });

    return dates.map((date) => {
      const dateRows = rows.filter((row) => row.screeningDate === date);
      const countryMap = new Map<string, { label: string; count: number; totalScore: number }>();

      for (const row of dateRows) {
        const country = EXCHANGE_TO_COUNTRY[row.exchangeCode] || { code: row.exchangeCode, label: row.exchangeCode };
        const existing = countryMap.get(country.code) || { label: country.label, count: 0, totalScore: 0 };
        existing.count += row._count;
        existing.totalScore += (row._avg.totalScore?.toNumber() ?? 0) * row._count;
        countryMap.set(country.code, existing);
      }

      const countries = [...countryMap.entries()].map(([code, value]) => ({
        country: code,
        label: value.label,
        count: value.count,
        avgScore: value.count > 0 ? value.totalScore / value.count : 0,
      }));

      return {
        date,
        countries,
        totalCount: countries.reduce((sum, item) => sum + item.count, 0),
      };
    });
  }

  async getStockDeepAnalysis(date: string, stockCode: string, exchangeCode?: string) {
    return this.prisma.stockDeepAnalysis.findFirst({
      where: {
        screeningDate: date,
        stockCode,
        ...(exchangeCode ? { exchangeCode } : {}),
      },
    });
  }

  // ──────────────────────────────────────────────────────────
  // 딥 분석 전용 CRUD (runDeepAnalysisForMarket에서 호출)
  // ──────────────────────────────────────────────────────────

  async loadRecommendationsForDeepAnalysis(
    date: string,
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCodes?: string[],
  ) {
    return this.prisma.stockRecommendation.findMany({
      where: {
        screeningDate: date,
        market: market as any,
        ...(exchangeCodes?.length ? { exchangeCode: { in: exchangeCodes } } : {}),
      },
      orderBy: { rank: 'asc' },
      take: MAX_SCREENING_RESULTS,
    });
  }

  async resetDeepAnalysisForRecommendations(
    date: string,
    recommendations: { id: string; exchangeCode: string; stockCode: string }[],
  ): Promise<void> {
    const targetKeys = recommendations.map((recommendation) => ({
      screeningDate: date,
      exchangeCode: recommendation.exchangeCode,
      stockCode: recommendation.stockCode,
    }));

    await this.prisma.stockDeepAnalysis.deleteMany({
      where: {
        OR: targetKeys,
      },
    });

    await this.prisma.stockRecommendation.updateMany({
      where: {
        id: { in: recommendations.map((recommendation) => recommendation.id) },
      },
      data: {
        deepAnalysisId: null,
        deepAnalysisStatus: 'PENDING',
        deepAnalysisMessage: '딥 분석 대기 중입니다.',
        deepAnalysisUpdatedAt: new Date(),
      },
    });
  }

  async upsertDeepAnalysis(date: string, recommendation: any, analysis: any) {
    const payload = this.buildDeepAnalysisUpsert(date, recommendation, analysis);
    return this.prisma.stockDeepAnalysis.upsert({
      where: {
        screeningDate_exchangeCode_stockCode: {
          screeningDate: date,
          exchangeCode: recommendation.exchangeCode,
          stockCode: recommendation.stockCode,
        },
      },
      update: payload,
      create: payload,
    });
  }

  async applyDeepAnalysisSuccess(
    recommendationId: string,
    deepAnalysisId: string,
    reportSummary: string,
    isEtf: boolean,
    mergedIndicators: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.stockRecommendation.update({
      where: { id: recommendationId },
      data: {
        deepAnalysisId,
        deepAnalysisStatus: 'SUCCESS',
        deepAnalysisMessage: reportSummary || '딥 분석이 완료되었습니다.',
        deepAnalysisUpdatedAt: new Date(),
        isEtf,
        indicators: mergedIndicators as any,
      },
    });
  }

  async applyDeepAnalysisFailure(
    recommendationId: string,
    message: string,
    isEtf: boolean,
  ): Promise<void> {
    await this.prisma.stockRecommendation.update({
      where: { id: recommendationId },
      data: {
        deepAnalysisId: null,
        deepAnalysisStatus: 'FAILED',
        deepAnalysisMessage: message,
        deepAnalysisUpdatedAt: new Date(),
        isEtf,
      },
    });
  }

  /**
   * 딥 분석 결과의 에러 메시지를 DB 컬럼 한도에 맞게 정리.
   */
  formatDeepAnalysisErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error ?? '알 수 없는 오류');
    const normalized = raw
      .replace(/\s+/g, ' ')
      .replace(/^Error:\s*/i, '')
      .trim();

    if (normalized.length <= 220) return normalized;
    return `${normalized.slice(0, 217)}...`;
  }

  private buildDeepAnalysisUpsert(date: string, recommendation: any, analysis: any) {
    const targetUpside =
      analysis.dcfValuation?.currentPrice && analysis.consensusData?.targetPrice
        ? ((analysis.consensusData.targetPrice - analysis.dcfValuation.currentPrice) /
            analysis.dcfValuation.currentPrice) *
          100
        : null;

    return {
      screeningDate: date,
      stockCode: recommendation.stockCode,
      stockName: recommendation.stockName,
      exchangeCode: recommendation.exchangeCode,
      market: recommendation.market,
      intrinsicValue: analysis.dcfValuation?.intrinsicValue ?? null,
      marginOfSafety: this.clampDbPercent(analysis.dcfValuation?.marginOfSafety),
      dcfDetail: analysis.dcfValuation ?? null,
      riskGrade: analysis.riskProfile?.riskGrade ?? null,
      volatility30d: analysis.riskProfile?.volatility30d ?? null,
      maxDrawdown90d: analysis.riskProfile?.maxDrawdown90d ?? null,
      riskDetail: analysis.riskProfile ?? null,
      trendDirection: analysis.technicalDetail?.trendDirection ?? null,
      technicalDetail: analysis.technicalDetail ?? null,
      dividendYield: analysis.dividendAnalysis?.currentYield ?? null,
      consecutiveDividendYears: analysis.dividendAnalysis?.consecutiveDividendYears ?? null,
      dividendDetail: analysis.dividendAnalysis ?? null,
      targetPrice: analysis.consensusData?.targetPrice ?? null,
      targetUpside: this.clampDbPercent(targetUpside),
      consensusRating: analysis.consensusData?.rating ?? null,
      consensusDetail: analysis.consensusData ?? null,
      reportSummary: analysis.reportSummary ?? null,
    };
  }

  private clampDbPercent(value: number | null | undefined): number | null {
    if (!Number.isFinite(value)) return null;

    const numericValue = value as number;
    const maxAbs = 9999.9999;
    return Math.max(-maxAbs, Math.min(maxAbs, numericValue));
  }
}
