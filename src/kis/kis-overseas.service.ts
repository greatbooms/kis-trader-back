import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import {
  OverseasPriceOutput,
  OverseasOrderOutput,
  OverseasBalanceItem,
  StockPriceResult,
  OrderResult,
  BalanceItem,
  DailyPrice,
  UnfilledOrder,
  HolidayItem,
} from './types/kis-api.types';
import {
  EXCHANGE_CODE_MAP,
  OVERSEAS_ORDER_TR_IDS,
} from './types/kis-config.types';

@Injectable()
export class KisOverseasService {
  private readonly logger = new Logger(KisOverseasService.name);
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

  /** 해외 현재가상세 조회 (PER/PBR/EPS/BPS 포함) */
  async getPrice(exchangeCode: string, symbol: string): Promise<StockPriceResult> {
    const excd = EXCHANGE_CODE_MAP[exchangeCode] || exchangeCode;

    const res = await this.kisBase.get<OverseasPriceOutput>(
      '/uapi/overseas-price/v1/quotations/price-detail',
      'HHDFS76200200',
      {
        AUTH: '',
        EXCD: excd,
        SYMB: symbol,
      },
    );

    const o = res.output!;
    const perx = o.perx ? parseFloat(o.perx) : undefined;
    const pbrx = o.pbrx ? parseFloat(o.pbrx) : undefined;
    const epsx = o.epsx ? parseFloat(o.epsx) : undefined;
    const bpsx = o.bpsx ? parseFloat(o.bpsx) : undefined;
    return {
      stockCode: symbol,
      stockName: o.name || symbol,
      currentPrice: parseFloat(o.last) || 0,
      openPrice: parseFloat(o.open) || 0,
      highPrice: parseFloat(o.high) || 0,
      lowPrice: parseFloat(o.low) || 0,
      volume: parseInt(o.tvol, 10) || 0,
      per: perx && !isNaN(perx) ? perx : undefined,
      pbr: pbrx && !isNaN(pbrx) ? pbrx : undefined,
      eps: epsx && !isNaN(epsx) ? epsx : undefined,
      bps: bpsx && !isNaN(bpsx) ? bpsx : undefined,
      w52High: o.h52p ? parseFloat(o.h52p) || undefined : undefined,
      w52Low: o.l52p ? parseFloat(o.l52p) || undefined : undefined,
      prevDayVolume: o.pvol ? parseInt(o.pvol, 10) || undefined : undefined,
      prevDayTradingValue: o.pamt ? parseFloat(o.pamt) || undefined : undefined,
      marketCap: o.tomv ? parseFloat(o.tomv) || undefined : undefined,
      listedShares: o.shar ? parseInt(o.shar, 10) || undefined : undefined,
      sector: o.e_icod || undefined,
      exchangeRate: o.t_rate ? parseFloat(o.t_rate) || undefined : undefined,
      krwPrice: o.t_xprc ? parseFloat(o.t_xprc) || undefined : undefined,
    };
  }

  /** 해외 매수 */
  async orderBuy(
    exchangeCode: string,
    symbol: string,
    qty: number,
    price: number,
    orderDivision = '00',
  ): Promise<OrderResult> {
    return this.order(exchangeCode, symbol, qty, price, 'BUY', orderDivision);
  }

  /** 해외 매도 */
  async orderSell(
    exchangeCode: string,
    symbol: string,
    qty: number,
    price: number,
    orderDivision = '00',
  ): Promise<OrderResult> {
    return this.order(exchangeCode, symbol, qty, price, 'SELL', orderDivision);
  }

