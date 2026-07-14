import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import { KisOverseasCashBalanceService } from './kis-overseas-cash-balance.service';
import {
  BalanceItem,
  OverseasBalanceItem,
  OverseasCashBalance,
  OverseasPresentBalanceCurrencyItem,
  OverseasStandardBalanceItem,
} from './types/kis-api.types';
import { EXCHANGE_CURRENCY } from './types/kis-config.types';
import { OverseasAccountSnapshot } from './types/overseas-account-snapshot.type';

@Injectable()
export class KisOverseasBalanceService {
  private readonly logger = new Logger(KisOverseasBalanceService.name);
  private readonly accountNo: string;
  private readonly prodCode: string;
  private readonly isPaper: boolean;
  private readonly debugRawBalance: boolean;
  private useStandardBalanceOnly = false;

  constructor(
    private readonly kisBase: KisBaseService,
    configService: ConfigService,
    private readonly cashBalance: KisOverseasCashBalanceService,
  ) {
    this.accountNo = configService.get<string>('kis.accountNo')!;
    this.prodCode = configService.get<string>('kis.prodCode')!;
    this.isPaper = configService.get<string>('kis.env') === 'paper';
    this.debugRawBalance = configService.get<boolean>('kis.debugRawBalance') ?? false;
  }

  async getCashBalances(): Promise<OverseasCashBalance[]> {
    const snapshot = await this.getAccountSnapshot();
    return snapshot.cashBalances;
  }

  async getAccountSnapshot(nationCode = '000'): Promise<OverseasAccountSnapshot> {
    if (this.isPaper || this.useStandardBalanceOnly) {
      return {
        balance: await this.getStandardBalance(),
        cashBalances: [],
      };
    }

    try {
      const snapshot = await this.getPresentBalanceSnapshot(nationCode);
      try {
        return {
          balance: snapshot.balance,
          cashBalances: await this.cashBalance.enrich(snapshot.cashBalances),
        };
      } catch {
        return snapshot;
      }
    } catch (error) {
      if (!this.shouldFallbackToStandardBalance(error)) throw error;

      this.useStandardBalanceOnly = true;
      this.logger.warn(
        `Falling back to overseas standard balance API after present balance failure: ${this.errorMessage(error)}`,
      );
      return {
        balance: await this.getStandardBalance(),
        cashBalances: [],
      };
    }
  }

  async getBalance(nationCode = '000'): Promise<BalanceItem[]> {
    if (this.isPaper || this.useStandardBalanceOnly) {
      return this.getStandardBalance();
    }

    try {
      return (await this.getPresentBalanceSnapshot(nationCode)).balance;
    } catch (error) {
      if (!this.shouldFallbackToStandardBalance(error)) throw error;

      this.useStandardBalanceOnly = true;
      this.logger.warn(
        `Falling back to overseas standard balance API after present balance failure: ${this.errorMessage(error)}`,
      );
      return this.getStandardBalance();
    }
  }

