import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisBaseService } from './kis-base.service';
import {
  OverseasCashBalance,
  OverseasForeignMarginItem,
} from './types/kis-api.types';

@Injectable()
export class KisOverseasCashBalanceService {
  private readonly logger = new Logger(KisOverseasCashBalanceService.name);
  private readonly accountNo: string;
  private readonly prodCode: string;

  constructor(
    private readonly kisBase: KisBaseService,
    configService: ConfigService,
  ) {
    this.accountNo = configService.get<string>('kis.accountNo')!;
    this.prodCode = configService.get<string>('kis.prodCode')!;
  }

  async enrich(
    baseBalances: OverseasCashBalance[],
  ): Promise<OverseasCashBalance[]> {
    try {
      return this.merge(
        baseBalances,
        await this.getForeignMarginCashBalances(),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enrich overseas cash balances with foreign margin API: ${this.errorMessage(error)}`,
      );
      throw error;
    }
  }

  private merge(
    baseBalances: OverseasCashBalance[],
    marginBalances: OverseasCashBalance[],
  ): OverseasCashBalance[] {
    const balances = new Map<string, OverseasCashBalance>();

    for (const item of baseBalances) {
      balances.set(item.currencyCode, { ...item });
    }

    for (const item of marginBalances) {
      const existing = balances.get(item.currencyCode);
      if (!existing) continue;
      balances.set(item.currencyCode, {
        ...existing,
        ...item,
        currencyName: existing.currencyName ?? item.currencyName,
        withdrawableAmount: existing.withdrawableAmount ?? item.withdrawableAmount,
      });
    }

    return Array.from(balances.values());
  }

  private async getForeignMarginCashBalances(): Promise<OverseasCashBalance[]> {
    const res = await this.kisBase.get(
      '/uapi/overseas-stock/v1/trading/foreign-margin',
      'TTTC2101R',
      {
        CANO: this.accountNo.substring(0, 8),
        ACNT_PRDT_CD: this.accountNo.substring(8, 10) || this.prodCode,
      },
    );

    const output = (res.output as OverseasForeignMarginItem[]) || [];
    const balances = new Map<string, {
      balance: OverseasCashBalance;
      priority: number;
    }>();

    for (const item of output) {
      if (!item.crcy_cd) continue;
      const row = item as unknown as Record<string, any>;
      const amount = this.readNumber(row, 'frcr_dncl_amt1') ?? 0;
      const pendingBuyAmount = this.readNumber(row, 'ustl_buy_amt');
      const pendingSellAmount = this.readNumber(row, 'ustl_sll_amt');
      const generalOrderableAmount = this.readNumber(row, 'frcr_gnrl_ord_psbl_amt');
      const directOrderableAmount = this.readNumber(row, 'frcr_ord_psbl_amt1');
      const integratedOrderableAmount = this.readNumber(row, 'itgr_ord_psbl_amt');
      const orderableAmount = directOrderableAmount && directOrderableAmount > 0
        ? directOrderableAmount
        : generalOrderableAmount ?? integratedOrderableAmount;
      const balance: OverseasCashBalance = {
        currencyCode: item.crcy_cd,
        amount,
      };
      const optionalFields: Array<[string, number | undefined]> = [
        ['pendingBuyAmount', pendingBuyAmount],
        ['pendingSellAmount', pendingSellAmount],
        ['receivableAmount', this.readNumber(row, 'frcr_rcvb_amt')],
        ['marginAmount', this.readNumber(row, 'frcr_mgn_amt')],
        ['generalOrderableAmount', generalOrderableAmount],
        ['orderableAmount', orderableAmount],
        ['integratedOrderableAmount', integratedOrderableAmount],
      ];
      for (const [key, value] of optionalFields) {
        if (value !== undefined) {
          (balance as unknown as Record<string, number>)[key] = value;
        }
      }

      const priority = this.getPriority(item, balance);
      const existing = balances.get(item.crcy_cd);
      if (!existing || priority > existing.priority) {
        balances.set(item.crcy_cd, { balance, priority });
      }
    }

    return Array.from(balances.values()).map((item) => item.balance);
  }

  private getPriority(
    item: OverseasForeignMarginItem,
    balance: OverseasCashBalance,
  ): number {
    const isPrimaryUsRow = item.natn_name?.trim() === '미국'
      && item.crcy_cd === 'USD';
    const pendingActivity = Math.abs(balance.pendingBuyAmount ?? 0)
      + Math.abs(balance.pendingSellAmount ?? 0);
    const orderableActivity = Math.abs(balance.generalOrderableAmount ?? 0);
    const cashActivity = Math.abs(balance.amount);

    return (isPrimaryUsRow ? 1_000_000_000 : 0)
      + (pendingActivity > 0 ? 10_000_000 : 0)
      + (orderableActivity > 0 ? 1_000_000 : 0)
      + cashActivity
      + pendingActivity;
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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
