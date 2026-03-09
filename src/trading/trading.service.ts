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
import { Market, Side, OrderType, OrderStatus, Prisma } from '@prisma/client';
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
      } catch (e) {
        this.logger.error(
          `Error executing strategy for ${ctx.watchStock.stockCode}: ${e.message}`,
        );
      }
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
}
