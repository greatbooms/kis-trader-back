import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { DailyPrice } from '../kis/types/kis-api.types';
import { EXCHANGE_CODE_MAP } from '../kis/types/kis-config.types';
import { ScreeningCandidate, StockScore, StockIndicatorDetail } from './types';

@Injectable()
export class ScreeningService {
  private readonly logger = new Logger(ScreeningService.name);

  constructor(
    private prisma: PrismaService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
  ) {}

  /** 국내 종목 스크리닝 실행 */
  async screenDomestic(): Promise<StockScore[]> {
    this.logger.log('Starting domestic screening...');

    // 1단계: 후보 수집 (거래량 상위)
    const candidates = await this.collectDomesticCandidates();
    this.logger.log(`Domestic candidates: ${candidates.length}`);
    if (candidates.length === 0) return [];

    // 2단계: 기관/외인 매매 동향 수집
    const foreignInstMap = await this.collectForeignInstitutionData();

    // 3단계: 개별 종목 분석 및 점수 산정
    const scores: StockScore[] = [];
    for (const candidate of candidates) {
      try {
        const score = await this.analyzeDomesticStock(candidate, foreignInstMap);
        if (score.totalScore > 0) scores.push(score);
      } catch (e) {
        this.logger.debug(`Skip ${candidate.stockCode}: ${e.message}`);
      }
    }

    scores.sort((a, b) => b.totalScore - a.totalScore);
    this.logger.log(`Domestic screening done: ${scores.length} scored`);
    return scores.slice(0, 30);
  }

  /** 해외 종목 스크리닝 실행 (거래소별) */
  async screenOverseas(exchangeCode: string): Promise<StockScore[]> {
    this.logger.log(`Starting overseas screening for ${exchangeCode}...`);

    const candidates = await this.collectOverseasCandidates(exchangeCode);
    this.logger.log(`${exchangeCode} candidates: ${candidates.length}`);
    if (candidates.length === 0) return [];

    const scores: StockScore[] = [];
    for (const candidate of candidates) {
      try {
        const score = await this.analyzeOverseasStock(candidate);
        if (score.totalScore > 0) scores.push(score);
      } catch (e) {
        this.logger.debug(`Skip ${candidate.stockCode}: ${e.message}`);
      }
    }

    scores.sort((a, b) => b.totalScore - a.totalScore);
    this.logger.log(`${exchangeCode} screening done: ${scores.length} scored`);
    return scores.slice(0, 20);
  }

