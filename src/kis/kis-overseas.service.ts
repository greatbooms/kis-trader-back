import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import {
  OverseasPriceOutput,
  OverseasOrderOutput,
  OverseasBalanceItem,
  OverseasPresentBalanceCurrencyItem,
  OverseasStandardBalanceItem,
  StockPriceResult,
  OrderResult,
  BalanceItem,
  DailyPrice,
  IntradayPrice,
  UnfilledOrder,
  HolidayItem,
  BrokerOrderStatus,
} from './types/kis-api.types';
import {
  EXCHANGE_CODE_MAP,
  EXCHANGE_CURRENCY,
  OVERSEAS_ORDER_TR_IDS,
} from './types/kis-config.types';

@Injectable()
export class KisOverseasService {
  private readonly logger = new Logger(KisOverseasService.name);
  private readonly accountNo: string;
  private readonly prodCode: string;
  private readonly isPaper: boolean;
  private readonly debugRawBalance: boolean;
  private useStandardBalanceOnly = false;

  constructor(
    private kisBase: KisBaseService,
    private configService: ConfigService,
  ) {
    this.accountNo = this.configService.get<string>('kis.accountNo')!;
    this.prodCode = this.configService.get<string>('kis.prodCode')!;
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
    this.debugRawBalance = this.configService.get<boolean>('kis.debugRawBalance') ?? false;
  }

  private hasContinuationToken(token?: string): boolean {
    return (token?.trim().length ?? 0) > 0;
  }

  private hasRepeatedContinuationToken(
    previousFk: string,
    previousNk: string,
    nextFk: string,
    nextNk: string,
  ): boolean {
    return (
      this.hasContinuationToken(nextFk) &&
      previousFk === nextFk &&
      previousNk === nextNk
    );
  }

