import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import { KisOrderHistoryPaginationService } from './kis-order-history-pagination.service';
import {
  BrokerOrderStatus,
  UnfilledOrder,
} from './types/kis-api.types';
import { OVERSEAS_ORDER_TR_IDS } from './types/kis-config.types';
import { KisOrderHistoryMarket } from './types/kis-order-history.type';

@Injectable()
export class KisOrderHistoryService {
  private readonly logger = new Logger(KisOrderHistoryService.name);
  private readonly accountNo: string;
  private readonly prodCode: string;
  private readonly isPaper: boolean;

  constructor(
    private readonly kisBase: KisBaseService,
    configService: ConfigService,
    private readonly pagination: KisOrderHistoryPaginationService,
  ) {
    this.accountNo = configService.get<string>('kis.accountNo')!;
    this.prodCode = configService.get<string>('kis.prodCode')!;
    this.isPaper = configService.get<string>('kis.env') === 'paper';
  }

  async getUnfilledOrders(
    market: KisOrderHistoryMarket,
  ): Promise<UnfilledOrder[]> {
    return market === 'DOMESTIC'
      ? this.getDomesticUnfilledOrders()
      : this.getOverseasUnfilledOrders();
  }

  async getOrderExecutions(
    market: KisOrderHistoryMarket,
    startDate: string,
    endDate: string,
  ): Promise<BrokerOrderStatus[]> {
    return market === 'DOMESTIC'
      ? this.getDomesticOrderExecutions(startDate, endDate)
      : this.getOverseasOrderExecutions(startDate, endDate);
  }

  private accountParams(): Record<string, string> {
    return {
      CANO: this.accountNo.substring(0, 8),
      ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
    };
  }

  private paginateDomesticRows(
    path: string,
    trId: string,
    params: Record<string, string>,
    outputKey: 'output' | 'output1',
    getDedupeKey: (row: Record<string, any>) => string,
    validateRow?: (row: Record<string, any>) => void,
  ): Promise<Record<string, any>[]> {
    return this.pagination.paginate({
      label: 'Domestic order',
      fetchPage: async ({ fk, nk, additionalHeaders }) => {
        const response = await this.kisBase.getWithMetadata<any[]>(
          path,
          trId,
          { ...params, CTX_AREA_FK100: fk, CTX_AREA_NK100: nk },
          additionalHeaders,
        );
        const rows = response.data[outputKey] as Record<string, any>[] | undefined;
        if (Array.isArray(rows) && validateRow) {
          for (const row of rows) validateRow(row);
        }
        return {
          rows,
          trCont: response.trCont,
          fk: response.data.ctx_area_fk100
            ?? (response.data as any).CTX_AREA_FK100,
          nk: response.data.ctx_area_nk100
            ?? (response.data as any).CTX_AREA_NK100,
        };
      },
      getDedupeKey,
    });
  }

  private paginateOverseasRows(
    path: string,
    trId: string,
    params: Record<string, string>,
    getDedupeKey: (row: Record<string, any>) => string,
    validateRow?: (row: Record<string, any>) => void,
  ): Promise<Record<string, any>[]> {
    return this.pagination.paginate({
      label: 'Overseas order',
      fetchPage: async ({ fk, nk, additionalHeaders }) => {
        const response = await this.kisBase.getWithMetadata<any[]>(
          path,
          trId,
          { ...params, CTX_AREA_FK200: fk, CTX_AREA_NK200: nk },
          additionalHeaders,
        );
        const rows = response.data.output as Record<string, any>[] | undefined;
        if (Array.isArray(rows) && validateRow) {
          for (const row of rows) validateRow(row);
        }
        return {
          rows,
          trCont: response.trCont,
          fk: response.data.ctx_area_fk200
            ?? (response.data as any).CTX_AREA_FK200,
          nk: response.data.ctx_area_nk200
            ?? (response.data as any).CTX_AREA_NK200,
        };
      },
      getDedupeKey,
    });
  }

  private async getDomesticUnfilledOrders(): Promise<UnfilledOrder[]> {
    const rows = await this.paginateDomesticRows(
      '/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl',
      this.isPaper ? 'VTTC0084R' : 'TTTC0084R',
      { ...this.accountParams(), INQR_DVSN_1: '0', INQR_DVSN_2: '0' },
      'output',
      (row) => `KRX|${String(row.odno ?? '').trim()}`,
      (row) => this.assertValidDomesticUnfilledRow(row),
    );

    return rows
      .filter((row) => (this.parseInteger(row.psbl_qty) ?? 0) > 0)
      .map((row) => ({
        orderNo: String(row.odno).trim(),
        stockCode: String(row.pdno).trim(),
        side: String(row.sll_buy_dvsn_cd).trim() === '01' ? 'SELL' : 'BUY',
        quantity: this.parseInteger(row.psbl_qty) as number,
        price: parseFloat(row.ord_unpr) || 0,
      }));
  }

