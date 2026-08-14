import { Injectable } from '@nestjs/common';
import { Broker, Market, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BalanceItem } from '../kis/types/kis-api.types';

@Injectable()
export class TradingPositionSyncService {
  constructor(private prisma: PrismaService) {}

  /** 포지션 동기화 (DB) */
  async syncPositions(
    broker: Broker,
    market: 'DOMESTIC' | 'OVERSEAS',
    items: BalanceItem[],
  ): Promise<void> {
    for (const item of items) {
      // totalInvested = quantity × avgPrice
      const totalInvested = item.quantity * item.avgPrice;

      await this.prisma.position.upsert({
        where: {
          broker_market_exchangeCode_stockCode: {
            broker,
            market: market as Market,
            exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
            stockCode: item.stockCode,
          },
        },
        create: {
          broker,
          market: market as Market,
          exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
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
          exchangeCode: item.exchangeCode ?? (market === 'DOMESTIC' ? 'KRX' : ''),
          totalInvested: new Prisma.Decimal(totalInvested),
        },
      });
    }

    // 보유하지 않는 포지션 삭제
    const stockCodes = items.map((i) => i.stockCode);
    await this.prisma.position.deleteMany({
      where: stockCodes.length > 0
        ? {
          broker,
          market: market as Market,
          stockCode: { notIn: stockCodes },
        }
        : { broker, market: market as Market },
    });
  }
}
