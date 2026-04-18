import { Injectable, Logger } from '@nestjs/common';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { StockMasterService } from '../stock-master/stock-master.service';
import { ScreeningCandidate, ForeignInstitutionDetail } from './types';

const MIN_MARKET_CAP_BY_EXCHANGE: Record<string, number> = {
  NASD: 150000, NYSE: 150000, AMEX: 50000, TKSE: 20000000,
  SEHK: 1200000, SHAA: 1100000, SZAA: 1100000, HASE: 4000000000, VNSE: 4000000000,
};
const MAX_OVERSEAS_CANDIDATES_BY_EXCHANGE: Record<string, number> = {
  NASD: 40,
  NYSE: 40,
  AMEX: 20,
};

/**
 * 국내/해외 스크리닝 후보 수집 전용 서비스.
 *
 * KIS 랭킹/검색 API 호출 → 기본 지표 필터 → 후보 리스트 반환.
 * DB 저장/점수 계산은 수행하지 않는다 (책임 외).
 */
@Injectable()
export class ScreeningCandidateCollector {
  private readonly logger = new Logger(ScreeningCandidateCollector.name);

  constructor(
    private readonly kisDomestic: KisDomesticService,
    private readonly kisOverseas: KisOverseasService,
    private readonly stockMasterService: StockMasterService,
  ) {}

  async collectDomesticCandidates(): Promise<ScreeningCandidate[]> {
    const candidates: ScreeningCandidate[] = [];
    const seen = new Set<string>();

    const rankingSources = await Promise.allSettled([
      this.kisDomestic.getVolumeRanking(),
      this.kisDomestic.getFluctuationRanking(),
      this.kisDomestic.getMarketCapRanking(),
    ]);

    const rankingLabels = [
      'volume rank',
      'fluctuation rank',
      'market cap rank',
    ];

    for (let i = 0; i < rankingSources.length; i++) {
      const result = rankingSources[i];
      const label = rankingLabels[i];
      if (result.status === 'rejected') {
        this.logger.warn(`Domestic ${label} failed: ${result.reason?.message ?? result.reason}`);
        continue;
      }

      this.appendDomesticCandidates(candidates, seen, result.value ?? [], 80);
    }

    if (candidates.length === 0 && this.shouldUseStockMasterFallback('KRX')) {
      const fallbackCandidates = this.stockMasterService.getStocksByExchange('KRX', 40);
      for (const item of fallbackCandidates) {
        if (candidates.length >= 80) break;
        if (!item.stockCode || seen.has(item.stockCode)) continue;

        seen.add(item.stockCode);
        candidates.push({
          stockCode: item.stockCode,
          stockName: item.stockName || item.stockCode,
          exchangeCode: 'KRX',
          market: 'DOMESTIC',
          currentPrice: 0,
          changeRate: 0,
          volume: 0,
          marketCap: 0,
        });
      }
    }

    if (candidates.length === 0) {
      this.logger.warn('No domestic screening candidates collected');
    } else {
      this.logger.log(`Collected ${candidates.length} domestic candidates`);
    }

    return candidates;
  }

  async collectOverseasCandidates(exchangeCode: string): Promise<ScreeningCandidate[]> {
    const candidates: ScreeningCandidate[] = [];
    const seen = new Set<string>();
    const minMcap = MIN_MARKET_CAP_BY_EXCHANGE[exchangeCode] ?? 200000;
    const maxCandidates = MAX_OVERSEAS_CANDIDATES_BY_EXCHANGE[exchangeCode] ?? 40;

    try {
      const results = await this.kisOverseas.searchStocks(exchangeCode, {});
      for (const item of results) {
        if (candidates.length >= maxCandidates) break;

        const code = item.symb;
        if (!code || seen.has(code)) continue;

        const volume = this.toInteger(item.tvol);
        const marketCap = this.toInteger(item.valx);
        if (volume < 100000 || marketCap < minMcap) continue;

        seen.add(code);
        candidates.push({
          stockCode: code,
          stockName: item.name || code,
          exchangeCode,
          market: 'OVERSEAS',
          currentPrice: this.toNumber(item.last) ?? 0,
          changeRate: this.toNumber(item.rate) ?? 0,
          volume,
          marketCap,
          per: this.toNumber(item.perx),
          eps: this.toNumber(item.epsx),
        });
      }
    } catch (e) {
      this.logger.warn(`Overseas search failed for ${exchangeCode}: ${e.message}`);
    }

    if (candidates.length < maxCandidates) {
      const rankingSources = await Promise.allSettled([
        this.kisOverseas.getVolumeRanking(exchangeCode),
        this.kisOverseas.getTradeValueRanking(exchangeCode),
        this.kisOverseas.getTurnoverRanking(exchangeCode),
        this.kisOverseas.getMarketCapRanking(exchangeCode),
        this.kisOverseas.getUpDownRanking(exchangeCode),
      ]);

      const rankingLabels = [
        'volume rank',
        'trade value rank',
        'turnover rank',
        'market cap rank',
        'updown rank',
      ];

      for (let i = 0; i < rankingSources.length; i++) {
        const result = rankingSources[i];
        const label = rankingLabels[i];
        if (result.status === 'rejected') {
          this.logger.warn(`Overseas ${label} failed for ${exchangeCode}: ${result.reason?.message ?? result.reason}`);
          continue;
        }

        this.appendOverseasCandidates(
          candidates,
          seen,
          exchangeCode,
          result.value,
          maxCandidates,
          minMcap,
        );
      }
    }

    if (candidates.length === 0 && this.shouldUseStockMasterFallback(exchangeCode)) {
      const fallbackCandidates = this.stockMasterService.getStocksByExchange(
        exchangeCode,
        Math.min(maxCandidates, 25),
      );

      for (const item of fallbackCandidates) {
        if (candidates.length >= maxCandidates) break;
        if (!item.stockCode || seen.has(item.stockCode)) continue;

        seen.add(item.stockCode);
        candidates.push({
          stockCode: item.stockCode,
          stockName: item.stockName || item.stockCode,
          exchangeCode,
          market: 'OVERSEAS',
          currentPrice: 0,
          changeRate: 0,
          volume: 0,
          marketCap: minMcap,
        });
      }

      if (candidates.length > 0) {
        this.logger.log(
          `Using stock master fallback for ${exchangeCode}: ${candidates.length} candidates`,
        );
      }
    }

    if (candidates.length === 0) {
      this.logger.warn(`No overseas screening candidates collected for ${exchangeCode}`);
    } else {
      this.logger.log(`Collected ${candidates.length} overseas candidates for ${exchangeCode}`);
    }

    return candidates;
  }

