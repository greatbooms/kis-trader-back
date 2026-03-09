import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { DailyPrice } from '../kis/types/kis-api.types';
import { EXCHANGE_CODE_MAP } from '../kis/types/kis-config.types';
import { ScreeningCandidate, StockScore, StockIndicatorDetail, SuggestedStrategy } from './types';

interface ForeignInstitutionDetail {
  foreignNet: number;
  instNet: number;
  trustNet: number; // 투자신탁
  fundNet: number; // 기금(연기금)
  foreignNetAmount: number; // 외국인 순매수 거래대금 (백만원)
}

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
          suggestedStrategies: s.suggestedStrategies as any,
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
          suggestedStrategies: s.suggestedStrategies as any,
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

  /** 날짜별 국가 요약 (날짜 목록 + 각 날짜의 국가별 종목 수/평균점수) */
  async getScreeningDateSummaries(limit = 10) {
    const dates = await this.getScreeningDates(limit);
    if (dates.length === 0) return [];

    const rows = await this.prisma.stockRecommendation.groupBy({
      by: ['screeningDate', 'exchangeCode'],
      where: { screeningDate: { in: dates } },
      _count: true,
      _avg: { totalScore: true },
    });

    const exchangeToCountry: Record<string, { code: string; label: string }> = {
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

    return dates.map((date) => {
      const dateRows = rows.filter((r) => r.screeningDate === date);
      // 국가별로 합산
      const countryMap = new Map<string, { label: string; count: number; totalScore: number }>();
      for (const row of dateRows) {
        const country = exchangeToCountry[row.exchangeCode] || { code: row.exchangeCode, label: row.exchangeCode };
        const existing = countryMap.get(country.code) || { label: country.label, count: 0, totalScore: 0 };
        existing.count += row._count;
        existing.totalScore += (row._avg.totalScore?.toNumber() ?? 0) * row._count;
        countryMap.set(country.code, existing);
      }

      const countries = [...countryMap.entries()].map(([code, v]) => ({
        country: code,
        label: v.label,
        count: v.count,
        avgScore: v.count > 0 ? v.totalScore / v.count : 0,
      }));

      return {
        date,
        countries,
        totalCount: countries.reduce((sum, c) => sum + c.count, 0),
      };
    });
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
        // 거래량순위 API 추가 필드
        volumeIncreaseRate: item.vol_inrt ? parseFloat(item.vol_inrt) : undefined,
        avgVolume: item.avrg_vol ? parseInt(item.avrg_vol, 10) : undefined,
        avgTradingValue: item.avrg_tr_pbmn ? parseFloat(item.avrg_tr_pbmn) : undefined,
        volumeTurnoverRate: item.vol_tnrt ? parseFloat(item.vol_tnrt) : undefined,
        nDayPriceRate: item.n_befr_clpr_vrss_prpr_rate ? parseFloat(item.n_befr_clpr_vrss_prpr_rate) : undefined,
      });
    }

    return candidates;
  }

  private async collectForeignInstitutionData(): Promise<Map<string, ForeignInstitutionDetail>> {
    const map = new Map<string, ForeignInstitutionDetail>();
    try {
      const data = await this.kisDomestic.getForeignInstitutionTotal();
      for (const item of data) {
        const code = item.mksc_shrn_iscd;
        if (!code) continue;
        map.set(code, {
          foreignNet: parseInt(item.frgn_ntby_qty, 10) || 0,
          instNet: parseInt(item.orgn_ntby_qty, 10) || 0,
          trustNet: parseInt(item.ivtr_ntby_qty, 10) || 0, // 투자신탁
          fundNet: parseInt(item.fund_ntby_qty, 10) || 0, // 기금(연기금)
          foreignNetAmount: parseInt(item.frgn_ntby_tr_pbmn, 10) || 0, // 외국인 순매수 거래대금 (백만원)
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
    foreignInstMap: Map<string, ForeignInstitutionDetail>,
  ): Promise<StockScore> {
    const endDate = this.todayStr();
    const startDate = this.dateNDaysAgo(300);
    const dailyPrices = await this.kisDomestic.getDailyPrices(candidate.stockCode, startDate, endDate);

    const indicators = this.calculateIndicators(dailyPrices);

    // 기관/외인 매매 동향 (세부 분류)
    const fiData = foreignInstMap.get(candidate.stockCode);
    if (fiData) {
      indicators.foreignNetBuy = fiData.foreignNet > 0;
      indicators.institutionNetBuy = fiData.instNet > 0;
      indicators.fundNetBuy = fiData.fundNet > 0;
      indicators.trustNetBuy = fiData.trustNet > 0;
      indicators.foreignNetBuyAmount = fiData.foreignNetAmount;
    }

    // 거래량순위 API에서 가져온 추가 지표 반영
    if (candidate.volumeIncreaseRate !== undefined) {
      indicators.volumeIncreaseRate = candidate.volumeIncreaseRate;
    }
    if (candidate.avgVolume && candidate.avgVolume > 0) {
      indicators.avgVolume = candidate.avgVolume;
      indicators.volumeToAvgRatio = candidate.volume / candidate.avgVolume;
    }

    // 현재가 상세 조회 (가격 위치, 리스크 지표)
    try {
      const priceDetail = await this.kisDomestic.getPrice(candidate.stockCode);
      if (priceDetail.marketCap) candidate.marketCap = priceDetail.marketCap;
      indicators.d250High = priceDetail.d250High;
      indicators.d250Low = priceDetail.d250Low;
      indicators.d250HighRate = priceDetail.d250HighRate;
      indicators.d250LowRate = priceDetail.d250LowRate;
      indicators.yearHigh = priceDetail.yearHigh;
      indicators.yearLow = priceDetail.yearLow;
      indicators.yearHighRate = priceDetail.yearHighRate;
      indicators.yearLowRate = priceDetail.yearLowRate;
      indicators.loanBalanceRate = priceDetail.loanBalanceRate;
      indicators.shortSellable = priceDetail.shortSellable;
    } catch {
      // 현재가 상세 조회 실패 시 무시
    }

    // 재무비율
    try {
      const finData = await this.kisDomestic.getFinancialRatio(candidate.stockCode);
      if (finData.length > 0) {
        const latest = finData[0];
        indicators.per = parseFloat(latest.per) || undefined;
        indicators.pbr = parseFloat(latest.pbr) || undefined;
        indicators.roe = parseFloat(latest.roe_val) || undefined;
        indicators.eps = parseFloat(latest.eps) || undefined;
        indicators.bps = parseFloat(latest.bps) || undefined;
        indicators.debtRatio = parseFloat(latest.lblt_rate) || undefined;
      }
    } catch {
      // 재무비율 조회 실패 시 무시
    }

    const { technicalScore, techReasons } = this.scoreTechnical(indicators, candidate);
    const { fundamentalScore, fundReasons } = this.scoreFundamental(indicators);
    const { momentumScore, momentumReasons } = this.scoreMomentum(indicators, candidate);

    const totalScore = technicalScore + fundamentalScore + momentumScore;
    const suggestedStrategies = this.suggestStrategies(indicators, candidate, false);

    return {
      ...candidate,
      totalScore,
      technicalScore,
      fundamentalScore,
      momentumScore,
      reasons: [...techReasons, ...fundReasons, ...momentumReasons],
      indicators,
      suggestedStrategies,
    };
  }

  // ── 해외 종목 분석 ──

  private async analyzeOverseasStock(candidate: ScreeningCandidate): Promise<StockScore> {
    const dailyPrices = await this.kisOverseas.getDailyPrices(candidate.exchangeCode, candidate.stockCode, 250);

    const indicators = this.calculateIndicators(dailyPrices);

    // 조건검색 API에서 가져온 PER/EPS를 indicators에 반영
    if (candidate.per !== undefined) indicators.per = candidate.per;

    // 현재가상세 조회 → 추가 지표 (시총, 섹터, 전일거래량, PBR 등)
    try {
      const priceDetail = await this.kisOverseas.getPrice(candidate.exchangeCode, candidate.stockCode);
      if (priceDetail.marketCap) candidate.marketCap = priceDetail.marketCap;
      if (priceDetail.pbr !== undefined) indicators.pbr = priceDetail.pbr;
      if (priceDetail.sector) indicators.sector = priceDetail.sector;
      if (priceDetail.prevDayVolume && priceDetail.prevDayVolume > 0 && candidate.volume > 0) {
        indicators.prevDayVolumeChangeRate = (candidate.volume / priceDetail.prevDayVolume - 1) * 100;
      }
    } catch {
      // 현재가상세 조회 실패 시 무시
    }

    const { technicalScore, techReasons } = this.scoreTechnical(indicators, candidate);
    const { fundamentalScore, fundReasons } = this.scoreOverseasFundamental(indicators);
    const { momentumScore, momentumReasons } = this.scoreMomentum(indicators, candidate);

    // 해외는 재무 데이터가 제한적 → 100점 만점으로 비례 보정
    // 가용 배점: Technical(40) + OverseasFundamental(20) + Momentum(30) = 90
    const rawTotal = technicalScore + fundamentalScore + momentumScore;
    const normalizedTotal = Math.round((rawTotal / 90) * 100 * 10) / 10;

    const suggestedStrategies = this.suggestStrategies(indicators, candidate, true);

    return {
      ...candidate,
      totalScore: normalizedTotal,
      technicalScore: Math.round((technicalScore / 40) * 40 * 10) / 10,
      fundamentalScore: Math.round((fundamentalScore / 20) * 30 * 10) / 10, // 20점→30점 스케일
      momentumScore: Math.round((momentumScore / 30) * 30 * 10) / 10,
      reasons: [...techReasons, ...fundReasons, ...momentumReasons],
      indicators,
      suggestedStrategies,
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

    // MA20 위 여부 (0~3)
    if (ind.ma20 && cand.currentPrice > ind.ma20) {
      score += 3;
      reasons.push('현재가 > MA20 — 단기 상승 추세');
    }

    // 연중 최고가 근접도 (0~2) — 신고가 근접은 상승 모멘텀 강화
    if (ind.yearHighRate !== undefined && ind.yearHighRate >= -5) {
      score += 2;
      reasons.push(`연중 최고가 근접 (${ind.yearHighRate.toFixed(0)}%)`);
    }

    return { technicalScore: Math.min(score, 40), techReasons: reasons };
  }

  /** 펀더멘탈 점수 (0~30, 국내만) */
  private scoreFundamental(ind: StockIndicatorDetail): { fundamentalScore: number; fundReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // PER (0~8)
    if (ind.per !== undefined && ind.per > 0) {
      if (ind.per <= 10) {
        score += 8;
        reasons.push(`PER ${ind.per.toFixed(1)} — 저평가`);
      } else if (ind.per <= 20) {
        score += 5;
        reasons.push(`PER ${ind.per.toFixed(1)} — 적정`);
      } else if (ind.per <= 30) {
        score += 2;
        reasons.push(`PER ${ind.per.toFixed(1)} — 다소 고평가`);
      }
    }

    // ROE (0~8)
    if (ind.roe !== undefined) {
      if (ind.roe >= 15) {
        score += 8;
        reasons.push(`ROE ${ind.roe.toFixed(1)}% — 우수`);
      } else if (ind.roe >= 10) {
        score += 5;
        reasons.push(`ROE ${ind.roe.toFixed(1)}% — 양호`);
      } else if (ind.roe >= 5) {
        score += 3;
        reasons.push(`ROE ${ind.roe.toFixed(1)}% — 보통`);
      }
    }

    // 부채비율 (0~4)
    if (ind.debtRatio !== undefined) {
      if (ind.debtRatio < 100) {
        score += 4;
        reasons.push(`부채비율 ${ind.debtRatio.toFixed(0)}% — 안정적`);
      } else if (ind.debtRatio < 200) {
        score += 2;
        reasons.push(`부채비율 ${ind.debtRatio.toFixed(0)}% — 보통`);
      }
    }

    // 기관/외인 동향 (0~7) — 세부 분류 반영
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
    // 연기금/투자신탁 추가 보너스 (0~2)
    if (ind.fundNetBuy) {
      score += 1;
      reasons.push('연기금 순매수');
    }
    if (ind.trustNetBuy) {
      score += 1;
      reasons.push('투자신탁 순매수');
    }

    // 융자잔고 리스크 감점 (0~-3)
    if (ind.loanBalanceRate !== undefined && ind.loanBalanceRate > 10) {
      score -= 3;
      reasons.push(`융자잔고 ${ind.loanBalanceRate.toFixed(1)}% — 레버리지 과다 주의`);
    } else if (ind.loanBalanceRate !== undefined && ind.loanBalanceRate > 5) {
      score -= 1;
      reasons.push(`융자잔고 ${ind.loanBalanceRate.toFixed(1)}%`);
    }

    return { fundamentalScore: Math.max(Math.min(score, 30), 0), fundReasons: reasons };
  }

  /** 해외 펀더멘탈 점수 (0~20, PER + PBR) */
  private scoreOverseasFundamental(ind: StockIndicatorDetail): { fundamentalScore: number; fundReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // PER (0~13)
    if (ind.per !== undefined && ind.per > 0) {
      if (ind.per <= 10) {
        score += 13;
        reasons.push(`PER ${ind.per.toFixed(1)} — 저평가`);
      } else if (ind.per <= 15) {
        score += 10;
        reasons.push(`PER ${ind.per.toFixed(1)} — 양호`);
      } else if (ind.per <= 25) {
        score += 7;
        reasons.push(`PER ${ind.per.toFixed(1)} — 적정`);
      } else if (ind.per <= 40) {
        score += 3;
        reasons.push(`PER ${ind.per.toFixed(1)} — 다소 고평가`);
      } else {
        score += 0;
        reasons.push(`PER ${ind.per.toFixed(1)} — 고평가`);
      }
    }

    // PBR (0~7) — 해외 현재가상세 API에서 제공
    if (ind.pbr !== undefined && ind.pbr > 0) {
      if (ind.pbr < 1.0) {
        score += 7;
        reasons.push(`PBR ${ind.pbr.toFixed(2)} — 자산가치 대비 저평가`);
      } else if (ind.pbr < 3.0) {
        score += 4;
        reasons.push(`PBR ${ind.pbr.toFixed(2)} — 적정`);
      } else if (ind.pbr < 5.0) {
        score += 2;
        reasons.push(`PBR ${ind.pbr.toFixed(2)} — 다소 고평가`);
      }
    }

    return { fundamentalScore: Math.min(score, 20), fundReasons: reasons };
  }

  /** 모멘텀 점수 (0~30) */
  private scoreMomentum(ind: StockIndicatorDetail, cand: ScreeningCandidate): { momentumScore: number; momentumReasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // 등락률 (0~8)
    if (cand.changeRate >= 1 && cand.changeRate <= 5) {
      score += 8;
      reasons.push(`등락률 +${cand.changeRate.toFixed(1)}% — 완만한 상승`);
    } else if (cand.changeRate > 5 && cand.changeRate <= 10) {
      score += 6;
      reasons.push(`등락률 +${cand.changeRate.toFixed(1)}% — 강한 상승`);
    } else if (cand.changeRate >= -3 && cand.changeRate < 0) {
      score += 4;
      reasons.push(`등락률 ${cand.changeRate.toFixed(1)}% — 소폭 하락 (매수 기회)`);
    } else if (cand.changeRate > 10) {
      score += 2;
      reasons.push(`등락률 +${cand.changeRate.toFixed(1)}% — 급등 주의`);
    }

    // 거래량 급증 (0~10) — API 직접 증가율 우선, 없으면 계산값 사용
    const volRate = ind.volumeIncreaseRate ?? ind.volumeSurgeRate;
    if (volRate !== undefined) {
      if (volRate >= 50 && volRate <= 200) {
        score += 10;
        reasons.push(`거래량 급증 +${volRate.toFixed(0)}% — 수급 호전`);
      } else if (volRate >= 20) {
        score += 6;
        reasons.push(`거래량 증가 +${volRate.toFixed(0)}%`);
      } else if (volRate > 200) {
        score += 5;
        reasons.push(`거래량 폭증 +${volRate.toFixed(0)}% — 과열 주의`);
      }
    }

    // 비정상 거래량 감지 (현재 / 평균 거래량 비율)
    if (ind.volumeToAvgRatio !== undefined && ind.volumeToAvgRatio > 3) {
      score += 2;
      reasons.push(`평균 대비 거래량 ${ind.volumeToAvgRatio.toFixed(1)}배 — 이례적 거래`);
    }

    // 가격 모멘텀: MA20 > MA60 (0~8)
    if (ind.ma20 && ind.ma60 && ind.ma20 > ind.ma60) {
      score += 8;
      reasons.push('MA20 > MA60 — 중기 상승 모멘텀');
    }

    // 가격 위치 보너스: 250일 저점 근접 (0~2)
    if (ind.d250LowRate !== undefined && ind.d250LowRate <= 20) {
      score += 2;
      reasons.push(`250일 저점 대비 +${ind.d250LowRate.toFixed(0)}% — 바닥권 근접`);
    }

    return { momentumScore: Math.min(score, 30), momentumReasons: reasons };
  }

  // ── 전략 추천 ──

  private suggestStrategies(
    ind: StockIndicatorDetail,
    cand: ScreeningCandidate,
    isOverseas: boolean,
  ): SuggestedStrategy[] {
    const strategies: SuggestedStrategy[] = [];

    // 1. 밸류 팩터: PER 저평가 + ROE 양호
    {
      let score = 0;
      const parts: string[] = [];
      if (ind.per !== undefined && ind.per > 0 && ind.per <= 10) {
        score += 40;
        parts.push(`PER ${ind.per.toFixed(1)}`);
      } else if (ind.per !== undefined && ind.per > 0 && ind.per <= 15) {
        score += 20;
        parts.push(`PER ${ind.per.toFixed(1)}`);
      }
      if (!isOverseas && ind.roe !== undefined && ind.roe >= 10) {
        score += 30;
        parts.push(`ROE ${ind.roe.toFixed(0)}%`);
      }
      if (!isOverseas && ind.debtRatio !== undefined && ind.debtRatio < 150) {
        score += 15;
        parts.push(`부채${ind.debtRatio.toFixed(0)}%`);
      }
      if (ind.pbr !== undefined && ind.pbr < 1.0) {
        score += 15;
        parts.push(`PBR ${ind.pbr.toFixed(1)}`);
      }
      if (score >= 40) {
        strategies.push({
          name: 'value-factor',
          displayName: '밸류 팩터',
          matchScore: Math.min(score, 100),
          reason: `저평가 재무지표: ${parts.join(', ')}`,
        });
      }
    }

    // 2. 추세 추종: MA20 > MA60, 가격 > MA200
    {
      let score = 0;
      const parts: string[] = [];
      if (ind.ma20 && ind.ma60 && ind.ma20 > ind.ma60) {
        score += 40;
        parts.push('골든크로스 형성');
      }
      if (ind.priceAboveMa200) {
        score += 30;
        parts.push('MA200 위 장기 상승');
      }
      if (ind.rsi14 !== undefined && ind.rsi14 >= 40 && ind.rsi14 <= 65) {
        score += 20;
        parts.push(`RSI ${ind.rsi14.toFixed(0)} 안정적`);
      }
      if (ind.volumeSurgeRate !== undefined && ind.volumeSurgeRate >= 20) {
        score += 10;
        parts.push('거래량 증가');
      }
      if (score >= 40) {
        strategies.push({
          name: 'trend-following',
          displayName: '추세 추종',
          matchScore: Math.min(score, 100),
          reason: parts.join(', '),
        });
      }
    }

    // 3. 모멘텀 돌파: 단기 급등, RSI 50~70, 거래량 급증
    {
      let score = 0;
      const parts: string[] = [];
      if (cand.changeRate >= 1 && cand.changeRate <= 8) {
        score += 30;
        parts.push(`등락률 +${cand.changeRate.toFixed(1)}%`);
      }
      if (ind.rsi14 !== undefined && ind.rsi14 >= 50 && ind.rsi14 <= 70) {
        score += 30;
        parts.push(`RSI ${ind.rsi14.toFixed(0)}`);
      }
      if (ind.volumeSurgeRate !== undefined && ind.volumeSurgeRate >= 50) {
        score += 25;
        parts.push(`거래량 +${ind.volumeSurgeRate.toFixed(0)}%`);
      }
      if (ind.ma20 && cand.currentPrice > ind.ma20) {
        score += 15;
        parts.push('MA20 위');
      }
      if (score >= 50) {
        strategies.push({
          name: 'momentum-breakout',
          displayName: '모멘텀 돌파',
          matchScore: Math.min(score, 100),
          reason: parts.join(', '),
        });
      }
    }

    // 4. 그리드 평균회귀: RSI 과매도, 가격 < MA20 (횡보/하락 후 반등 기대)
    {
      let score = 0;
      const parts: string[] = [];
      if (ind.rsi14 !== undefined && ind.rsi14 < 35) {
        score += 35;
        parts.push(`RSI ${ind.rsi14.toFixed(0)} 과매도`);
      }
      if (ind.ma20 && cand.currentPrice < ind.ma20) {
        score += 20;
        parts.push('MA20 아래 (평균 회귀 기대)');
      }
      if (cand.changeRate < -2) {
        score += 15;
        parts.push(`등락률 ${cand.changeRate.toFixed(1)}%`);
      }
      if (ind.volumeSurgeRate !== undefined && ind.volumeSurgeRate >= 30) {
        score += 15;
        parts.push('거래량 증가 (반등 신호)');
      }
      // 250일 저점 근접 시 반등 매수 기대치 상승
      if (ind.d250LowRate !== undefined && ind.d250LowRate <= 15) {
        score += 15;
        parts.push(`250일 저점 근접 (+${ind.d250LowRate.toFixed(0)}%)`);
      }
      if (score >= 40) {
        strategies.push({
          name: 'grid-mean-reversion',
          displayName: '그리드 평균회귀',
          matchScore: Math.min(score, 100),
          reason: parts.join(', '),
        });
      }
    }

    // 5. 보수적 매매: 극단적 과매도
    {
      let score = 0;
      const parts: string[] = [];
      if (ind.rsi14 !== undefined && ind.rsi14 < 25) {
        score += 45;
        parts.push(`RSI ${ind.rsi14.toFixed(0)} 극단적 과매도`);
      }
      if (ind.volumeSurgeRate !== undefined && ind.volumeSurgeRate >= 100) {
        score += 25;
        parts.push(`거래량 폭증 +${ind.volumeSurgeRate.toFixed(0)}%`);
      }
      if (cand.changeRate < -5) {
        score += 15;
        parts.push(`급락 ${cand.changeRate.toFixed(1)}%`);
      }
      // 공매도 불가 종목은 하방 방어력이 있어 보수적 전략에 유리
      if (ind.shortSellable === false) {
        score += 10;
        parts.push('공매도 불가 (하방 방어)');
      }
      // 융자잔고 낮으면 레버리지 청산 리스크 적음
      if (ind.loanBalanceRate !== undefined && ind.loanBalanceRate < 3) {
        score += 5;
        parts.push('융자잔고 안정');
      }
      if (score >= 50) {
        strategies.push({
          name: 'conservative',
          displayName: '보수적 매매',
          matchScore: Math.min(score, 100),
          reason: parts.join(', '),
        });
      }
    }

    // 6. 무한매수법: MA200 위 + 장기 상승 추세 (DCA 적합)
    {
      let score = 0;
      const parts: string[] = [];
      if (ind.priceAboveMa200) {
        score += 35;
        parts.push('MA200 위 장기 상승 추세');
      }
      if (ind.rsi14 !== undefined && ind.rsi14 >= 30 && ind.rsi14 <= 55) {
        score += 20;
        parts.push(`RSI ${ind.rsi14.toFixed(0)} 적정 구간`);
      }
      if (ind.per !== undefined && ind.per > 0 && ind.per <= 20) {
        score += 15;
        parts.push(`PER ${ind.per.toFixed(1)} 합리적`);
      }
      if (!isOverseas && ind.foreignNetBuy) {
        score += 15;
        parts.push('외국인 순매수');
      }
      // 연기금 매수 시 장기 우상향 기대
      if (!isOverseas && ind.fundNetBuy) {
        score += 10;
        parts.push('연기금 순매수 — 장기 우상향 시그널');
      }
      // 시가총액이 충분히 큰 종목이 무한매수에 적합
      if (cand.marketCap > 0 && cand.marketCap > 10000) {
        score += 5;
        parts.push('대형주');
      }
      if (score >= 40) {
        strategies.push({
          name: 'infinite-buy',
          displayName: '무한매수법',
          matchScore: Math.min(score, 100),
          reason: parts.join(', '),
        });
      }
    }

    // matchScore 기준 내림차순 정렬, 상위 3개만
    strategies.sort((a, b) => b.matchScore - a.matchScore);
    return strategies.slice(0, 3);
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