  private pickQuantityFields(row: Record<string, any> | undefined): Record<string, any> {
    if (!row) return {};
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => /qty|qnt|cblc|hldg|ccld/i.test(key)),
    );
  }

  private logRawBalancePage(
    label: string,
    output1: unknown,
    output2: unknown,
    extra?: Record<string, any>,
    force = false,
  ): void {
    if (!this.debugRawBalance && !force) return;

    const rows1 = Array.isArray(output1) ? output1 : [];
    const rows2 = Array.isArray(output2) ? output2 : [];
    const first1 = rows1[0] as Record<string, any> | undefined;
    const first2 = rows2[0] as Record<string, any> | undefined;

    this.logger.warn(
      `[KIS DEBUG] ${label} summary ${JSON.stringify({
        output1Count: rows1.length,
        output2Count: rows2.length,
        output1Keys: first1 ? Object.keys(first1) : [],
        output2Keys: first2 ? Object.keys(first2) : [],
        output1QuantityFields: this.pickQuantityFields(first1),
        ...extra,
      })}`,
    );

    if (first1) {
      this.logger.warn(`[KIS DEBUG] ${label} output1[0] ${JSON.stringify(first1)}`);
    }
    if (first2) {
      this.logger.warn(`[KIS DEBUG] ${label} output2[0] ${JSON.stringify(first2)}`);
    }
  }

  private readNumber(
    row: Record<string, any>,
    ...keys: string[]
  ): number | undefined {
    for (const key of keys) {
      const value = row[key];
      if (value === undefined || value === null || value === '') continue;
      const parsed = parseFloat(String(value));
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private readString(
    row: Record<string, any>,
    ...keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = row[key];
      if (value === undefined || value === null) continue;
      const trimmed = String(value).trim();
      if (trimmed.length > 0) return trimmed;
    }
    return undefined;
  }

  private parseOverseasPresentBalanceRow(row: Record<string, any>): BalanceItem | undefined {
    const quantity = Math.trunc(
      this.readNumber(row, 'ovrs_cblc_qty', 'ccld_qty_smtl1', 'ord_psbl_qty1', 'cblc_qty13') || 0,
    );
    if (quantity <= 0) return undefined;

    const exchangeRate = this.readNumber(row, 'bass_exrt') || 0;
    const unitAmount = this.readNumber(row, 'unit_amt') || 1;
    const useConvertedPricing = row.ovrs_now_pric1 !== undefined;
    const avgPrice = useConvertedPricing
      ? this.toLocalCurrencyPrice(
          String(this.readNumber(row, 'avg_unpr3', 'pchs_avg_pric') || 0),
          exchangeRate,
          unitAmount,
        )
      : (this.readNumber(row, 'pchs_avg_pric') || 0);
    const currentPrice = useConvertedPricing
      ? this.toLocalCurrencyPrice(String(this.readNumber(row, 'ovrs_now_pric1') || 0), exchangeRate, unitAmount)
      : (this.readNumber(row, 'now_pric2') || 0);
    const profitLoss = row.frcr_evlu_pfls_amt !== undefined
      ? (this.readNumber(row, 'frcr_evlu_pfls_amt') || 0)
      : useConvertedPricing
        ? this.toLocalCurrencyPrice(String(this.readNumber(row, 'evlu_pfls_amt2') || 0), exchangeRate, unitAmount)
        : (this.readNumber(row, 'ovrs_stck_evlu_pfls_amt', 'evlu_pfls_amt2') || 0);

    return {
      stockCode: this.readString(row, 'ovrs_pdno', 'pdno') || '',
      stockName: this.readString(row, 'ovrs_item_name', 'prdt_name') || '',
      quantity,
      avgPrice,
      currentPrice,
      profitLoss,
      profitRate: this.readNumber(row, 'evlu_pfls_rt', 'evlu_pfls_rt1') || 0,
      exchangeCode: this.readString(row, 'ovrs_excg_cd'),
    };
  }

  private parseOverseasStandardBalanceRow(
    row: Record<string, any>,
    fallbackExchangeCode: string,
  ): BalanceItem | undefined {
    const quantity = Math.trunc(
      this.readNumber(row, 'ccld_qty_smtl1', 'ovrs_cblc_qty', 'ord_psbl_qty') || 0,
    );
    if (quantity <= 0) return undefined;

    const exchangeRate = this.readNumber(row, 'bass_exrt') || 0;
    const unitAmount = this.readNumber(row, 'unit_amt') || 1;
    const hasDirectPricing = row.now_pric2 !== undefined || row.pchs_avg_pric !== undefined;
    const avgPrice = hasDirectPricing
      ? (this.readNumber(row, 'pchs_avg_pric') || 0)
      : this.toLocalCurrencyPrice(String(this.readNumber(row, 'avg_unpr3') || 0), exchangeRate, unitAmount);
    const currentPrice = hasDirectPricing
      ? (this.readNumber(row, 'now_pric2') || 0)
      : this.toLocalCurrencyPrice(String(this.readNumber(row, 'ovrs_now_pric1') || 0), exchangeRate, unitAmount);
    const profitLoss = row.frcr_evlu_pfls_amt !== undefined
      ? (this.readNumber(row, 'frcr_evlu_pfls_amt') || 0)
      : this.toLocalCurrencyPrice(String(this.readNumber(row, 'evlu_pfls_amt2') || 0), exchangeRate, unitAmount);

    return {
      stockCode: this.readString(row, 'pdno', 'ovrs_pdno') || '',
      stockName: this.readString(row, 'prdt_name', 'ovrs_item_name') || '',
      quantity,
      avgPrice,
      currentPrice,
      profitLoss,
      profitRate: this.readNumber(row, 'evlu_pfls_rt1', 'evlu_pfls_rt') || 0,
      exchangeCode: this.readString(row, 'ovrs_excg_cd') || fallbackExchangeCode,
    };
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

  /** 해외 분봉 시세 조회 (VWAP 등 장중 판단용) */
  async getIntradayPrices(
    exchangeCode: string,
    stockCode: string,
    intervalMinutes = 5,
    count = 120,
  ): Promise<IntradayPrice[]> {
    const excd = EXCHANGE_CODE_MAP[exchangeCode] || exchangeCode;
    const res = await this.kisBase.get(
      '/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice',
      'HHDFS76950200',
      {
        AUTH: '',
        EXCD: excd,
        SYMB: stockCode,
        NMIN: String(intervalMinutes),
        PINC: '0',
        NEXT: '',
        NREC: String(Math.min(count, 120)),
        FILL: '',
        KEYB: '',
      },
    );

    const output2 = res.output2 as any[];
    if (!output2 || output2.length === 0) return [];

    return output2
      .map((item) => ({
        date: item.xymd,
        time: item.xhms,
        open: parseFloat(item.open) || 0,
        high: parseFloat(item.high) || 0,
        low: parseFloat(item.low) || 0,
        close: parseFloat(item.last) || 0,
        volume: parseInt(item.evol, 10) || 0,
        amount: item.eamt ? parseFloat(item.eamt) || undefined : undefined,
      }))
      .filter((item) => item.close > 0 && item.volume > 0);
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

  async getCashBalances(): Promise<Array<{
    currencyCode: string;
    currencyName?: string;
    amount: number;
    withdrawableAmount?: number;
  }>> {
    const snapshot = await this.getAccountSnapshot();
    return snapshot.cashBalances;
  }

  async getAccountSnapshot(nationCode = '000'): Promise<{
    balance: BalanceItem[];
    cashBalances: Array<{
      currencyCode: string;
      currencyName?: string;
      amount: number;
      withdrawableAmount?: number;
    }>;
  }> {
    if (this.isPaper || this.useStandardBalanceOnly) {
      return {
        balance: await this.getStandardBalance(),
        cashBalances: [],
      };
    }

    try {
      return await this.getPresentBalanceSnapshot(nationCode);
    } catch (error) {
      if (!this.shouldFallbackToStandardBalance(error)) {
        throw error;
      }

      this.useStandardBalanceOnly = true;
      this.logger.warn(
        `Falling back to overseas standard balance API after present balance failure: ${error.message}`,
      );
      return {
        balance: await this.getStandardBalance(),
        cashBalances: [],
      };
    }
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

  /** 해외 주문/체결 조회 */
  async getOrderExecutions(startDate: string, endDate: string): Promise<BrokerOrderStatus[]> {
    const trId = this.isPaper ? 'VTTS3035R' : 'TTTS3035R';

    const res = await this.kisBase.get(
      '/uapi/overseas-stock/v1/trading/inquire-ccnl',
      trId,
      {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        PDNO: '',
        ORD_STRT_DT: startDate,
        ORD_END_DT: endDate,
        SLL_BUY_DVSN: '00',
        CCLD_NCCS_DVSN: '00',
        OVRS_EXCG_CD: '',
        SORT_SQN: 'DS',
        ORD_DT: '',
        ORD_GNO_BRNO: '',
        ODNO: '',
        CTX_AREA_NK200: '',
        CTX_AREA_FK200: '',
      },
    );

    const output = (res.output as any[]) || [];
    return output
      .filter((item: any) => !!item.odno)
      .map((item: any) => {
        const orderQuantity = parseInt(item.ft_ord_qty, 10) || 0;
        const filledQuantity = parseInt(item.ft_ccld_qty, 10) || 0;
        const remainingQuantity = item.nccs_qty
          ? parseInt(item.nccs_qty, 10) || 0
          : Math.max(0, orderQuantity - filledQuantity);
        const rejectedReason = item.rjct_rson_name || item.rjct_rson || undefined;

        return {
          orderNo: item.odno,
          stockCode: item.pdno,
          side: (item.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
          orderQuantity,
          filledQuantity,
          remainingQuantity,
          orderPrice: item.ft_ord_unpr3 ? parseFloat(item.ft_ord_unpr3) || 0 : undefined,
          filledPrice: item.ft_ccld_unpr3 ? parseFloat(item.ft_ccld_unpr3) || 0 : undefined,
          exchangeCode: item.ovrs_excg_cd,
          orderDate: item.ord_dt,
          orderTime: item.ord_tmd,
          rejected: !!rejectedReason,
          rejectedReason,
        };
      });
  }

  /** 해외 주문 취소 */
  async cancelOrder(exchangeCode: string, orderNo: string, stockCode: string, qty: number, _price: number): Promise<OrderResult> {
    const trIds = OVERSEAS_ORDER_TR_IDS[exchangeCode];
    if (!trIds) {
      return { success: false, message: `Unsupported exchange for cancel: ${exchangeCode}` };
    }

    const trId = this.isPaper ? trIds.cancelPaper : trIds.cancel;

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
          OVRS_ORD_UNPR: '0',
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
      exchangeCode: item.ovrs_excg_cd || item.excg_cd || item.excd || undefined,
      countryCode: item.natn_cd || item.cnty_cd || item.country_cd || undefined,
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

  private async fetchRanking(
    exchangeCode: string,
    endpoint: string,
    trId: string,
    params: Record<string, string> = {},
  ): Promise<any[]> {
    const excd = EXCHANGE_CODE_MAP[exchangeCode] || exchangeCode;
    const res = await this.kisBase.get(
      endpoint,
      trId,
      {
        AUTH: '',
        EXCD: excd,
        NDAY: '0',
        PRC1: '',
        PRC2: '',
        KEYB: '',
        ...params,
      },
    );

    return (res.output2 as any[]) || [];
  }

  /** 해외 거래량순위 */
  async getVolumeRanking(exchangeCode: string): Promise<any[]> {
    const output = await this.fetchRanking(
      exchangeCode,
      '/uapi/overseas-stock/v1/ranking/trade-vol',
      'HHDFS76310010',
      { VOL_RANG: '0' },
    );
    if (output.length === 0) {
      this.logger.debug(`getVolumeRanking(${exchangeCode}) empty response`);
    }
    return output;
  }

  async getTradeValueRanking(exchangeCode: string): Promise<any[]> {
    const output = await this.fetchRanking(
      exchangeCode,
      '/uapi/overseas-stock/v1/ranking/trade-pbmn',
      'HHDFS76320010',
      {
        VOL_RANG: '0',
      },
    );
    if (output.length === 0) {
      this.logger.debug(`getTradeValueRanking(${exchangeCode}) empty response`);
    }
    return output;
  }

  async getTurnoverRanking(exchangeCode: string): Promise<any[]> {
    const output = await this.fetchRanking(
      exchangeCode,
      '/uapi/overseas-stock/v1/ranking/trade-turnover',
      'HHDFS76340000',
      {
        VOL_RANG: '0',
      },
    );
    if (output.length === 0) {
      this.logger.debug(`getTurnoverRanking(${exchangeCode}) empty response`);
    }
    return output;
  }

  async getMarketCapRanking(exchangeCode: string): Promise<any[]> {
    const output = await this.fetchRanking(
      exchangeCode,
      '/uapi/overseas-stock/v1/ranking/market-cap',
      'HHDFS76350100',
      {
        CURR_GB: '',
        VOL_RANG: '0',
      },
    );
    if (output.length === 0) {
      this.logger.debug(`getMarketCapRanking(${exchangeCode}) empty response`);
    }
    return output;
  }

  async getUpDownRanking(exchangeCode: string): Promise<any[]> {
    const output = await this.fetchRanking(
      exchangeCode,
      '/uapi/overseas-stock/v1/ranking/updown-rate',
      'HHDFS76290000',
      {
        GUBN: '1',
        VOL_RANG: '0',
      },
    );
    if (output.length === 0) {
      this.logger.debug(`getUpDownRanking(${exchangeCode}) empty response`);
    }
    return output;
  }

  /** 해외 잔고 조회 */
  async getBalance(nationCode = '000'): Promise<BalanceItem[]> {
    if (this.isPaper || this.useStandardBalanceOnly) {
      return this.getStandardBalance();
    }

    try {
      return (await this.getPresentBalanceSnapshot(nationCode)).balance;
    } catch (error) {
      if (!this.shouldFallbackToStandardBalance(error)) {
        throw error;
      }

      this.useStandardBalanceOnly = true;
      this.logger.warn(
        `Falling back to overseas standard balance API after present balance failure: ${error.message}`,
      );
      return this.getStandardBalance();
    }
  }

  private async getPresentBalanceSnapshot(nationCode = '000'): Promise<{
    balance: BalanceItem[];
    cashBalances: Array<{
      currencyCode: string;
      currencyName?: string;
      amount: number;
      withdrawableAmount?: number;
    }>;
  }> {
    const trId = this.isPaper ? 'VTRP6504R' : 'CTRP6504R';
    const items: BalanceItem[] = [];
    let rawItemCount = 0;
    const cashBalances = new Map<string, {
      currencyCode: string;
      currencyName?: string;
      amount: number;
      withdrawableAmount?: number;
    }>();
    let ctxAreaFk200 = '';
    let ctxAreaNk200 = '';
    let hasMore = true;
    let depth = 0;

    while (hasMore && depth < 10) {
      const params: Record<string, string> = {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
        WCRC_FRCR_DVSN_CD: '01',
        NATN_CD: nationCode,
        TR_MKET_CD: '00',
        INQR_DVSN_CD: '00',
      };

      if (this.hasContinuationToken(ctxAreaFk200)) {
        params['CTX_AREA_FK200'] = ctxAreaFk200;
        params['CTX_AREA_NK200'] = ctxAreaNk200;
      }

      const res = await this.kisBase.get(
        '/uapi/overseas-stock/v1/trading/inquire-present-balance',
        trId,
        params,
      );

      const output1 = res.output1 as OverseasBalanceItem[];
      const parsedCountBefore = items.length;
      this.logRawBalancePage(
        'present-balance',
        output1,
        res.output2,
        { page: depth + 1 },
      );
      if (output1) {
        rawItemCount += output1.length;
        for (const item of output1) {
          const parsed = this.parseOverseasPresentBalanceRow(item as unknown as Record<string, any>);
          if (!parsed) {
            if (this.debugRawBalance) {
              this.logger.warn(
                `[KIS DEBUG] present-balance skipped row due to qty<=0 ${JSON.stringify({
                  stockCode: this.readString(item as unknown as Record<string, any>, 'ovrs_pdno', 'pdno'),
                  exchangeCode: this.readString(item as unknown as Record<string, any>, 'ovrs_excg_cd'),
                  parsedQty: this.readNumber(item as unknown as Record<string, any>, 'ovrs_cblc_qty', 'ccld_qty_smtl1', 'ord_psbl_qty1', 'cblc_qty13') || 0,
                  quantityFields: this.pickQuantityFields(item as unknown as Record<string, any>),
                  row: item,
                })}`,
              );
            }
            continue;
          }
          items.push(parsed);
        }
      }

      if ((output1?.length ?? 0) > 0 && items.length === parsedCountBefore) {
        this.logRawBalancePage(
          'present-balance:unparsed-page',
          output1,
          res.output2,
          { page: depth + 1, parsedCountBefore, parsedCountAfter: items.length },
          true,
        );
      }

      const output2 = (res.output2 as OverseasPresentBalanceCurrencyItem[]) || [];
      for (const item of output2) {
        if (!item.crcy_cd) continue;
        cashBalances.set(item.crcy_cd, {
          currencyCode: item.crcy_cd,
          currencyName: item.crcy_cd_name || undefined,
          amount: parseFloat(item.frcr_dncl_amt_2) || 0,
          withdrawableAmount: parseFloat(item.frcr_drwg_psbl_amt_1) || 0,
        });
      }

      const nextCtxAreaFk200 = ((res as any).ctx_area_fk200 || '').trim();
      const nextCtxAreaNk200 = ((res as any).ctx_area_nk200 || '').trim();

      this.logger.debug(
        `Overseas present balance page ${depth + 1}: received=${output1?.length ?? 0}, accumulated=${items.length}, currencies=${cashBalances.size}, nextFk200Length=${nextCtxAreaFk200.length}, nextNk200Length=${nextCtxAreaNk200.length}`,
      );

      if (
        this.hasRepeatedContinuationToken(
          ctxAreaFk200,
          ctxAreaNk200,
          nextCtxAreaFk200,
          nextCtxAreaNk200,
        )
      ) {
        this.logger.warn(
          `Overseas present balance pagination stalled at page ${depth + 1}; stopping repeated continuation token loop`,
        );
        break;
      }

      ctxAreaFk200 = nextCtxAreaFk200;
      ctxAreaNk200 = nextCtxAreaNk200;
      hasMore = this.hasContinuationToken(ctxAreaFk200);
      depth++;
    }

    if (rawItemCount > 0 && items.length === 0) {
      this.logRawBalancePage(
        'present-balance:unparsed-fallback',
        [],
        Array.from(cashBalances.values()),
        { rawItemCount, parsedCount: items.length },
        true,
      );
      this.logger.warn(
        'Overseas present balance returned raw items but no usable holdings; falling back to standard balance parser',
      );
      return {
        balance: await this.getStandardBalance(),
        cashBalances: Array.from(cashBalances.values()),
      };
    }

    return {
      balance: items,
      cashBalances: Array.from(cashBalances.values()),
    };
  }

  private async getStandardBalance(): Promise<BalanceItem[]> {
    const items: BalanceItem[] = [];
    const exchanges = this.getStandardBalanceExchanges();

    for (const exchangeCode of exchanges) {
      const currencyCode = EXCHANGE_CURRENCY[exchangeCode];
      if (!currencyCode) continue;

      let ctxAreaFk200 = '';
      let ctxAreaNk200 = '';
      let hasMore = true;
      let depth = 0;

      while (hasMore && depth < 10) {
        const params: Record<string, string> = {
          CANO: this.accountNo.substring(0, 8),
          ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
          OVRS_EXCG_CD: exchangeCode,
          TR_CRCY_CD: currencyCode,
          CTX_AREA_FK200: ctxAreaFk200,
          CTX_AREA_NK200: ctxAreaNk200,
        };

        const additionalHeaders: Record<string, string> = {};
        if (this.hasContinuationToken(ctxAreaFk200)) {
          additionalHeaders['tr_cont'] = 'N';
        }

        const res = await this.kisBase.get(
          '/uapi/overseas-stock/v1/trading/inquire-balance',
          this.isPaper ? 'VTTS3012R' : 'TTTS3012R',
          params,
          additionalHeaders,
        );

        const output1 = res.output1 as OverseasStandardBalanceItem[];
        const parsedCountBefore = items.length;
        this.logRawBalancePage(
          `standard-balance:${exchangeCode}`,
          output1,
          undefined,
          { page: depth + 1, currencyCode },
        );
        if (output1) {
          for (const item of output1) {
            const parsed = this.parseOverseasStandardBalanceRow(
              item as unknown as Record<string, any>,
              exchangeCode,
            );
            if (!parsed) {
              if (this.debugRawBalance) {
                this.logger.warn(
                  `[KIS DEBUG] standard-balance skipped row due to qty<=0 ${JSON.stringify({
                    stockCode: this.readString(item as unknown as Record<string, any>, 'pdno', 'ovrs_pdno'),
                    exchangeCode: this.readString(item as unknown as Record<string, any>, 'ovrs_excg_cd') || exchangeCode,
                    parsedQty: this.readNumber(item as unknown as Record<string, any>, 'ccld_qty_smtl1', 'ovrs_cblc_qty', 'ord_psbl_qty') || 0,
                    quantityFields: this.pickQuantityFields(item as unknown as Record<string, any>),
                    row: item,
                  })}`,
                );
              }
              continue;
            }
            items.push(parsed);
          }
        }

        if ((output1?.length ?? 0) > 0 && items.length === parsedCountBefore) {
          this.logRawBalancePage(
            `standard-balance:${exchangeCode}:unparsed-page`,
            output1,
            undefined,
            { page: depth + 1, currencyCode, parsedCountBefore, parsedCountAfter: items.length },
            true,
          );
        }

        const nextCtxAreaFk200 = ((res as any).ctx_area_fk200 || '').trim();
        const nextCtxAreaNk200 = ((res as any).ctx_area_nk200 || '').trim();

        this.logger.debug(
          `Overseas standard balance ${exchangeCode} page ${depth + 1}: received=${output1?.length ?? 0}, accumulated=${items.length}, nextFk200Length=${nextCtxAreaFk200.length}, nextNk200Length=${nextCtxAreaNk200.length}`,
        );

        if (
          this.hasRepeatedContinuationToken(
            ctxAreaFk200,
            ctxAreaNk200,
            nextCtxAreaFk200,
            nextCtxAreaNk200,
          )
        ) {
          this.logger.warn(
            `Overseas standard balance pagination stalled for ${exchangeCode} at page ${depth + 1}; stopping repeated continuation token loop`,
          );
          break;
        }

        ctxAreaFk200 = nextCtxAreaFk200;
        ctxAreaNk200 = nextCtxAreaNk200;
        hasMore = this.hasContinuationToken(ctxAreaFk200);
        depth++;
      }
    }

    return items;
  }

  private getStandardBalanceExchanges(): string[] {
    if (this.isPaper) {
      return ['NASD', 'NYSE', 'AMEX', 'SEHK', 'SHAA', 'SZAA', 'TKSE', 'HASE', 'VNSE'];
    }

    return ['NASD', 'SEHK', 'SHAA', 'SZAA', 'TKSE', 'HASE', 'VNSE'];
  }

  private toLocalCurrencyPrice(rawPrice: string, exchangeRate: number, unitAmount: number): number {
    const parsedPrice = parseFloat(rawPrice) || 0;
    if (parsedPrice <= 0 || exchangeRate <= 0) return parsedPrice;
    const currencyUnit = unitAmount > 0 ? unitAmount : 1;
    return (parsedPrice / exchangeRate) * currencyUnit;
  }

  private shouldFallbackToStandardBalance(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('INVALID_CHECK_ACNO');
  }
}