  private async getOverseasUnfilledOrders(): Promise<UnfilledOrder[]> {
    const rows: Record<string, any>[] = [];
    for (const exchangeCode of Object.keys(OVERSEAS_ORDER_TR_IDS)) {
      const exchangeRows = await this.paginateOverseasRows(
        '/uapi/overseas-stock/v1/trading/inquire-nccs',
        this.isPaper ? 'VTTS3018R' : 'TTTS3018R',
        { ...this.accountParams(), OVRS_EXCG_CD: exchangeCode, SORT_SQN: 'DS' },
        (row) => {
          const rowExchangeCode = String(row.ovrs_excg_cd ?? '')
            .trim()
            .toUpperCase() || exchangeCode;
          return `${rowExchangeCode}|${String(row.odno ?? '').trim()}`;
        },
        (row) => this.assertValidOverseasUnfilledRow(row, exchangeCode),
      );
      rows.push(...exchangeRows.map((row) => ({
        ...row,
        ovrs_excg_cd: String(row.ovrs_excg_cd ?? '').trim().toUpperCase()
          || exchangeCode,
      })));
    }

    const ordersByIdentity = new Map<string, UnfilledOrder>();
    for (const row of rows) {
      const quantity = this.parseInteger(row.nccs_qty);
      if (quantity === undefined || quantity <= 0) continue;

      const exchangeCode = String(row.ovrs_excg_cd ?? '').trim().toUpperCase();
      const orderNo = String(row.odno ?? '').trim();
      const identity = `${exchangeCode}|${orderNo}`;
      if (ordersByIdentity.has(identity)) continue;

      ordersByIdentity.set(identity, {
        orderNo,
        stockCode: String(row.pdno).trim(),
        side: String(row.sll_buy_dvsn_cd).trim() === '01' ? 'SELL' : 'BUY',
        quantity,
        price: parseFloat(row.ft_ord_unpr3) || 0,
        exchangeCode,
      });
    }
    return Array.from(ordersByIdentity.values());
  }

  private async getDomesticOrderExecutions(
    startDate: string,
    endDate: string,
  ): Promise<BrokerOrderStatus[]> {
    const rows = await this.paginateDomesticRows(
      '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
      this.isPaper ? 'VTTC0081R' : 'TTTC0081R',
      {
        ...this.accountParams(),
        INQR_STRT_DT: startDate,
        INQR_END_DT: endDate,
        SLL_BUY_DVSN_CD: '00',
        INQR_DVSN: '00',
        PDNO: '',
        CCLD_DVSN: '00',
        ORD_GNO_BRNO: '',
        ODNO: '',
        INQR_DVSN_3: '00',
        INQR_DVSN_1: '',
      },
      'output1',
      (row) => [row.ord_dt, 'KRX', row.odno]
        .map((value) => String(value ?? '').trim())
        .join('|'),
      (row) => this.assertValidDomesticExecutionRow(row),
    );

    return rows.filter((row) => this.isNonemptyRow(row)).map((row) => {
      const orderQuantity = this.parseInteger(row.ord_qty) as number;
      const filledQuantity = this.parseInteger(row.tot_ccld_qty) as number;
      return {
        orderNo: String(row.odno).trim(),
        stockCode: String(row.pdno).trim(),
        side: String(row.sll_buy_dvsn_cd).trim() === '01' ? 'SELL' : 'BUY',
        orderQuantity,
        filledQuantity,
        remainingQuantity: Math.max(0, orderQuantity - filledQuantity),
        orderPrice: row.ord_unpr ? parseFloat(row.ord_unpr) || 0 : undefined,
        filledPrice: row.avg_prvs ? parseFloat(row.avg_prvs) || 0 : undefined,
        exchangeCode: 'KRX',
        orderDate: row.ord_dt,
        orderTime: row.ord_tmd,
        ...this.normalizeDomesticRejection(row),
      };
    });
  }

