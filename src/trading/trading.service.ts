import { Injectable, Logger, Optional } from '@nestjs/common';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import {
  TradingSignal,
  PerStockTradingStrategy,
  StockStrategyContext,
} from './types';
import { BalanceItem } from '../kis/types/kis-api.types';
import { Market, Side, OrderType, OrderStatus, ApprovalStatus, Prisma } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { TradeAlertContext, FilterLogContext } from '../notification/types/notification.types';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    @Optional() private slackService?: SlackService,
  ) {}

  /** 종목별 전략 실행 */
  async executePerStockStrategy(
    strategy: PerStockTradingStrategy,
    contexts: StockStrategyContext[],
  ): Promise<void> {
    for (const ctx of contexts) {
      try {
        const signals = await strategy.evaluateStock(ctx);

        if (signals.length === 0) {
          let reason = '시그널 없음';
          if (!ctx.marketCondition.referenceIndexAboveMA200 && !ctx.position) {
            reason = `${ctx.marketCondition.referenceIndexName} 200일선 아래 — 신규 매수 중단`;
          } else if (!ctx.stockIndicators.currentAboveMA200 && !ctx.position) {
            reason = '종목 현재가 MA200 아래 — 신규 진입 차단';
          } else if (ctx.alreadyExecutedToday) {
            reason = '오늘 이미 실행됨';
          }

          // Send filter skip log to Slack
          if (this.slackService?.isEnabled()) {
            this.slackService.sendFilterLog({
              stockCode: ctx.watchStock.stockCode,
              exchangeCode: ctx.watchStock.exchangeCode,
              reason,
              details: {
                marketCondition: `${ctx.marketCondition.referenceIndexName} MA200 ${ctx.marketCondition.referenceIndexAboveMA200 ? '위' : '아래'}`,
                rsi: ctx.stockIndicators.rsi14?.toFixed(1) ?? 'N/A',
                ma200: ctx.stockIndicators.ma200?.toFixed(2) ?? 'N/A',
                position: ctx.position ? `${ctx.position.quantity}주` : '없음',
              },
            });
          }
          continue;
        }

        this.logger.log(
          `Strategy "${strategy.name}" generated ${signals.length} signal(s) for ${ctx.watchStock.stockCode}`,
        );

        for (const signal of signals) {
          await this.executeSignal(signal, strategy.name, ctx);
        }

        // 분할매수 전략: 매수 시그널 성공 시 누적 quota 리셋
        if (['infinite-buy', 'daily-dca'].includes(strategy.name)) {
          const hasBuySignal = signals.some((s) => s.side === 'BUY');
          if (hasBuySignal) {
            await this.resetAccumulatedQuota(ctx.watchStock.id);
          }
        }
      } catch (e) {
        this.logger.error(
          `Error executing strategy for ${ctx.watchStock.stockCode}: ${e.message}`,
        );
      }
    }

    // 분할매수 전략: 매수 시그널 없었던 종목에 대해 quota 누적
    if (['infinite-buy', 'daily-dca'].includes(strategy.name)) {
      await this.accumulateUnusedQuotas(strategy.name, contexts);
    }
  }

  /** 손절 시그널 여부 판별 */
  private isStopLossSignal(signal: TradingSignal): boolean {
    return signal.side === 'SELL' && (signal.reason?.toLowerCase().includes('stop loss') ?? false);
  }

  /** 승인된 손절 주문 실행 (SlackCommandsService에서 호출) */
  async executeApprovedStopLoss(approvalId: string): Promise<void> {
    const approval = await this.prisma.stopLossApproval.findUnique({
      where: { id: approvalId },
      include: { tradeRecord: true },
    });

    if (!approval || approval.status !== ApprovalStatus.APPROVED) {
      this.logger.warn(`Stop-loss approval ${approvalId} not found or not approved`);
      return;
    }

    const record = approval.tradeRecord;
    const signal = approval.signal as any as TradingSignal;

    try {
      let result;
      if (signal.market === 'DOMESTIC') {
        result = await this.kisDomestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision);
      } else {
        result = await this.kisOverseas.orderSell(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision);
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: result.success ? OrderStatus.FILLED : OrderStatus.FAILED,
          orderNo: result.orderNo,
          reason: result.message,
        },
      });

      if (result.success) {
        this.logger.log(`Stop-loss executed (approved): SELL ${signal.stockCode} x ${signal.quantity}`);
        if (this.slackService?.isEnabled()) {
          const position = await this.prisma.position.findFirst({ where: { stockCode: signal.stockCode } });
          this.slackService.sendTradeAlert({
            signal,
            result,
            position: position ? {
              stockCode: position.stockCode, stockName: position.stockName,
              exchangeCode: position.exchangeCode || undefined, market: position.market,
              quantity: position.quantity, avgPrice: Number(position.avgPrice),
              currentPrice: Number(position.currentPrice), profitLoss: Number(position.profitLoss),
              profitRate: Number(position.profitRate), totalInvested: Number(position.totalInvested),
            } : undefined,
          });
        }
      } else {
        this.logger.error(`Stop-loss order failed: ${result.message}`);
      }
    } catch (e) {
      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: { status: OrderStatus.FAILED, reason: e.message },
      });
      this.logger.error(`Stop-loss execution exception: ${e.message}`);
    }
  }

  /** 주문 실행 */
  private async executeSignal(signal: TradingSignal, strategyName?: string, ctx?: StockStrategyContext): Promise<void> {
    // OrderType 결정
    let orderType: OrderType;
    if (signal.orderDivision === '34') {
      orderType = OrderType.LOC;
    } else if (signal.price) {
      orderType = OrderType.LIMIT;
    } else {
      orderType = OrderType.MARKET;
    }

    // 손절 시그널 → 승인 요청 플로우
    if (this.isStopLossSignal(signal) && this.slackService?.isEnabled()) {
      const record = await this.prisma.tradeRecord.create({
        data: {
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: signal.stockCode,
          side: signal.side as Side,
          orderType,
          quantity: signal.quantity,
          price: new Prisma.Decimal(signal.price || 0),
          status: OrderStatus.AWAITING_APPROVAL,
          strategyName: strategyName || 'unknown',
          reason: signal.reason,
        },
      });

      const avgPrice = ctx?.position?.avgPrice || Number(signal.price);
      const currentPrice = ctx?.price?.currentPrice || Number(signal.price);
      const lossRate = avgPrice > 0 ? (avgPrice - currentPrice) / avgPrice : 0;

      const approval = await this.prisma.stopLossApproval.create({
        data: {
          tradeRecordId: record.id,
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: ctx?.watchStock?.stockName || signal.stockCode,
          strategyName: strategyName,
          signal: signal as any,
          currentPrice: new Prisma.Decimal(currentPrice),
          avgPrice: new Prisma.Decimal(avgPrice),
          quantity: signal.quantity,
          lossRate: new Prisma.Decimal(lossRate),
          timeoutMinutes: 10,
        },
      });

      const msgResult = await this.slackService.sendStopLossApproval({
        approvalId: approval.id,
        tradeRecordId: record.id,
        stockCode: signal.stockCode,
        stockName: ctx?.watchStock?.stockName || signal.stockCode,
        exchangeCode: signal.exchangeCode,
        market: signal.market,
        strategyName,
        quantity: signal.quantity,
        currentPrice,
        avgPrice,
        lossRate,
        timeoutMinutes: 10,
      });

      if (msgResult) {
        await this.prisma.stopLossApproval.update({
          where: { id: approval.id },
          data: { slackMessageTs: msgResult.ts, slackChannel: msgResult.channel },
        });
      }

      this.logger.log(`Stop-loss approval requested for ${signal.stockCode} (${approval.id})`);

      // 타임아웃 스케줄: 5분 후 미응답이면 자동 스킵
      setTimeout(async () => {
        try {
          const current = await this.prisma.stopLossApproval.findUnique({ where: { id: approval.id } });
          if (current && current.status === ApprovalStatus.PENDING) {
            await this.prisma.stopLossApproval.update({
              where: { id: approval.id },
              data: { status: ApprovalStatus.EXPIRED, respondedAt: new Date() },
            });
            await this.prisma.tradeRecord.update({
              where: { id: record.id },
              data: { status: OrderStatus.CANCELLED, reason: 'Stop-loss approval timed out (auto-skipped)' },
            });

            if (current.slackMessageTs && current.slackChannel) {
              await this.slackService!.updateStopLossApprovalMessage(
                current.slackChannel, current.slackMessageTs, signal.stockCode, 'EXPIRED',
              );
            }

            this.logger.log(`Stop-loss approval expired for ${signal.stockCode} (${approval.id})`);
          }
        } catch (e) {
          this.logger.error(`Stop-loss timeout handler error: ${e.message}`);
        }
      }, 10 * 60 * 1000);

      return; // 즉시 실행하지 않음
    }

    const record = await this.prisma.tradeRecord.create({
      data: {
        market: signal.market as Market,
        exchangeCode: signal.exchangeCode,
        stockCode: signal.stockCode,
        stockName: signal.stockCode,
        side: signal.side as Side,
        orderType,
        quantity: signal.quantity,
        price: new Prisma.Decimal(signal.price || 0),
        status: OrderStatus.PENDING,
        strategyName: strategyName || 'unknown',
        reason: signal.reason,
      },
    });

    try {
      let result;
      if (signal.market === 'DOMESTIC') {
        result =
          signal.side === 'BUY'
            ? await this.kisDomestic.orderBuy(signal.stockCode, signal.quantity, signal.price, signal.orderDivision)
            : await this.kisDomestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision);
      } else {
        result =
          signal.side === 'BUY'
            ? await this.kisOverseas.orderBuy(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision)
            : await this.kisOverseas.orderSell(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision);
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: result.success ? OrderStatus.FILLED : OrderStatus.FAILED,
          orderNo: result.orderNo,
          reason: result.message,
        },
      });

      if (result.success) {
        this.logger.log(`Order executed: ${signal.side} ${signal.stockCode} x ${signal.quantity}`);

        // Send Slack trade alert
        if (this.slackService?.isEnabled()) {
          const position = await this.prisma.position.findFirst({
            where: { stockCode: signal.stockCode },
          });

          const alertCtx: TradeAlertContext = {
            signal,
            result,
            position: position
              ? {
                  stockCode: position.stockCode,
                  stockName: position.stockName,
                  exchangeCode: position.exchangeCode || undefined,
                  market: position.market,
                  quantity: position.quantity,
                  avgPrice: Number(position.avgPrice),
                  currentPrice: Number(position.currentPrice),
                  profitLoss: Number(position.profitLoss),
                  profitRate: Number(position.profitRate),
                  totalInvested: Number(position.totalInvested),
                }
              : undefined,
          };

          if (ctx) {
            const T = ctx.position?.totalInvested
              ? ctx.position.totalInvested / (ctx.watchStock.quota || 1)
              : 0;
            const baseRate = (10 - T / 2 + 100) / 100;
            alertCtx.strategyDetails = {
              tValue: T,
              maxCycles: ctx.watchStock.maxCycles,
              pivotPrice: baseRate * (ctx.position?.avgPrice || signal.price || 0),
              rsi: ctx.stockIndicators?.rsi14,
              ma200: ctx.stockIndicators?.ma200,
              originalQuota: ctx.watchStock.quota,
            };
          }

          this.slackService.sendTradeAlert(alertCtx);
        }
      } else {
        this.logger.error(`Order failed: ${result.message}`);
      }
    } catch (e) {
      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: { status: OrderStatus.FAILED, reason: e.message },
      });
      this.logger.error(`Order exception: ${e.message}`);
    }
  }

  /** 포지션 동기화 (DB) */
  async syncPositions(market: 'DOMESTIC' | 'OVERSEAS', items: BalanceItem[]): Promise<void> {
    for (const item of items) {
      // totalInvested = quantity × avgPrice
      const totalInvested = item.quantity * item.avgPrice;

      await this.prisma.position.upsert({
        where: {
          market_stockCode: {
            market: market as Market,
            stockCode: item.stockCode,
          },
        },
        create: {
          market: market as Market,
          exchangeCode: item.exchangeCode,
          stockCode: item.stockCode,
          stockName: item.stockName,
          quantity: item.quantity,
          avgPrice: new Prisma.Decimal(item.avgPrice),
          currentPrice: new Prisma.Decimal(item.currentPrice),
          profitLoss: new Prisma.Decimal(item.profitLoss),
          profitRate: new Prisma.Decimal(item.profitRate),
          totalInvested: new Prisma.Decimal(totalInvested),
        },
        update: {
          quantity: item.quantity,
          avgPrice: new Prisma.Decimal(item.avgPrice),
          currentPrice: new Prisma.Decimal(item.currentPrice),
          profitLoss: new Prisma.Decimal(item.profitLoss),
          profitRate: new Prisma.Decimal(item.profitRate),
          stockName: item.stockName,
          exchangeCode: item.exchangeCode,
          totalInvested: new Prisma.Decimal(totalInvested),
        },
      });
    }

    // 보유하지 않는 포지션 삭제
    const stockCodes = items.map((i) => i.stockCode);
    if (stockCodes.length > 0) {
      await this.prisma.position.deleteMany({
        where: {
          market: market as Market,
          stockCode: { notIn: stockCodes },
        },
      });
    }
  }

  // ── Quota 이월 (분할매수 전략) ──

  /** 매수 성공 시 누적 quota 리셋 */
  private async resetAccumulatedQuota(watchStockId: string): Promise<void> {
    try {
      const ws = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      if (!ws) return;
      const params = (ws.strategyParams as Record<string, any>) || {};
      const today = new Date().toISOString().slice(0, 10);
      await this.prisma.watchStock.update({
        where: { id: watchStockId },
        data: { strategyParams: { ...params, accumulatedQuota: 0, lastAccumulatedDate: today } },
      });
      if (params.accumulatedQuota) {
        this.logger.log(`[${ws.stockCode}] Accumulated quota reset after buy`);
      }
    } catch (e) {
      this.logger.warn(`Failed to reset accumulated quota: ${e.message}`);
    }
  }

  /** 매수 시그널이 없었던 종목에 대해 quota 누적 (1주 가격 부족 시 이월) */
  private async accumulateUnusedQuotas(
    strategyName: string,
    contexts: StockStrategyContext[],
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    for (const ctx of contexts) {
      if (ctx.alreadyExecutedToday) continue;

      const ws = await this.prisma.watchStock.findUnique({ where: { id: ctx.watchStock.id } });
      if (!ws || !ws.quota) continue;

      const params = (ws.strategyParams as Record<string, any>) || {};
      if (params.lastAccumulatedDate === today) continue; // 오늘 이미 누적됨

      // 이 종목에 대해 매수 시그널이 있었는지 확인 (executeSignal에서 리셋했으면 skip)
      const updatedWs = await this.prisma.watchStock.findUnique({ where: { id: ctx.watchStock.id } });
      const updatedParams = (updatedWs?.strategyParams as Record<string, any>) || {};
      if (updatedParams.lastAccumulatedDate === today) continue; // 리셋 후 이미 처리됨

      const perCycleQuota = Number(ws.quota) / ws.maxCycles;
      if (perCycleQuota <= 0) continue;

      const newAccumulated = (updatedParams.accumulatedQuota || 0) + perCycleQuota;
      await this.prisma.watchStock.update({
        where: { id: ws.id },
        data: {
          strategyParams: {
            ...updatedParams,
            accumulatedQuota: newAccumulated,
            lastAccumulatedDate: today,
          },
        },
      });
      this.logger.log(
        `[${ws.stockCode}] Accumulated quota: ${newAccumulated.toFixed(2)} (no buy signal today)`,
      );
    }
  }
}