  private async getPresentBalanceSnapshot(
    nationCode = '000',
  ): Promise<OverseasAccountSnapshot> {
    const trId = this.isPaper ? 'VTRP6504R' : 'CTRP6504R';
    const items: BalanceItem[] = [];
    let rawItemCount = 0;
    const cashBalances = new Map<string, OverseasCashBalance>();
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
          const row = item as unknown as Record<string, any>;
          const parsed = this.parsePresentBalanceRow(row);
          if (!parsed) {
            if (this.debugRawBalance) {
              this.logger.warn(
                `[KIS DEBUG] present-balance skipped row due to qty<=0 ${JSON.stringify({
                  stockCode: this.readString(row, 'ovrs_pdno', 'pdno'),
                  exchangeCode: this.readString(row, 'ovrs_excg_cd'),
                  parsedQty: this.readNumber(
                    row,
                    'ovrs_cblc_qty',
                    'ccld_qty_smtl1',
                    'ord_psbl_qty1',
                    'cblc_qty13',
                  ) || 0,
                  quantityFields: this.pickQuantityFields(row),
                  row,
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
        const row = item as unknown as Record<string, any>;
        const balance: OverseasCashBalance = {
          currencyCode: item.crcy_cd,
          currencyName: item.crcy_cd_name || undefined,
          amount: this.readNumber(row, 'frcr_dncl_amt_2', 'frcr_dncl_amt1') ?? 0,
        };
        const optionalFields: Array<[string, number | undefined]> = [
          ['withdrawableAmount', this.readNumber(row, 'frcr_drwg_psbl_amt_1')],
          ['orderableAmount', this.readNumber(row, 'frcr_use_psbl_amt', 'frcr_ord_psbl_amt1')],
          ['pendingSellAmount', this.readNumber(row, 'ustl_sll_amt_smtl', 'ustl_sll_amt')],
          ['pendingBuyAmount', this.readNumber(row, 'ustl_buy_amt_smtl', 'ustl_buy_amt')],
        ];
        for (const [key, value] of optionalFields) {
          if (value !== undefined) {
            (balance as unknown as Record<string, number>)[key] = value;
          }
        }
        cashBalances.set(item.crcy_cd, balance);
      }

      const nextFk = ((res as any).ctx_area_fk200 || '').trim();
      const nextNk = ((res as any).ctx_area_nk200 || '').trim();
      this.logger.debug(
        `Overseas present balance page ${depth + 1}: received=${output1?.length ?? 0}, accumulated=${items.length}, currencies=${cashBalances.size}, nextFk200Length=${nextFk.length}, nextNk200Length=${nextNk.length}`,
      );

      if (this.hasRepeatedContinuationToken(
        ctxAreaFk200,
        ctxAreaNk200,
        nextFk,
        nextNk,
      )) {
        this.logger.warn(
          `Overseas present balance pagination stalled at page ${depth + 1}; stopping repeated continuation token loop`,
        );
        break;
      }

      ctxAreaFk200 = nextFk;
      ctxAreaNk200 = nextNk;
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

    for (const exchangeCode of this.getStandardBalanceExchanges()) {
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
            const row = item as unknown as Record<string, any>;
            const parsed = this.parseStandardBalanceRow(row, exchangeCode);
            if (!parsed) {
              if (this.debugRawBalance) {
                this.logger.warn(
                  `[KIS DEBUG] standard-balance skipped row due to qty<=0 ${JSON.stringify({
                    stockCode: this.readString(row, 'pdno', 'ovrs_pdno'),
                    exchangeCode: this.readString(row, 'ovrs_excg_cd') || exchangeCode,
                    parsedQty: this.readNumber(
                      row,
                      'ccld_qty_smtl1',
                      'ovrs_cblc_qty',
                      'ord_psbl_qty',
                    ) || 0,
                    quantityFields: this.pickQuantityFields(row),
                    row,
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

        const nextFk = ((res as any).ctx_area_fk200 || '').trim();
        const nextNk = ((res as any).ctx_area_nk200 || '').trim();
        this.logger.debug(
          `Overseas standard balance ${exchangeCode} page ${depth + 1}: received=${output1?.length ?? 0}, accumulated=${items.length}, nextFk200Length=${nextFk.length}, nextNk200Length=${nextNk.length}`,
        );

        if (this.hasRepeatedContinuationToken(
          ctxAreaFk200,
          ctxAreaNk200,
          nextFk,
          nextNk,
        )) {
          this.logger.warn(
            `Overseas standard balance pagination stalled for ${exchangeCode} at page ${depth + 1}; stopping repeated continuation token loop`,
          );
          break;
        }

        ctxAreaFk200 = nextFk;
        ctxAreaNk200 = nextNk;
        hasMore = this.hasContinuationToken(ctxAreaFk200);
        depth++;
      }
    }

    return items;
  }

  private parsePresentBalanceRow(
    row: Record<string, any>,
  ): BalanceItem | undefined {
    const quantity = Math.trunc(this.readNumber(
      row,
      'ovrs_cblc_qty',
      'ccld_qty_smtl1',
      'ord_psbl_qty1',
      'cblc_qty13',
    ) || 0);
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
      ? this.toLocalCurrencyPrice(
          String(this.readNumber(row, 'ovrs_now_pric1') || 0),
          exchangeRate,
          unitAmount,
        )
      : (this.readNumber(row, 'now_pric2') || 0);
    const profitLoss = row.frcr_evlu_pfls_amt !== undefined
      ? (this.readNumber(row, 'frcr_evlu_pfls_amt') || 0)
      : useConvertedPricing
        ? this.toLocalCurrencyPrice(
            String(this.readNumber(row, 'evlu_pfls_amt2') || 0),
            exchangeRate,
            unitAmount,
          )
        : (this.readNumber(
            row,
            'ovrs_stck_evlu_pfls_amt',
            'evlu_pfls_amt2',
          ) || 0);

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

  private parseStandardBalanceRow(
    row: Record<string, any>,
    fallbackExchangeCode: string,
  ): BalanceItem | undefined {
    const quantity = Math.trunc(this.readNumber(
      row,
      'ccld_qty_smtl1',
      'ovrs_cblc_qty',
      'ord_psbl_qty',
    ) || 0);
    if (quantity <= 0) return undefined;

    const exchangeRate = this.readNumber(row, 'bass_exrt') || 0;
    const unitAmount = this.readNumber(row, 'unit_amt') || 1;
    const hasDirectPricing = row.now_pric2 !== undefined
      || row.pchs_avg_pric !== undefined;
    const avgPrice = hasDirectPricing
      ? (this.readNumber(row, 'pchs_avg_pric') || 0)
      : this.toLocalCurrencyPrice(
          String(this.readNumber(row, 'avg_unpr3') || 0),
          exchangeRate,
          unitAmount,
        );
    const currentPrice = hasDirectPricing
      ? (this.readNumber(row, 'now_pric2') || 0)
      : this.toLocalCurrencyPrice(
          String(this.readNumber(row, 'ovrs_now_pric1') || 0),
          exchangeRate,
          unitAmount,
        );
    const profitLoss = row.frcr_evlu_pfls_amt !== undefined
      ? (this.readNumber(row, 'frcr_evlu_pfls_amt') || 0)
      : this.toLocalCurrencyPrice(
          String(this.readNumber(row, 'evlu_pfls_amt2') || 0),
          exchangeRate,
          unitAmount,
        );

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

  private hasContinuationToken(token?: string): boolean {
    return (token?.trim().length ?? 0) > 0;
  }

  private hasRepeatedContinuationToken(
    previousFk: string,
    previousNk: string,
    nextFk: string,
    nextNk: string,
  ): boolean {
    return this.hasContinuationToken(nextFk)
      && previousFk === nextFk
      && previousNk === nextNk;
  }

  private getStandardBalanceExchanges(): string[] {
    if (this.isPaper) {
      return [
        'NASD',
        'NYSE',
        'AMEX',
        'SEHK',
        'SHAA',
        'SZAA',
        'TKSE',
        'HASE',
        'VNSE',
      ];
    }
    return ['NASD', 'SEHK', 'SHAA', 'SZAA', 'TKSE', 'HASE', 'VNSE'];
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
      this.logger.warn(
        `[KIS DEBUG] ${label} output1[0] ${JSON.stringify(first1)}`,
      );
    }
    if (first2) {
      this.logger.warn(
        `[KIS DEBUG] ${label} output2[0] ${JSON.stringify(first2)}`,
      );
    }
  }

  private pickQuantityFields(
    row: Record<string, any> | undefined,
  ): Record<string, any> {
    if (!row) return {};
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => /qty|qnt|cblc|hldg|ccld/i.test(key)),
    );
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

  private toLocalCurrencyPrice(
    rawPrice: string,
    exchangeRate: number,
    unitAmount: number,
  ): number {
    const parsedPrice = parseFloat(rawPrice) || 0;
    // 음수 평가손익도 환율 변환해야 단위가 KRW로 새지 않는다.
    if (parsedPrice === 0 || exchangeRate <= 0) return parsedPrice;
    return (parsedPrice / exchangeRate) * (unitAmount > 0 ? unitAmount : 1);
  }

  private shouldFallbackToStandardBalance(error: unknown): boolean {
    return this.errorMessage(error).includes('INVALID_CHECK_ACNO');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