  private async getOverseasOrderExecutions(
    startDate: string,
    endDate: string,
  ): Promise<BrokerOrderStatus[]> {
    const apiStartDate = this.shiftKisCalendarDate(startDate, -1);
    this.assertValidKisCalendarDate(endDate);

    const rows = await this.paginateOverseasRows(
      '/uapi/overseas-stock/v1/trading/inquire-ccnl',
      this.isPaper ? 'VTTS3035R' : 'TTTS3035R',
      {
        ...this.accountParams(),
        PDNO: this.isPaper ? '' : '%',
        ORD_STRT_DT: apiStartDate,
        ORD_END_DT: endDate,
        SLL_BUY_DVSN: '00',
        CCLD_NCCS_DVSN: '00',
        OVRS_EXCG_CD: this.isPaper ? '' : '%',
        SORT_SQN: 'DS',
        ORD_DT: '',
        ORD_GNO_BRNO: '',
        ODNO: '',
      },
      (row) => [row.dmst_ord_dt, row.ovrs_excg_cd, row.odno]
        .map((value) => String(value ?? '').trim())
        .join('|'),
      (row) => this.assertValidOverseasExecutionRow(row),
    );

    const orderRows = rows.filter((row) => this.isNonemptyRow(row));
    return orderRows.map((row) => {
      const orderQuantity = this.parseInteger(row.ft_ord_qty) as number;
      const filledQuantity = this.parseInteger(row.ft_ccld_qty) as number;
      const remainingQuantity = this.parseOptionalInteger(row.nccs_qty);
      return {
        orderNo: String(row.odno).trim(),
        stockCode: String(row.pdno).trim(),
        side: String(row.sll_buy_dvsn_cd).trim() === '01' ? 'SELL' : 'BUY',
        orderQuantity,
        filledQuantity,
        remainingQuantity: remainingQuantity
          ?? Math.max(0, orderQuantity - filledQuantity),
        orderPrice: row.ft_ord_unpr3
          ? parseFloat(row.ft_ord_unpr3) || 0
          : undefined,
        filledPrice: row.ft_ccld_unpr3
          ? parseFloat(row.ft_ccld_unpr3) || 0
          : undefined,
        exchangeCode: row.ovrs_excg_cd,
        orderDate: row.dmst_ord_dt,
        orderTime: row.thco_ord_tmd,
        ...this.normalizeOverseasRejection(row),
      };
    });
  }

  private normalizeDomesticRejection(
    row: Record<string, any>,
  ): Pick<BrokerOrderStatus, 'rejectionState' | 'rejected' | 'rejectedReason'> {
    const rejectedReason = this.rejectedReason(row);
    if (rejectedReason) {
      return { rejectionState: 'REJECTED', rejected: true, rejectedReason };
    }

    const rawQuantity = row.rjct_qty;
    const normalizedQuantity = typeof rawQuantity === 'string'
      ? rawQuantity.trim()
      : typeof rawQuantity === 'number' ? String(rawQuantity) : '';
    const rejectedQuantity = Number(normalizedQuantity);
    if (normalizedQuantity && Number.isFinite(rejectedQuantity) && rejectedQuantity >= 0) {
      return rejectedQuantity > 0
        ? { rejectionState: 'REJECTED', rejected: true }
        : { rejectionState: 'NOT_REJECTED', rejected: false };
    }
    return { rejectionState: 'UNKNOWN' };
  }

  private normalizeOverseasRejection(
    row: Record<string, any>,
  ): Pick<BrokerOrderStatus, 'rejectionState' | 'rejected' | 'rejectedReason'> {
    const rejectedReason = this.rejectedReason(row);
    if (rejectedReason) {
      return { rejectionState: 'REJECTED', rejected: true, rejectedReason };
    }
    if ([row.rjct_rson_name, row.rjct_rson]
      .some((value) => typeof value === 'string')) {
      return { rejectionState: 'NOT_REJECTED', rejected: false };
    }
    return { rejectionState: 'UNKNOWN' };
  }

  private rejectedReason(row: Record<string, any>): string | undefined {
    const name = typeof row.rjct_rson_name === 'string' ? row.rjct_rson_name.trim() : '';
    const code = typeof row.rjct_rson === 'string' ? row.rjct_rson.trim() : '';
    if (name && code) return `${name} (rjct_rson=${code})`;
    return name || code || undefined;
  }

  private assertValidKisCalendarDate(value: string): void {
    if (!this.isValidKisCalendarDate(value)) {
      throw new Error(`Invalid KIS calendar date: ${value}`);
    }
  }