  async collectForeignInstitutionData(): Promise<Map<string, ForeignInstitutionDetail>> {
    const map = new Map<string, ForeignInstitutionDetail>();
    try {
      const data = await this.kisDomestic.getForeignInstitutionTotal();
      for (const item of data) {
        const code = item.mksc_shrn_iscd;
        if (!code) continue;
        map.set(code, {
          foreignNet: this.toInteger(item.frgn_ntby_qty),
          instNet: this.toInteger(item.orgn_ntby_qty),
          trustNet: this.toInteger(item.ivtr_ntby_qty),
          fundNet: this.toInteger(item.fund_ntby_qty),
          foreignNetAmount: this.toInteger(item.frgn_ntby_tr_pbmn),
        });
      }
    } catch (e) {
      this.logger.warn(`Foreign/institution data fetch failed: ${e.message}`);
    }
    return map;
  }

  private shouldUseStockMasterFallback(exchangeCode: string): boolean {
    return ['KRX', 'TKSE', 'SEHK', 'SHAA', 'SZAA', 'HASE', 'VNSE'].includes(exchangeCode);
  }

  private appendDomesticCandidates(
    candidates: ScreeningCandidate[],
    seen: Set<string>,
    items: any[],
    maxCandidates: number,
  ): void {
    for (const item of items.slice(0, 80)) {
      if (candidates.length >= maxCandidates) break;

      const code = item.mksc_shrn_iscd;
      if (!code || seen.has(code)) continue;

      const price = parseInt(item.stck_prpr, 10) || 0;
      if (price <= 0) continue;

      seen.add(code);
      candidates.push({
        stockCode: code,
        stockName: item.hts_kor_isnm || code,
        exchangeCode: 'KRX',
        market: 'DOMESTIC',
        currentPrice: price,
        changeRate: parseFloat(item.prdy_ctrt) || 0,
        volume: parseInt(item.acml_vol, 10) || 0,
        marketCap: this.toInteger(item.stck_avls ?? item.hts_avls),
        volumeIncreaseRate: this.toNumber(item.vol_inrt),
        avgVolume: this.toInteger(item.avrg_vol),
        avgTradingValue: this.toNumber(item.avrg_tr_pbmn),
        volumeTurnoverRate: this.toNumber(item.vol_tnrt),
        nDayPriceRate: this.toNumber(item.n_befr_clpr_vrss_prpr_rate),
      });
    }
  }

  private appendOverseasCandidates(
    candidates: ScreeningCandidate[],
    seen: Set<string>,
    exchangeCode: string,
    items: any[],
    maxCandidates: number,
    minMcap: number,
  ): void {
    for (const item of items.slice(0, 30)) {
      if (candidates.length >= maxCandidates) break;

      const code = item.symb;
      if (!code || seen.has(code)) continue;

      const currentPrice = this.toNumber(item.last) ?? 0;
      const volume = this.toInteger(item.tvol);
      const marketCap = this.toInteger(item.valx);

      if (currentPrice <= 0) continue;
      if (volume <= 0 && marketCap < minMcap) continue;

      seen.add(code);
      candidates.push({
        stockCode: code,
        stockName: item.name || code,
        exchangeCode,
        market: 'OVERSEAS',
        currentPrice,
        changeRate: this.toNumber(item.rate) ?? 0,
        volume,
        marketCap,
        per: this.toNumber(item.perx),
        eps: this.toNumber(item.epsx),
      });
    }
  }

  private toNumber(value: any): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private toInteger(value: any): number {
    return this.toNumber(value) ? Math.trunc(this.toNumber(value)!) : 0;
  }
}