  /** 스크리닝 결과를 DB에 저장 */
  async saveResults(date: string, scores: StockScore[]): Promise<void> {
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      await this.prisma.stockRecommendation.upsert({
        where: {
          screeningDate_market_stockCode: {
            screeningDate: date,
            market: s.market,
            stockCode: s.stockCode,
          },
        },
        update: {
          totalScore: s.totalScore,
          technicalScore: s.technicalScore,
          fundamentalScore: s.fundamentalScore,
          momentumScore: s.momentumScore,
          rank: i + 1,
          reasons: s.reasons as any,
          indicators: s.indicators as any,
          currentPrice: s.currentPrice,
          changeRate: s.changeRate,
          volume: s.volume,
          marketCap: s.marketCap,
          exchangeCode: s.exchangeCode,
          stockName: s.stockName,
        },
        create: {
          screeningDate: date,
          market: s.market,
          exchangeCode: s.exchangeCode,
          stockCode: s.stockCode,
          stockName: s.stockName,
          totalScore: s.totalScore,
          technicalScore: s.technicalScore,
          fundamentalScore: s.fundamentalScore,
          momentumScore: s.momentumScore,
          rank: i + 1,
          reasons: s.reasons as any,
          indicators: s.indicators as any,
          currentPrice: s.currentPrice,
          changeRate: s.changeRate,
          volume: s.volume,
          marketCap: s.marketCap,
        },
      });
    }
  }

  /** 추천 결과 조회 */
  async getRecommendations(date: string, market?: string, limit = 20) {
    return this.prisma.stockRecommendation.findMany({
      where: {
        screeningDate: date,
        ...(market ? { market: market as any } : {}),
      },
      orderBy: { rank: 'asc' },
      take: limit,
    });
  }

  /** 최근 스크리닝 날짜 목록 */
  async getScreeningDates(limit = 10) {
    const results = await this.prisma.stockRecommendation.findMany({
      select: { screeningDate: true },
      distinct: ['screeningDate'],
      orderBy: { screeningDate: 'desc' },
      take: limit,
    });
    return results.map((r) => r.screeningDate);
  }

  // ── 국내 후보 수집 ──

  private async collectDomesticCandidates(): Promise<ScreeningCandidate[]> {
    const volumeRank = await this.kisDomestic.getVolumeRanking();
    const candidates: ScreeningCandidate[] = [];
    const seen = new Set<string>();

    for (const item of volumeRank.slice(0, 80)) {
      const code = item.mksc_shrn_iscd;
      if (!code || seen.has(code)) continue;
      seen.add(code);

      const price = parseInt(item.stck_prpr, 10) || 0;
      if (price < 1000) continue; // 저가주 제외

      candidates.push({
        stockCode: code,
        stockName: item.hts_kor_isnm || code,
        exchangeCode: 'KRX',
        market: 'DOMESTIC',
        currentPrice: price,
        changeRate: parseFloat(item.prdy_ctrt) || 0,
        volume: parseInt(item.acml_vol, 10) || 0,
        marketCap: 0,
      });
    }

    return candidates;
  }

  private async collectForeignInstitutionData(): Promise<Map<string, { foreignNet: number; instNet: number }>> {
    const map = new Map<string, { foreignNet: number; instNet: number }>();
    try {
      const data = await this.kisDomestic.getForeignInstitutionTotal();
      for (const item of data) {
        const code = item.mksc_shrn_iscd;
        if (!code) continue;
        map.set(code, {
          foreignNet: parseInt(item.frgn_ntby_qty, 10) || 0,
          instNet: parseInt(item.orgn_ntby_qty, 10) || 0,
        });
      }
    } catch (e) {
      this.logger.warn(`Foreign/institution data fetch failed: ${e.message}`);
    }
    return map;
  }

  // ── 해외 후보 수집 ──

  private async collectOverseasCandidates(exchangeCode: string): Promise<ScreeningCandidate[]> {
    const candidates: ScreeningCandidate[] = [];
    const seen = new Set<string>();

    // 조건검색: 시총 일정 이상, 거래량 일정 이상
    try {
      const results = await this.kisOverseas.searchStocks(exchangeCode, {
        minVolume: 100000,
        minMarketCap: 1000000, // 시총 10억(단위:천) 이상
      });

      for (const item of results.slice(0, 60)) {
        const code = item.symb;
        if (!code || seen.has(code)) continue;
        seen.add(code);

        candidates.push({
          stockCode: code,
          stockName: item.name || code,
          exchangeCode,
          market: 'OVERSEAS',
          currentPrice: parseFloat(item.last) || 0,
          changeRate: parseFloat(item.rate) || 0,
          volume: parseInt(item.tvol, 10) || 0,
          marketCap: parseInt(item.valx, 10) || 0,
          per: parseFloat(item.perx) || undefined,
          eps: parseFloat(item.epsx) || undefined,
        });
      }
    } catch (e) {
      this.logger.warn(`Overseas search failed for ${exchangeCode}: ${e.message}`);
    }

    // 거래량순위로 보강
    try {
      const volRank = await this.kisOverseas.getVolumeRanking(exchangeCode);
      for (const item of volRank.slice(0, 30)) {
        const code = item.symb;
        if (!code || seen.has(code)) continue;
        seen.add(code);

        candidates.push({
          stockCode: code,
          stockName: item.name || code,
          exchangeCode,
          market: 'OVERSEAS',
          currentPrice: parseFloat(item.last) || 0,
          changeRate: parseFloat(item.rate) || 0,
          volume: parseInt(item.tvol, 10) || 0,
          marketCap: parseInt(item.valx, 10) || 0,
        });
      }
    } catch (e) {
      this.logger.warn(`Overseas volume rank failed for ${exchangeCode}: ${e.message}`);
    }

    return candidates;
  }

  // ── 국내 종목 분석 ──

  private async analyzeDomesticStock(
    candidate: ScreeningCandidate,
    foreignInstMap: Map<string, { foreignNet: number; instNet: number }>,
  ): Promise<StockScore> {
    const endDate = this.todayStr();
    const startDate = this.dateNDaysAgo(300);
    const dailyPrices = await this.kisDomestic.getDailyPrices(candidate.stockCode, startDate, endDate);

    const indicators = this.calculateIndicators(dailyPrices);
    const fiData = foreignInstMap.get(candidate.stockCode);

    if (fiData) {
      indicators.foreignNetBuy = fiData.foreignNet > 0;
      indicators.institutionNetBuy = fiData.instNet > 0;
    }

    // 재무비율
    try {
      const finData = await this.kisDomestic.getFinancialRatio(candidate.stockCode);
      if (finData.length > 0) {
        const latest = finData[0];
        indicators.per = parseFloat(latest.per) || undefined;
        indicators.pbr = parseFloat(latest.pbr) || undefined;
        indicators.roe = parseFloat(latest.roe_val) || undefined;
        indicators.debtRatio = parseFloat(latest.lblt_rate) || undefined;
      }
    } catch {
      // 재무비율 조회 실패 시 무시
    }

    const { technicalScore, techReasons } = this.scoreTechnical(indicators, candidate);
    const { fundamentalScore, fundReasons } = this.scoreFundamental(indicators);
    const { momentumScore, momentumReasons } = this.scoreMomentum(indicators, candidate);

    const totalScore = technicalScore + fundamentalScore + momentumScore;

    return {
      ...candidate,
      totalScore,
      technicalScore,
      fundamentalScore,
      momentumScore,
      reasons: [...techReasons, ...fundReasons, ...momentumReasons],
      indicators,
    };
  }

  // ── 해외 종목 분석 ──

  private async analyzeOverseasStock(candidate: ScreeningCandidate): Promise<StockScore> {
    const dailyPrices = await this.kisOverseas.getDailyPrices(candidate.exchangeCode, candidate.stockCode, 250);

    const indicators = this.calculateIndicators(dailyPrices);

    // 조건검색 API에서 가져온 PER/EPS를 indicators에 반영
    if (candidate.per !== undefined) indicators.per = candidate.per;

    const { technicalScore, techReasons } = this.scoreTechnical(indicators, candidate);
    const { fundamentalScore, fundReasons } = this.scoreOverseasFundamental(indicators);
    const { momentumScore, momentumReasons } = this.scoreMomentum(indicators, candidate);

    // 해외는 재무 데이터가 제한적 → 100점 만점으로 비례 보정
    // 가용 배점: Technical(40) + OverseasFundamental(15) + Momentum(30) = 85
    const rawTotal = technicalScore + fundamentalScore + momentumScore;
    const normalizedTotal = Math.round((rawTotal / 85) * 100 * 10) / 10;

    return {
      ...candidate,
      totalScore: normalizedTotal,
      technicalScore: Math.round((technicalScore / 40) * 40 * 10) / 10, // 기술적은 동일 배점
      fundamentalScore: Math.round((fundamentalScore / 15) * 30 * 10) / 10, // 15점→30점 스케일
      momentumScore: Math.round((momentumScore / 30) * 30 * 10) / 10, // 모멘텀은 동일 배점
      reasons: [...techReasons, ...fundReasons, ...momentumReasons],
      indicators,
    };
  }

  // ── 기술적 지표 계산 ──

  private calculateIndicators(prices: DailyPrice[]): StockIndicatorDetail {
    if (prices.length < 20) return {};

    const closes = prices.map((p) => p.close);
    const indicators: StockIndicatorDetail = {};

    // RSI(14)
    if (closes.length >= 15) {
      indicators.rsi14 = this.calculateRSI(closes, 14);
    }

    // 이동평균
    if (closes.length >= 20) indicators.ma20 = this.sma(closes, 20);
    if (closes.length >= 60) indicators.ma60 = this.sma(closes, 60);
    if (closes.length >= 200) {
      indicators.ma200 = this.sma(closes, 200);
      indicators.priceAboveMa200 = closes[0] > indicators.ma200;
    }

    // 골든크로스 근접 여부 (MA20이 MA60 아래이지만 5% 이내)
    if (indicators.ma20 && indicators.ma60) {
      const gap = (indicators.ma20 - indicators.ma60) / indicators.ma60;
      indicators.goldenCrossNear = gap > -0.05 && gap < 0.02;
    }

    // 거래량 급증 (최근 5일 평균 vs 20일 평균)
    if (prices.length >= 20) {
      const vol5 = prices.slice(0, 5).reduce((s, p) => s + p.volume, 0) / 5;
      const vol20 = prices.slice(0, 20).reduce((s, p) => s + p.volume, 0) / 20;
      if (vol20 > 0) {
        indicators.volumeSurgeRate = (vol5 / vol20 - 1) * 100;
      }
    }

    return indicators;
  }

  private calculateRSI(closes: number[], period: number): number {
    let gains = 0;
    let losses = 0;

    for (let i = 0; i < period && i < closes.length - 1; i++) {
      const diff = closes[i] - closes[i + 1]; // 최신이 인덱스 0
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    if (gains + losses === 0) return 50;
    const rs = gains / (losses || 0.001);
    return 100 - 100 / (1 + rs);
  }

  private sma(values: number[], period: number): number {
    return values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  }

  // ── 점수 산정 ──

  /** 기술적 점수 (0~40) */
  private scoreTechnical(ind: StockIndicatorDetail, cand: ScreeningCandidate): { technicalScore: number; techReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // RSI (0~15)
    if (ind.rsi14 !== undefined) {
      if (ind.rsi14 >= 30 && ind.rsi14 <= 45) {
        score += 15;
        reasons.push(`RSI ${ind.rsi14.toFixed(1)} — 과매도 회복 구간`);
      } else if (ind.rsi14 >= 20 && ind.rsi14 < 30) {
        score += 12;
        reasons.push(`RSI ${ind.rsi14.toFixed(1)} — 과매도 (반등 가능성)`);
      } else if (ind.rsi14 > 45 && ind.rsi14 <= 60) {
        score += 8;
        reasons.push(`RSI ${ind.rsi14.toFixed(1)} — 중립`);
      } else if (ind.rsi14 > 70) {
        score += 0;
        reasons.push(`RSI ${ind.rsi14.toFixed(1)} — 과매수 주의`);
      } else {
        score += 5;
      }
    }

    // MA200 위 여부 (0~10)
    if (ind.priceAboveMa200 === true) {
      score += 10;
      reasons.push('현재가 > MA200 — 장기 상승 추세');
    } else if (ind.priceAboveMa200 === false) {
      score += 0;
      reasons.push('현재가 < MA200 — 장기 하락 추세');
    }

    // 골든크로스 근접 (0~10)
    if (ind.goldenCrossNear) {
      score += 10;
      reasons.push('MA20-MA60 골든크로스 근접');
    }

    // MA20 위 여부 (0~5)
    if (ind.ma20 && cand.currentPrice > ind.ma20) {
      score += 5;
      reasons.push('현재가 > MA20 — 단기 상승 추세');
    }

    return { technicalScore: Math.min(score, 40), techReasons: reasons };
  }

  /** 펀더멘탈 점수 (0~30, 국내만) */
  private scoreFundamental(ind: StockIndicatorDetail): { fundamentalScore: number; fundReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // PER (0~10)
    if (ind.per !== undefined && ind.per > 0) {
      if (ind.per <= 10) {
        score += 10;
        reasons.push(`PER ${ind.per.toFixed(1)} — 저평가`);
      } else if (ind.per <= 20) {
        score += 7;
        reasons.push(`PER ${ind.per.toFixed(1)} — 적정`);
      } else if (ind.per <= 30) {
        score += 3;
        reasons.push(`PER ${ind.per.toFixed(1)} — 다소 고평가`);
      }
    }

    // ROE (0~10)
    if (ind.roe !== undefined) {
      if (ind.roe >= 15) {
        score += 10;
        reasons.push(`ROE ${ind.roe.toFixed(1)}% — 우수`);
      } else if (ind.roe >= 10) {
        score += 7;
        reasons.push(`ROE ${ind.roe.toFixed(1)}% — 양호`);
      } else if (ind.roe >= 5) {
        score += 4;
        reasons.push(`ROE ${ind.roe.toFixed(1)}% — 보통`);
      }
    }

    // 부채비율 (0~5)
    if (ind.debtRatio !== undefined) {
      if (ind.debtRatio < 100) {
        score += 5;
        reasons.push(`부채비율 ${ind.debtRatio.toFixed(0)}% — 안정적`);
      } else if (ind.debtRatio < 200) {
        score += 3;
        reasons.push(`부채비율 ${ind.debtRatio.toFixed(0)}% — 보통`);
      }
    }

    // 기관/외인 동향 (0~5)
    if (ind.foreignNetBuy && ind.institutionNetBuy) {
      score += 5;
      reasons.push('외국인+기관 동시 순매수');
    } else if (ind.foreignNetBuy) {
      score += 3;
      reasons.push('외국인 순매수');
    } else if (ind.institutionNetBuy) {
      score += 3;
      reasons.push('기관 순매수');
    }

    return { fundamentalScore: Math.min(score, 30), fundReasons: reasons };
  }

  /** 해외 펀더멘탈 점수 (0~15, PER만 활용 가능) */
  private scoreOverseasFundamental(ind: StockIndicatorDetail): { fundamentalScore: number; fundReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // PER (0~15) — 해외는 PER만 조건검색 API에서 제공
    if (ind.per !== undefined && ind.per > 0) {
      if (ind.per <= 10) {
        score += 15;
        reasons.push(`PER ${ind.per.toFixed(1)} — 저평가`);
      } else if (ind.per <= 15) {
        score += 12;
        reasons.push(`PER ${ind.per.toFixed(1)} — 양호`);
      } else if (ind.per <= 25) {
        score += 8;
        reasons.push(`PER ${ind.per.toFixed(1)} — 적정`);
      } else if (ind.per <= 40) {
        score += 4;
        reasons.push(`PER ${ind.per.toFixed(1)} — 다소 고평가`);
      } else {
        score += 0;
        reasons.push(`PER ${ind.per.toFixed(1)} — 고평가`);
      }
    }

    return { fundamentalScore: Math.min(score, 15), fundReasons: reasons };
  }

  /** 모멘텀 점수 (0~30) */
  private scoreMomentum(ind: StockIndicatorDetail, cand: ScreeningCandidate): { momentumScore: number; momentumReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // 등락률 (0~10)
    if (cand.changeRate >= 1 && cand.changeRate <= 5) {
      score += 10;
      reasons.push(`등락률 +${cand.changeRate.toFixed(1)}% — 완만한 상승`);
    } else if (cand.changeRate > 5 && cand.changeRate <= 10) {
      score += 7;
      reasons.push(`등락률 +${cand.changeRate.toFixed(1)}% — 강한 상승`);
    } else if (cand.changeRate >= -3 && cand.changeRate < 0) {
      score += 5;
      reasons.push(`등락률 ${cand.changeRate.toFixed(1)}% — 소폭 하락 (매수 기회)`);
    } else if (cand.changeRate > 10) {
      score += 3;
      reasons.push(`등락률 +${cand.changeRate.toFixed(1)}% — 급등 주의`);
    }

    // 거래량 급증 (0~10)
    if (ind.volumeSurgeRate !== undefined) {
      if (ind.volumeSurgeRate >= 50 && ind.volumeSurgeRate <= 200) {
        score += 10;
        reasons.push(`거래량 급증 +${ind.volumeSurgeRate.toFixed(0)}% — 수급 호전`);
      } else if (ind.volumeSurgeRate >= 20) {
        score += 6;
        reasons.push(`거래량 증가 +${ind.volumeSurgeRate.toFixed(0)}%`);
      } else if (ind.volumeSurgeRate > 200) {
        score += 5;
        reasons.push(`거래량 폭증 +${ind.volumeSurgeRate.toFixed(0)}% — 과열 주의`);
      }
    }

    // 가격 모멘텀: MA20 > MA60 (0~10)
    if (ind.ma20 && ind.ma60 && ind.ma20 > ind.ma60) {
      score += 10;
      reasons.push('MA20 > MA60 — 중기 상승 모멘텀');
    }

    return { momentumScore: Math.min(score, 30), momentumReasons: reasons };
  }

  // ── 유틸 ──

  private todayStr(): string {
    const d = new Date();
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private dateNDaysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
}