  private isValidKisCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{8}$/.test(value)) {
      return false;
    }

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }

  private isValidKisTime(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{6}$/.test(value)) {
      return false;
    }
    const hour = Number(value.slice(0, 2));
    const minute = Number(value.slice(2, 4));
    const second = Number(value.slice(4, 6));
    return hour <= 23 && minute <= 59 && second <= 59;
  }

  private assertValidDomesticExecutionRow(row: Record<string, any>): void {
    if (!this.isNonemptyRow(row)) return;

    const orderNo = this.nonemptyString(row.odno);
    const stockCode = this.nonemptyString(row.pdno);
    const sideCode = this.nonemptyString(row.sll_buy_dvsn_cd);
    const orderQuantity = this.parseInteger(row.ord_qty);
    const filledQuantity = this.parseInteger(row.tot_ccld_qty);
    if (
      !orderNo
      || !stockCode
      || (sideCode !== '01' && sideCode !== '02')
      || orderQuantity === undefined
      || orderQuantity <= 0
      || filledQuantity === undefined
      || filledQuantity < 0
      || filledQuantity > orderQuantity
      || !this.isValidKisCalendarDate(row.ord_dt)
      || !this.isValidKisTime(row.ord_tmd)
    ) {
      throw new Error(`Invalid domestic execution order row: ${orderNo || 'unknown'}`);
    }
  }

  private assertValidOverseasExecutionRow(
    row: Record<string, any>,
  ): void {
    if (!this.isNonemptyRow(row)) return;

    const orderNo = this.nonemptyString(row.odno);
    const stockCode = this.nonemptyString(row.pdno);
    const sideCode = this.nonemptyString(row.sll_buy_dvsn_cd);
    const exchangeCode = this.nonemptyString(row.ovrs_excg_cd)?.toUpperCase();
    const orderQuantity = this.parseInteger(row.ft_ord_qty);
    const filledQuantity = this.parseInteger(row.ft_ccld_qty);
    const remainingQuantity = this.parseOptionalInteger(row.nccs_qty);
    if (
      !orderNo
      || !stockCode
      || (sideCode !== '01' && sideCode !== '02')
      || !exchangeCode
      || !Object.prototype.hasOwnProperty.call(OVERSEAS_ORDER_TR_IDS, exchangeCode)
      || orderQuantity === undefined
      || orderQuantity <= 0
      || filledQuantity === undefined
      || filledQuantity < 0
      || filledQuantity > orderQuantity
      || remainingQuantity === null
      || (remainingQuantity !== undefined && remainingQuantity > orderQuantity)
      || (
        remainingQuantity !== undefined
        && filledQuantity !== undefined
        && orderQuantity !== undefined
        && filledQuantity + remainingQuantity > orderQuantity
      )
    ) {
      throw new Error(`Invalid overseas execution order row: ${orderNo || 'unknown'}`);
    }
    if (
      !this.isValidKisCalendarDate(row.dmst_ord_dt)
      || !this.isValidKisTime(row.thco_ord_tmd)
    ) {
      throw new Error(
        `Invalid overseas order KST broker timestamp: ${orderNo}`,
      );
    }
  }

  private assertValidDomesticUnfilledRow(row: Record<string, any>): void {
    if (!this.isNonemptyRow(row)) return;

    const quantity = this.parseInteger(row.psbl_qty);
    if (quantity === 0) return;
    const orderNo = this.nonemptyString(row.odno);
    const stockCode = this.nonemptyString(row.pdno);
    const sideCode = this.nonemptyString(row.sll_buy_dvsn_cd);
    if (
      quantity === undefined
      || quantity < 0
      || !orderNo
      || !stockCode
      || (sideCode !== '01' && sideCode !== '02')
    ) {
      throw new Error(`Invalid domestic unfilled order row: ${orderNo || 'unknown'}`);
    }
  }

  private assertValidOverseasUnfilledRow(
    row: Record<string, any>,
    queryExchangeCode: string,
  ): void {
    if (!this.isNonemptyRow(row)) return;

    const quantity = this.parseInteger(row.nccs_qty);
    if (quantity === 0) return;

    const orderNo = this.nonemptyString(row.odno);
    const stockCode = this.nonemptyString(row.pdno);
    const sideCode = this.nonemptyString(row.sll_buy_dvsn_cd);
    const exchangeCode = this.nonemptyString(row.ovrs_excg_cd)?.toUpperCase()
      || queryExchangeCode;
    if (
      quantity === undefined
      || quantity < 0
      || !orderNo
      || !stockCode
      || (sideCode !== '01' && sideCode !== '02')
      || !Object.prototype.hasOwnProperty.call(
        OVERSEAS_ORDER_TR_IDS,
        exchangeCode,
      )
    ) {
      throw new Error(
        `Invalid overseas unfilled order row for ${queryExchangeCode}`,
      );
    }
  }

  private parseInteger(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) ? value : undefined;
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return undefined;

    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  private parseOptionalInteger(value: unknown): number | undefined | null {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && !value.trim()) return undefined;
    return this.parseInteger(value) ?? null;
  }

  private nonemptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
  }

  private isNonemptyRow(row: Record<string, any>): boolean {
    return Object.values(row).some((value) => (
      typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
    ));
  }

  private shiftKisCalendarDate(value: string, days: number): string {
    this.assertValidKisCalendarDate(value);
    const shifted = new Date(Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
    ));
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return [
      shifted.getUTCFullYear().toString().padStart(4, '0'),
      (shifted.getUTCMonth() + 1).toString().padStart(2, '0'),
      shifted.getUTCDate().toString().padStart(2, '0'),
    ].join('');
  }
}
