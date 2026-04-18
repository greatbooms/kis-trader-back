import { Injectable, Logger } from '@nestjs/common';
import { ScreeningCandidateCollector } from './screening-candidate-collector.service';
import { ScreeningAnalyzer } from './screening-analyzer.service';
import { ScreeningRepository } from './screening-repository.service';
import { DeepAnalysisService } from './deep-analysis.service';
import { StockScore, ScreeningMode, detectEtf } from './types';

// 기존 외부 import 호환성을 위해 재노출한다.
export { pickRecommendationsForStorage } from './screening-repository.service';

const MAX_DOMESTIC_ANALYSIS_CANDIDATES = 30;
const MAX_OVERSEAS_ANALYSIS_CANDIDATES = 25;

/**
 * Screening 모듈의 public 파사드.
 *
 * 기존 `ScreeningService`의 공개 메서드 시그니처를 보존하기 위해 존재하며,
 * 실제 로직은 아래 전용 서비스에 위임한다:
 * - {@link ScreeningCandidateCollector} — 후보 종목 수집
 * - {@link ScreeningAnalyzer} — 다중 요인 점수 + 전략 추천
 * - {@link ScreeningRepository} — ScreeningResult / StockRecommendation CRUD
 * - {@link DeepAnalysisService} — 상세 딥 분석
 *
 * 신규 코드는 위 서비스를 직접 주입해 사용할 것을 권장한다.
 * 이 파사드는 resolver / scheduler의 기존 호출을 깨지지 않게 유지하려는 목적.
 */
@Injectable()
export class ScreeningService {
  private readonly logger = new Logger(ScreeningService.name);

  constructor(
    private readonly candidateCollector: ScreeningCandidateCollector,
    private readonly analyzer: ScreeningAnalyzer,
    private readonly repository: ScreeningRepository,
    private readonly deepAnalysisService: DeepAnalysisService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // 스크리닝 파이프라인 (scheduler에서 호출)
  // ──────────────────────────────────────────────────────────

  async screenDomestic(mode: ScreeningMode = 'FULL'): Promise<StockScore[]> {
    this.logger.log(`Starting domestic screening (${mode})...`);

    const candidates = await this.candidateCollector.collectDomesticCandidates();
    if (candidates.length === 0) return [];
    const analysisCandidates = candidates.slice(0, MAX_DOMESTIC_ANALYSIS_CANDIDATES);

    const foreignInstMap = await this.candidateCollector.collectForeignInstitutionData();
    const scores: StockScore[] = [];

    for (const candidate of analysisCandidates) {
      try {
        const score = await this.analyzer.analyzeDomesticStock(candidate, foreignInstMap, mode);
        if (score.totalScore > 0 && (!score.dataAvailability || score.dataAvailability >= 30)) scores.push(score);
      } catch (e) {
        this.logger.debug(`Skip ${candidate.stockCode}: ${e.message}`);
      }
    }

    scores.sort((a, b) => b.totalScore - a.totalScore);
    return scores.slice(0, 30);
  }

  async screenOverseas(exchangeCode: string, mode: ScreeningMode = 'FULL'): Promise<StockScore[]> {
    this.logger.log(`Starting overseas screening for ${exchangeCode} (${mode})...`);

    const candidates = await this.candidateCollector.collectOverseasCandidates(exchangeCode);
    if (candidates.length === 0) return [];
    const analysisCandidates = candidates.slice(0, MAX_OVERSEAS_ANALYSIS_CANDIDATES);

    const scores: StockScore[] = [];
    for (const candidate of analysisCandidates) {
      try {
        const score = await this.analyzer.analyzeOverseasStock(candidate, mode);
        if (score.totalScore > 0) scores.push(score);
      } catch (e) {
        this.logger.debug(`Skip ${candidate.stockCode}: ${e.message}`);
      }
    }

    scores.sort((a, b) => b.totalScore - a.totalScore);
    return scores.slice(0, 20);
  }

  // ──────────────────────────────────────────────────────────
  // 결과 저장/조회 (Repository 위임)
  // ──────────────────────────────────────────────────────────

  saveResults(date: string, scores: StockScore[]): Promise<void> {
    return this.repository.saveResults(
      date,
      scores,
      (strategies) => this.analyzer.filterExecutableStrategies(strategies),
    );
  }

  getLatestRecommendationDate(market: 'DOMESTIC' | 'OVERSEAS', exchangeCodes?: string[]) {
    return this.repository.getLatestRecommendationDate(market, exchangeCodes);
  }

  getRecommendations(date: string, market?: string, country?: string, limit = 20) {
    return this.repository.getRecommendations(
      date,
      market,
      country,
      limit,
      (strategies) => this.analyzer.filterExecutableStrategies(strategies),
    );
  }

  getScreeningDates(limit = 10) {
    return this.repository.getScreeningDates(limit);
  }

  getScreeningDateSummaries(limit = 10) {
    return this.repository.getScreeningDateSummaries(limit);
  }

  getStockDeepAnalysis(date: string, stockCode: string, exchangeCode?: string) {
    return this.repository.getStockDeepAnalysis(date, stockCode, exchangeCode);
  }

  // ──────────────────────────────────────────────────────────
  // 딥 분석 일괄 실행 (scheduler에서 호출)
  // ──────────────────────────────────────────────────────────

  async runDeepAnalysisForMarket(
    date: string,
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCodes?: string[],
  ): Promise<number> {
    const recommendations = await this.repository.loadRecommendationsForDeepAnalysis(
      date,
      market,
      exchangeCodes,
    );

    if (recommendations.length === 0) return 0;

    await this.repository.resetDeepAnalysisForRecommendations(date, recommendations);

    let completed = 0;
    for (const recommendation of recommendations) {
      const isEtf = recommendation.isEtf || detectEtf(recommendation.stockName, recommendation.stockCode);
      try {
        const analysis = await this.deepAnalysisService.analyzeStock(
          recommendation.stockCode,
          recommendation.exchangeCode,
          recommendation.market as 'DOMESTIC' | 'OVERSEAS',
        );

        const saved = await this.repository.upsertDeepAnalysis(date, recommendation, analysis);

        const mergedIndicators = this.analyzer.mergeIndicatorsWithDeepAnalysis(
          recommendation.indicators,
          analysis,
        );

        await this.repository.applyDeepAnalysisSuccess(
          recommendation.id,
          saved.id,
          analysis.reportSummary,
          isEtf,
          mergedIndicators,
        );

        completed += 1;
      } catch (e) {
        const message = this.repository.formatDeepAnalysisErrorMessage(e);
        this.logger.warn(`Deep analysis failed for ${recommendation.stockCode}: ${message}`);
        await this.repository.applyDeepAnalysisFailure(recommendation.id, message, isEtf);
      }

      await this.delay(500);
    }

    return completed;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
