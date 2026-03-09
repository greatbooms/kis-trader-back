import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import {
  DomesticPriceOutput,
  DomesticOrderOutput,
  DomesticBalanceItem,
  StockPriceResult,
  OrderResult,
  BalanceItem,
  DailyPrice,
  InterestRateItem,
  HolidayItem,
  UnfilledOrder,
} from './types/kis-api.types';

@Injectable()
export class KisDomesticService {
  private readonly logger = new Logger(KisDomesticService.name);
  private readonly accountNo: string;
  private readonly prodCode: string;
  private readonly isPaper: boolean;

  constructor(
    private kisBase: KisBaseService,
    private configService: ConfigService,
  ) {
    this.accountNo = this.configService.get<string>('kis.accountNo')!;
    this.prodCode = this.configService.get<string>('kis.prodCode')!;
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
  }

  /** 국내 현재가 조회 */
  async getPrice(stockCode: string): Promise<StockPriceResult> {
    const res = await this.kisBase.get<DomesticPriceOutput>(
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      'FHKST01010100',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode,
      },
    );

    const o = res.output!;
    return {
      stockCode,
      stockName: o.hts_kor_isnm || stockCode,
      currentPrice: parseFloat(o.stck_prpr) || 0,
      openPrice: parseFloat(o.stck_oprc) || 0,
      highPrice: parseFloat(o.stck_hgpr) || 0,
      lowPrice: parseFloat(o.stck_lwpr) || 0,
      volume: parseInt(o.acml_vol, 10) || 0,
      prevDayVolumeRate: o.prdy_vrss_vol_rate ? parseFloat(o.prdy_vrss_vol_rate) : undefined,
      per: o.per ? parseFloat(o.per) || undefined : undefined,
      pbr: o.pbr ? parseFloat(o.pbr) || undefined : undefined,
      eps: o.eps ? parseFloat(o.eps) || undefined : undefined,
      bps: o.bps ? parseFloat(o.bps) || undefined : undefined,
      foreignHoldRate: o.hts_frgn_ehrt ? parseFloat(o.hts_frgn_ehrt) : undefined,
      foreignNetBuyQty: o.frgn_ntby_qty ? parseInt(o.frgn_ntby_qty, 10) : undefined,
      programNetBuyQty: o.pgtr_ntby_qty ? parseInt(o.pgtr_ntby_qty, 10) : undefined,
      tradingValue: o.acml_tr_pbmn ? parseFloat(o.acml_tr_pbmn) : undefined,
      w52High: o.w52_hgpr ? parseFloat(o.w52_hgpr) || undefined : undefined,
      w52Low: o.w52_lwpr ? parseFloat(o.w52_lwpr) || undefined : undefined,
      d250High: o.d250_hgpr ? parseFloat(o.d250_hgpr) || undefined : undefined,
      d250Low: o.d250_lwpr ? parseFloat(o.d250_lwpr) || undefined : undefined,
      d250HighRate: o.d250_hgpr_vrss_prpr_rate ? parseFloat(o.d250_hgpr_vrss_prpr_rate) : undefined,
      d250LowRate: o.d250_lwpr_vrss_prpr_rate ? parseFloat(o.d250_lwpr_vrss_prpr_rate) : undefined,
      yearHigh: o.stck_dryy_hgpr ? parseFloat(o.stck_dryy_hgpr) || undefined : undefined,
      yearLow: o.stck_dryy_lwpr ? parseFloat(o.stck_dryy_lwpr) || undefined : undefined,
      yearHighRate: o.dryy_hgpr_vrss_prpr_rate ? parseFloat(o.dryy_hgpr_vrss_prpr_rate) : undefined,
      yearLowRate: o.dryy_lwpr_vrss_prpr_rate ? parseFloat(o.dryy_lwpr_vrss_prpr_rate) : undefined,
      marketCap: o.hts_avls ? parseFloat(o.hts_avls) || undefined : undefined,
      listedShares: o.lstn_stcn ? parseInt(o.lstn_stcn, 10) || undefined : undefined,
      loanBalanceRate: o.whol_loan_rmnd_rate ? parseFloat(o.whol_loan_rmnd_rate) : undefined,
      shortSellable: o.ssts_yn === 'Y',
      investCautionYn: o.invt_caful_yn === 'Y',
      marketWarnCode: o.mrkt_warn_cls_code,
      shortOverheatYn: o.short_over_yn === 'Y',
    };
  }

  /** 국내 매수 */
  async orderBuy(stockCode: string, qty: number, price?: number, orderDivision?: string): Promise<OrderResult> {
    return this.order(stockCode, qty, price, 'BUY', orderDivision);
  }

  /** 국내 매도 */
  async orderSell(stockCode: string, qty: number, price?: number, orderDivision?: string): Promise<OrderResult> {
    return this.order(stockCode, qty, price, 'SELL', orderDivision);
  }

  private async order(
    stockCode: string,
    qty: number,
    price: number | undefined,
    side: 'BUY' | 'SELL',
    orderDivision?: string,
  ): Promise<OrderResult> {
    const trId = this.isPaper
      ? side === 'BUY' ? 'VTTC0012U' : 'VTTC0011U'
      : side === 'BUY' ? 'TTTC0012U' : 'TTTC0011U';

    const isMarket = !price || price === 0;
    // orderDivision이 명시되면 사용, 아니면 시장가/지정가 자동 판단
    const ordDvsn = orderDivision || (isMarket ? '01' : '00');
    const body = {
      CANO: this.accountNo.substring(0, 8),
      ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
      PDNO: stockCode,
      ORD_DVSN: ordDvsn,
      ORD_QTY: String(qty),
      ORD_UNPR: isMarket && !orderDivision ? '0' : String(price || 0),
    };

    try {
      const res = await this.kisBase.post<DomesticOrderOutput>(
        '/uapi/domestic-stock/v1/trading/order-cash',
        trId,
        body,
      );
      return {
        success: true,
        orderNo: res.output?.ODNO,
        message: `${side} order placed: ${stockCode} x ${qty} (div:${ordDvsn})`,
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  /** 국내 일별 시세 조회 (MA200, RSI 계산용) */
  async getDailyPrices(stockCode: string, startDate: string, endDate: string): Promise<DailyPrice[]> {
    const results: DailyPrice[] = [];
    let currentEndDate = endDate;

    while (true) {
      const res = await this.kisBase.get(
        '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
        'FHKST03010100',
        {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: stockCode,
          FID_INPUT_DATE_1: startDate,
          FID_INPUT_DATE_2: currentEndDate,
          FID_PERIOD_DIV_CODE: 'D',
        },
      );

      const output2 = res.output2 as any[];
      if (!output2 || output2.length === 0) break;

      for (const item of output2) {
        const close = parseFloat(item.stck_clpr) || 0;
        if (close === 0) continue;
        results.push({
          date: item.stck_bsop_date,
          close,
          open: parseFloat(item.stck_oprc) || 0,
          high: parseFloat(item.stck_hgpr) || 0,
          low: parseFloat(item.stck_lwpr) || 0,
          volume: parseInt(item.acml_vol, 10) || 0,
        });
      }

      const lastDate = output2[output2.length - 1]?.stck_bsop_date;
      if (!lastDate || output2.length < 100) break;
      // 이전 날짜로 이동
      const d = new Date(lastDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
      d.setDate(d.getDate() - 1);
      currentEndDate = d.toISOString().slice(0, 10).replace(/-/g, '');
      if (currentEndDate < startDate) break;
    }

    return results;
  }

  /** 국내 매수 가능 금액 조회 */
  async getBuyableAmount(): Promise<{ cashAvailable: number }> {
    const trId = this.isPaper ? 'VTTC8908R' : 'TTTC8908R';

    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/trading/inquire-psbl-order',
      trId,
      {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        PDNO: '',
        ORD_UNPR: '0',
        ORD_DVSN: '01',
        CMA_EVLU_AMT_ICLD_YN: 'Y',
        OVRS_ICLD_YN: 'Y',
      },
    );

    const output = res.output as any;
    return {
      cashAvailable: parseFloat(output?.ord_psbl_cash) || 0,
    };
  }

  /** 국내 업종 지수 현재가 조회 */
  async getIndexPrice(indexCode: string): Promise<{ currentPrice: number; prevClose: number }> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/quotations/inquire-index-price',
      'FHPUP02100000',
      {
        FID_COND_MRKT_DIV_CODE: 'U',
        FID_INPUT_ISCD: indexCode,
      },
    );

    const output = res.output as any;
    return {
      currentPrice: parseFloat(output?.bstp_nmix_prpr) || 0,
      prevClose: parseFloat(output?.bstp_nmix_prdy_vrss) || 0,
    };
  }

  /** 국내 업종 지수 일별 시세 조회 */
  async getIndexDailyPrices(indexCode: string, startDate: string, endDate: string): Promise<DailyPrice[]> {
    const results: DailyPrice[] = [];
    let currentEndDate = endDate;

    while (true) {
      const res = await this.kisBase.get(
        '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
        'FHKUP03500100',
        {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_INPUT_ISCD: indexCode,
          FID_INPUT_DATE_1: startDate,
          FID_INPUT_DATE_2: currentEndDate,
          FID_PERIOD_DIV_CODE: 'D',
        },
      );

      const output2 = res.output2 as any[];
      if (!output2 || output2.length === 0) break;

      for (const item of output2) {
        const close = parseFloat(item.bstp_nmix_prpr) || 0;
        if (close === 0) continue;
        results.push({
          date: item.stck_bsop_date,
          close,
          open: parseFloat(item.bstp_nmix_oprc) || 0,
          high: parseFloat(item.bstp_nmix_hgpr) || 0,
          low: parseFloat(item.bstp_nmix_lwpr) || 0,
          volume: 0,
        });
      }

      const lastDate = output2[output2.length - 1]?.stck_bsop_date;
      if (!lastDate || output2.length < 50) break;
      const d = new Date(lastDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
      d.setDate(d.getDate() - 1);
      currentEndDate = d.toISOString().slice(0, 10).replace(/-/g, '');
      if (currentEndDate < startDate) break;
    }

    return results;
  }

  /** 금리 조회 (실전만) */
  async getInterestRates(): Promise<InterestRateItem[]> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/quotations/comp-interest',
      'FHPST07020000',
      {
        FID_COND_MRKT_DIV_CODE: 'I',
        FID_COND_SCR_DIV_CODE: '20702',
        FID_DIV_CLS_CODE: '1', // 해외금리
        FID_DIV_CLS_CODE1: '',
      },
    );

    const output1 = res.output1 as any[];
    if (!output1) return [];

    return output1.map((item: any) => ({
      name: item.hts_kor_isnm || '',
      rate: parseFloat(item.bond_mnrt_prpr) || 0,
      change: parseFloat(item.bond_mnrt_prdy_vrss) || 0,
    }));
  }

  /** 국내 휴장일 조회 (실전만, 일 1회 호출 권장) */
  async getHolidays(baseDate: string): Promise<HolidayItem[]> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/quotations/chk-holiday',
      'CTCA0903R',
      {
        BASS_DT: baseDate,
        CTX_AREA_NK: '',
        CTX_AREA_FK: '',
      },
    );

    const output = res.output as any[];
    if (!output) return [];

    return output.map((item: any) => ({
      date: item.bass_dt,
      name: item.bzdy_yn === 'N' ? '휴장' : '개장',
      isOpen: item.bzdy_yn === 'Y',
    }));
  }

  /** 국내 미체결 주문 조회 */
  async getUnfilledOrders(): Promise<UnfilledOrder[]> {
    const trId = this.isPaper ? 'VTTC0084R' : 'TTTC0084R';

    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl',
      trId,
      {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: '',
        INQR_DVSN_1: '0',
        INQR_DVSN_2: '0',
      },
    );

    const output = res.output as any[];
    if (!output) return [];

    return output
      .filter((item: any) => parseInt(item.psbl_qty, 10) > 0)
      .map((item: any) => ({
        orderNo: item.odno,
        stockCode: item.pdno,
        side: (item.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
        quantity: parseInt(item.psbl_qty, 10) || 0,
        price: parseFloat(item.ord_unpr) || 0,
      }));
  }

  /** 국내 주문 취소 */
  async cancelOrder(orderNo: string, stockCode: string, qty: number): Promise<OrderResult> {
    const trId = this.isPaper ? 'VTTC0013U' : 'TTTC0013U';

    try {
      const res = await this.kisBase.post<DomesticOrderOutput>(
        '/uapi/domestic-stock/v1/trading/order-rvsecncl',
        trId,
        {
          CANO: this.accountNo.substring(0, 8),
          ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
          KRX_FWDG_ORD_ORGNO: '',
          ORGN_ODNO: orderNo,
          ORD_DVSN: '00',
          RVSE_CNCL_DVSN_CD: '02', // 02=취소
          ORD_QTY: String(qty),
          ORD_UNPR: '0',
          QTY_ALL_ORD_YN: 'Y',
        },
      );
      return {
        success: true,
        orderNo: res.output?.ODNO,
        message: `Cancel order placed: ${stockCode} #${orderNo}`,
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  /** 국내 거래량순위 조회 */
  async getVolumeRanking(marketDiv = 'J'): Promise<any[]> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/quotations/volume-rank',
      'FHPST01710000',
      {
        FID_COND_MRKT_DIV_CODE: marketDiv,
        FID_COND_SCR_DIV_CODE: '20171',
        FID_INPUT_ISCD: '0000',
        FID_DIV_CLS_CODE: '0',
        FID_BLNG_CLS_CODE: '0',
        FID_TRGT_CLS_CODE: '111111111',
        FID_TRGT_EXLS_CLS_CODE: '0000000000',
        FID_INPUT_PRICE_1: '',
        FID_INPUT_PRICE_2: '',
        FID_VOL_CNT: '',
        FID_INPUT_DATE_1: '',
      },
    );
    return (res.output as any[]) || [];
  }

  /** 국내 등락률 순위 조회 */
  async getFluctuationRanking(marketDiv = 'J'): Promise<any[]> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/ranking/fluctuation',
      'FHPST01700000',
      {
        FID_COND_MRKT_DIV_CODE: marketDiv,
        FID_COND_SCR_DIV_CODE: '20170',
        FID_INPUT_ISCD: '0000',
        FID_RANK_SORT_CLS_CODE: '0', // 상승률순
        FID_INPUT_CNT_1: '0',
        FID_PRC_CLS_CODE: '0',
        FID_INPUT_PRICE_1: '',
        FID_INPUT_PRICE_2: '',
        FID_VOL_CNT: '',
        FID_TRGT_CLS_CODE: '0',
        FID_TRGT_EXLS_CLS_CODE: '0',
        FID_DIV_CLS_CODE: '0',
        FID_RSFL_RATE1: '',
        FID_RSFL_RATE2: '',
      },
    );
    return (res.output as any[]) || [];
  }

  /** 국내 재무비율 조회 (종목별) */
  async getFinancialRatio(stockCode: string): Promise<any[]> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/finance/financial-ratio',
      'FHKST66430300',
      {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    );
    return (res.output as any[]) || [];
  }

  /** 국내 기타주요비율 조회 (EV/EBITDA, 배당성향 등) */
  async getOtherMajorRatios(stockCode: string): Promise<any[]> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/finance/other-major-ratios',
      'FHKST66430500',
      {
        FID_DIV_CLS_CODE: '0',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: stockCode,
      },
    );
    return (res.output as any[]) || [];
  }

  /** 국내 기관/외국인 매매 종목 가집계 */
  async getForeignInstitutionTotal(marketDiv = 'J'): Promise<any[]> {
    const res = await this.kisBase.get(
      '/uapi/domestic-stock/v1/quotations/foreign-institution-total',
      'FHPTJ04400000',
      {
        FID_COND_MRKT_DIV_CODE: marketDiv,
        FID_COND_SCR_DIV_CODE: '16449',
        FID_INPUT_ISCD: '0000',
        FID_DIV_CLS_CODE: '0',
        FID_RANK_SORT_CLS_CODE: '0',
        FID_ETC_CLS_CODE: '',
      },
    );
    return (res.output as any[]) || [];
  }

  /** 국내 잔고 조회 */
  async getBalance(): Promise<BalanceItem[]> {
    const trId = this.isPaper ? 'VTTC8494R' : 'TTTC8494R';
    const items: BalanceItem[] = [];
    let ctxAreaFk100 = '';
    let ctxAreaNk100 = '';
    let hasMore = true;
    let depth = 0;

    while (hasMore && depth < 10) {
      const params: Record<string, string> = {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        AFHR_FLPR_YN: 'N',
        OFL_YN: '',
        INQR_DVSN: '02',
        UNPR_DVSN: '01',
        FUND_STTL_ICLD_YN: 'N',
        FNCG_AMT_AUTO_RDPT_YN: 'N',
        PRCS_DVSN: '00',
        CTX_AREA_FK100: ctxAreaFk100,
        CTX_AREA_NK100: ctxAreaNk100,
      };

      const additionalHeaders: Record<string, string> = {};
      if (ctxAreaFk100) {
        additionalHeaders['tr_cont'] = 'N';
      }

      const res = await this.kisBase.get(
        '/uapi/domestic-stock/v1/trading/inquire-balance-rlz-pl',
        trId,
        params,
        additionalHeaders,
      );

      const output1 = res.output1 as DomesticBalanceItem[];
      if (output1) {
        for (const item of output1) {
          const qty = parseInt(item.hldg_qty, 10) || 0;
          if (qty <= 0) continue;
          items.push({
            stockCode: item.pdno,
            stockName: item.prdt_name,
            quantity: qty,
            avgPrice: parseFloat(item.pchs_avg_pric) || 0,
            currentPrice: parseFloat(item.prpr) || 0,
            profitLoss: parseFloat(item.evlu_pfls_amt) || 0,
            profitRate: parseFloat(item.evlu_pfls_rt) || 0,
          });
        }
      }

      // 페이지네이션 체크
      ctxAreaFk100 = (res as any).ctx_area_fk100 || '';
      ctxAreaNk100 = (res as any).ctx_area_nk100 || '';
      hasMore = !!ctxAreaFk100;
      depth++;
    }

    return items;
  }
}