  private async order(
    exchangeCode: string,
    symbol: string,
    qty: number,
    price: number,
    side: 'BUY' | 'SELL',
    orderDivision = '00',
  ): Promise<OrderResult> {
    const trIds = OVERSEAS_ORDER_TR_IDS[exchangeCode];
    if (!trIds) {
      return { success: false, message: `Unsupported exchange: ${exchangeCode}` };
    }

    const trId = this.isPaper
      ? side === 'BUY' ? trIds.buyPaper : trIds.sellPaper
      : side === 'BUY' ? trIds.buy : trIds.sell;

    const body = {
      CANO: this.accountNo.substring(0, 8),
      ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
      OVRS_EXCG_CD: exchangeCode,
      PDNO: symbol,
      ORD_QTY: String(qty),
      OVRS_ORD_UNPR: String(price),
      CTAC_TLNO: '',
      MGCO_APTM_ODNO: '',
      ORD_SVR_DVSN_CD: '0',
      ORD_DVSN: orderDivision,
    };

    try {
      const res = await this.kisBase.post<OverseasOrderOutput>(
        '/uapi/overseas-stock/v1/trading/order',
        trId,
        body,
      );
      return {
        success: true,
        orderNo: res.output?.ODNO,
        message: `${side} order placed: ${exchangeCode}:${symbol} x ${qty} @ ${price} (div:${orderDivision})`,
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  /** 해외 일별 시세 조회 (MA200, RSI 계산용) */
  async getDailyPrices(exchangeCode: string, stockCode: string, count = 200): Promise<DailyPrice[]> {
    const excd = EXCHANGE_CODE_MAP[exchangeCode] || exchangeCode;
    const results: DailyPrice[] = [];
    let bymd = ''; // 빈 문자열 = 최근부터

    while (results.length < count) {
      const res = await this.kisBase.get(
        '/uapi/overseas-price/v1/quotations/dailyprice',
        'HHDFS76240000',
        {
          AUTH: '',
          EXCD: excd,
          SYMB: stockCode,
          GUBN: '0', // 일
          BYMD: bymd,
          MODP: '1', // 수정주가
        },
      );

      const output2 = res.output2 as any[];
      if (!output2 || output2.length === 0) break;

      for (const item of output2) {
        if (results.length >= count) break;
        const close = parseFloat(item.clos) || 0;
        if (close === 0) continue;
        results.push({
          date: item.xymd,
          close,
          open: parseFloat(item.open) || 0,
          high: parseFloat(item.high) || 0,
          low: parseFloat(item.low) || 0,
          volume: parseInt(item.tvol, 10) || 0,
        });
      }

      // 다음 페이지: 마지막 항목의 날짜
      const lastDate = output2[output2.length - 1]?.xymd;
      if (!lastDate || output2.length < 100) break;
      bymd = lastDate;
    }

    return results;
  }

  /** 해외 지수 일별 시세 조회 (시장 상황 판단용) */
  async getOverseasIndexDailyPrices(indexCode: string, startDate: string, endDate: string): Promise<DailyPrice[]> {
    const results: DailyPrice[] = [];
    let currentEndDate = endDate;

    while (true) {
      const res = await this.kisBase.get(
        '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',
        'FHKST03030100',
        {
          FID_COND_MRKT_DIV_CODE: 'N', // 해외지수
          FID_INPUT_ISCD: indexCode,
          FID_INPUT_DATE_1: startDate,
          FID_INPUT_DATE_2: currentEndDate,
          FID_PERIOD_DIV_CODE: 'D',
        },
      );

      const output2 = res.output2 as any[];
      if (!output2 || output2.length === 0) break;

      for (const item of output2) {
        const close = parseFloat(item.ovrs_nmix_prpr) || 0;
        if (close === 0) continue;
        results.push({
          date: item.stck_bsop_date,
          close,
          open: parseFloat(item.ovrs_nmix_oprc) || 0,
          high: parseFloat(item.ovrs_nmix_hgpr) || 0,
          low: parseFloat(item.ovrs_nmix_lwpr) || 0,
          volume: 0,
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

  /** 해외 매수 가능 금액 조회 */
  async getBuyableAmount(exchangeCode: string, stockCode: string, price: number): Promise<{ foreignCurrencyAvailable: number; maxQuantity: number }> {
    const trId = this.isPaper ? 'VTTS3007R' : 'TTTS3007R';

    const res = await this.kisBase.get(
      '/uapi/overseas-stock/v1/trading/inquire-psamount',
      trId,
      {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        OVRS_EXCG_CD: exchangeCode,
        OVRS_ORD_UNPR: String(price),
        ITEM_CD: stockCode,
      },
    );

    const output = res.output as any;
    return {
      foreignCurrencyAvailable: parseFloat(output?.ovrs_ord_psbl_amt) || 0,
      maxQuantity: parseInt(output?.max_ord_psbl_qty, 10) || 0,
    };
  }

  /** 해외 미체결 주문 조회 */
  async getUnfilledOrders(): Promise<UnfilledOrder[]> {
    const trId = this.isPaper ? 'VTTS3018R' : 'TTTS3018R';

    const res = await this.kisBase.get(
      '/uapi/overseas-stock/v1/trading/inquire-nccs',
      trId,
      {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        OVRS_EXCG_CD: '',
        SORT_SQN: 'DS',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: '',
      },
    );

    const output = res.output as any[];
    if (!output) return [];

    return output
      .filter((item: any) => parseInt(item.nccs_qty, 10) > 0)
      .map((item: any) => ({
        orderNo: item.odno,
        stockCode: item.pdno,
        side: (item.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
        quantity: parseInt(item.nccs_qty, 10) || 0,
        price: parseFloat(item.ft_ord_unpr3) || 0,
        exchangeCode: item.ovrs_excg_cd,
      }));
  }

  /** 해외 주문 취소 */
  async cancelOrder(exchangeCode: string, orderNo: string, stockCode: string, qty: number, price: number): Promise<OrderResult> {
    // 미국 시장 취소 TR
    const trIds = OVERSEAS_ORDER_TR_IDS[exchangeCode];
    if (!trIds) {
      return { success: false, message: `Unsupported exchange for cancel: ${exchangeCode}` };
    }

    // 정정/취소는 매도 TR ID 계열 사용
    const trId = this.isPaper ? trIds.sellPaper : trIds.sell;

    try {
      const res = await this.kisBase.post<OverseasOrderOutput>(
        '/uapi/overseas-stock/v1/trading/order-rvsecncl',
        trId,
        {
          CANO: this.accountNo.substring(0, 8),
          ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
          OVRS_EXCG_CD: exchangeCode,
          PDNO: stockCode,
          ORGN_ODNO: orderNo,
          RVSE_CNCL_DVSN_CD: '02', // 02=취소
          ORD_QTY: String(qty),
          OVRS_ORD_UNPR: String(price),
          MGCO_APTM_ODNO: '',
          ORD_SVR_DVSN_CD: '0',
        },
      );
      return {
        success: true,
        orderNo: res.output?.ODNO,
        message: `Cancel order placed: ${exchangeCode}:${stockCode} #${orderNo}`,
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  /** 해외 휴장일 조회 */
  async getOverseasHolidays(baseDate: string): Promise<HolidayItem[]> {
    const res = await this.kisBase.get(
      '/uapi/overseas-stock/v1/quotations/countries-holiday',
      'CTOS5011R',
      {
        TRAD_DT: baseDate,
        CTX_AREA_NK: '',
        CTX_AREA_FK: '',
      },
    );

    const output = res.output as any[];
    if (!output) return [];

    return output.map((item: any) => ({
      date: item.trad_dt,
      name: item.holi_nm || '',
      isOpen: item.opnd_yn === 'Y',
    }));
  }

  /** 해외 조건검색 */
  async searchStocks(exchangeCode: string, options: {
    minPrice?: number; maxPrice?: number;
    minMarketCap?: number; maxMarketCap?: number;
    minVolume?: number; maxVolume?: number;
    minPer?: number; maxPer?: number;
  } = {}): Promise<any[]> {
    const excd = EXCHANGE_CODE_MAP[exchangeCode] || exchangeCode;
    const params: Record<string, string> = {
      AUTH: '',
      EXCD: excd,
      CO_YN_PRICECUR: options.minPrice || options.maxPrice ? '1' : '',
      CO_ST_PRICECUR: options.minPrice ? String(options.minPrice) : '',
      CO_EN_PRICECUR: options.maxPrice ? String(options.maxPrice) : '',
      CO_YN_RATE: '',
      CO_ST_RATE: '',
      CO_EN_RATE: '',
      CO_YN_VALX: options.minMarketCap ? '1' : '',
      CO_ST_VALX: options.minMarketCap ? String(options.minMarketCap) : '',
      CO_EN_VALX: options.maxMarketCap ? String(options.maxMarketCap) : '',
      CO_YN_SHAR: '',
      CO_ST_SHAR: '',
      CO_EN_SHAR: '',
      CO_YN_VOLUME: options.minVolume ? '1' : '',
      CO_ST_VOLUME: options.minVolume ? String(options.minVolume) : '',
      CO_EN_VOLUME: options.maxVolume ? String(options.maxVolume) : '',
      CO_YN_AMT: '',
      CO_ST_AMT: '',
      CO_EN_AMT: '',
      CO_YN_EPS: '',
      CO_ST_EPS: '',
      CO_EN_EPS: '',
      CO_YN_PER: options.minPer || options.maxPer ? '1' : '',
      CO_ST_PER: options.minPer ? String(options.minPer) : '',
      CO_EN_PER: options.maxPer ? String(options.maxPer) : '',
      KEYB: '',
    };

    const res = await this.kisBase.get(
      '/uapi/overseas-price/v1/quotations/inquire-search',
      'HHDFS76410000',
      params,
    );
    const output = (res.output2 as any[]) || [];
    if (output.length === 0) {
      this.logger.debug(`searchStocks(${exchangeCode}) empty response - rt_cd: ${res.rt_cd}, msg1: ${res.msg1}`);
    }
    return output;
  }

  /** 해외 거래량순위 */
  async getVolumeRanking(exchangeCode: string): Promise<any[]> {
    const excd = EXCHANGE_CODE_MAP[exchangeCode] || exchangeCode;
    const res = await this.kisBase.get(
      '/uapi/overseas-stock/v1/ranking/trade-vol',
      'HHDFS76310010',
      {
        AUTH: '',
        EXCD: excd,
        NDAY: '0',
        PRC1: '',
        PRC2: '',
        VOL_RANG: '0',
        KEYB: '',
      },
    );
    const output = (res.output2 as any[]) || [];
    if (output.length === 0) {
      this.logger.debug(`getVolumeRanking(${exchangeCode}) empty response - rt_cd: ${res.rt_cd}, msg1: ${res.msg1}`);
    }
    return output;
  }

  /** 해외 잔고 조회 */
  async getBalance(nationCode = '000'): Promise<BalanceItem[]> {
    const trId = this.isPaper ? 'VTRP6504R' : 'CTRP6504R';
    const items: BalanceItem[] = [];
    let ctxAreaFk200 = '';
    let ctxAreaNk200 = '';
    let hasMore = true;
    let depth = 0;

    while (hasMore && depth < 10) {
      const params: Record<string, string> = {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        WCRC_FRCR_DVSN_CD: '02',
        NATN_CD: nationCode,
        TR_MKET_CD: '00',
        INQR_DVSN_CD: '00',
      };

      if (ctxAreaFk200) {
        params['CTX_AREA_FK200'] = ctxAreaFk200;
        params['CTX_AREA_NK200'] = ctxAreaNk200;
      }

      const res = await this.kisBase.get(
        '/uapi/overseas-stock/v1/trading/inquire-present-balance',
        trId,
        params,
      );

      const output1 = res.output1 as OverseasBalanceItem[];
      if (output1) {
        for (const item of output1) {
          const qty = parseInt(item.ovrs_cblc_qty, 10) || 0;
          if (qty <= 0) continue;
          items.push({
            stockCode: item.ovrs_pdno,
            stockName: item.ovrs_item_name,
            quantity: qty,
            avgPrice: parseFloat(item.pchs_avg_pric) || 0,
            currentPrice: parseFloat(item.now_pric2) || 0,
            profitLoss: parseFloat(item.ovrs_stck_evlu_pfls_amt) || 0,
            profitRate: parseFloat(item.evlu_pfls_rt) || 0,
            exchangeCode: item.ovrs_excg_cd,
          });
        }
      }

      ctxAreaFk200 = (res as any).ctx_area_fk200 || '';
      ctxAreaNk200 = (res as any).ctx_area_nk200 || '';
      hasMore = !!ctxAreaFk200;
      depth++;
    }

    return items;
  }
}
