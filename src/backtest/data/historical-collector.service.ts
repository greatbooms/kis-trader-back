import { Injectable, Logger } from '@nestjs/common';
import { Market } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { KisDomesticService } from '../../kis/kis-domestic.service';
import { KisOverseasService } from '../../kis/kis-overseas.service';
import { DailyPrice } from '../../kis/types/kis-api.types';
import { OHLCV } from './indicator-calculator';

export interface HistoricalTicker {
  market: Market;
  exchangeCode: string;
  stockCode: string;
  stockName?: string;
}

export interface CollectOptions {
  from: string;  // YYYYMMDD
  to: string;    // YYYYMMDD
  persist?: boolean; // default true — DB 저장
  force?: boolean;   // default false — 이미 저장된 데이터도 재수집
}

@Injectable()
export class HistoricalCollectorService {
  private readonly logger = new Logger(HistoricalCollectorService.name);

  constructor(
    private prisma: PrismaService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
  ) {}

  /** 단일 티커 수집. persist=true면 DB upsert, false면 메모리만 반환. */
  async collectTicker(ticker: HistoricalTicker, options: CollectOptions): Promise<OHLCV[]> {
    const { from, to, persist = true, force = false } = options;

    // 이미 저장되어 있고 force=false면 DB에서 로드해 반환
    // 거래일 기준이라 요청 from/to와 정확히 일치하지 않을 수 있어 7일 슬랙 허용
    if (persist && !force) {
      const existing = await this.loadFromDb(ticker, from, to);
      if (existing.length > 0) {
        const firstDate = existing[0].date;
        const lastDate = existing[existing.length - 1].date;
        const slackDays = 10;
        const coversStart = this.daysBetween(from, firstDate) <= slackDays;
        const coversEnd = this.daysBetween(lastDate, to) <= slackDays;
        if (coversStart && coversEnd) {
          this.logger.log(`[${ticker.stockCode}] cached ${existing.length} bars (${firstDate}~${lastDate})`);
          return existing;
        }
      }
    }

    let prices: DailyPrice[];
    if (ticker.market === 'DOMESTIC') {
      prices = await this.kisDomestic.getDailyPrices(ticker.stockCode, from, to);
    } else {
      // 해외는 count 기반이라 필요한 일수로 환산 (영업일 250/년 가정, 여유 ×1.3)
      const days = this.daysBetween(from, to);
      const count = Math.min(Math.ceil((days / 365) * 250 * 1.3), 2000);
      prices = await this.kisOverseas.getDailyPrices(ticker.exchangeCode, ticker.stockCode, count);
    }

    // 날짜 오름차순으로 정렬 + 기간 필터
    const filtered = prices
      .filter((p) => p.date >= from && p.date <= to && p.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    const ohlcv: OHLCV[] = filtered.map((p) => ({
      date: p.date,
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
    }));

    if (persist) {
      await this.upsertBatch(ticker, ohlcv);
      this.logger.log(`[${ticker.stockCode}] collected ${ohlcv.length} bars → DB`);
    } else {
      this.logger.log(`[${ticker.stockCode}] collected ${ohlcv.length} bars (in-memory only)`);
    }
    return ohlcv;
  }

  /** 여러 티커 배치 수집 (rate limit 고려하여 sequential + 50ms delay) */
  async collectBatch(tickers: HistoricalTicker[], options: CollectOptions): Promise<Map<string, OHLCV[]>> {
    const result = new Map<string, OHLCV[]>();
    for (const t of tickers) {
      try {
        const bars = await this.collectTicker(t, options);
        result.set(t.stockCode, bars);
        await new Promise((r) => setTimeout(r, 60));
      } catch (e: any) {
        this.logger.error(`[${t.stockCode}] collection failed: ${e.message}`);
        result.set(t.stockCode, []);
      }
    }
    return result;
  }

  async loadFromDb(ticker: HistoricalTicker, from: string, to: string): Promise<OHLCV[]> {
    const rows = await this.prisma.historicalDailyPrice.findMany({
      where: {
        market: ticker.market,
        exchangeCode: ticker.exchangeCode,
        stockCode: ticker.stockCode,
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      amount: r.amount ? Number(r.amount) : undefined,
    }));
  }

  private async upsertBatch(ticker: HistoricalTicker, bars: OHLCV[]): Promise<void> {
    if (bars.length === 0) return;
    // Prisma createMany는 unique 충돌 처리 불가 → 각 레코드 upsert 사용
    for (const b of bars) {
      await this.prisma.historicalDailyPrice.upsert({
        where: {
          market_exchangeCode_stockCode_date: {
            market: ticker.market,
            exchangeCode: ticker.exchangeCode,
            stockCode: ticker.stockCode,
            date: b.date,
          },
        },
        create: {
          market: ticker.market,
          exchangeCode: ticker.exchangeCode,
          stockCode: ticker.stockCode,
          date: b.date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: BigInt(Math.round(b.volume)),
          amount: b.amount !== undefined ? b.amount : null,
          adjusted: true,
        },
        update: {
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: BigInt(Math.round(b.volume)),
          amount: b.amount !== undefined ? b.amount : null,
          adjusted: true,
        },
      });
    }
  }

  private daysBetween(from: string, to: string): number {
    const f = new Date(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}`);
    const t = new Date(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}`);
    return Math.max(1, Math.round((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)));
  }
}
