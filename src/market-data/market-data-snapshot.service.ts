import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MarketDataSnapshotRequest } from './types';

interface CachedValue<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class MarketDataSnapshotService {
  private readonly memoryCache = new Map<string, CachedValue<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private prisma: PrismaService) {}

  async getOrLoad<T>(
    request: MarketDataSnapshotRequest,
    loader: () => Promise<T | undefined>,
  ): Promise<T | undefined> {
    const key = this.buildKey(request);
    const now = Date.now();

    if (!request.forceRefresh) {
      const memoryCached = this.memoryCache.get(key);
      if (memoryCached && memoryCached.expiresAt > now) {
        return memoryCached.data as T | undefined;
      }

      const snapshot = await this.prisma.marketDataSnapshot.findUnique({
        where: { snapshotKey: key },
      });
      if (snapshot && snapshot.expiresAt.getTime() > now) {
        this.memoryCache.set(key, {
          data: snapshot.data as T,
          expiresAt: snapshot.expiresAt.getTime(),
        });
        return snapshot.data as T;
      }
    }

    if (this.inflight.has(key)) {
      return this.inflight.get(key) as Promise<T | undefined>;
    }

    const loadPromise = (async () => {
      const data = await loader();
      if (data === undefined) return undefined;

      const expiresAt = new Date(Date.now() + request.ttlMs);
      await this.prisma.marketDataSnapshot.upsert({
        where: { snapshotKey: key },
        update: {
          data: data as Prisma.InputJsonValue,
          expiresAt,
          source: request.source,
          category: request.category,
          market: request.market,
          exchangeCode: request.exchangeCode,
          stockCode: request.stockCode,
        },
        create: {
          snapshotKey: key,
          source: request.source,
          category: request.category,
          market: request.market,
          exchangeCode: request.exchangeCode,
          stockCode: request.stockCode,
          data: data as Prisma.InputJsonValue,
          expiresAt,
        },
      });

      this.memoryCache.set(key, {
        data,
        expiresAt: expiresAt.getTime(),
      });
      return data;
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, loadPromise);
    return loadPromise;
  }

  private buildKey(request: MarketDataSnapshotRequest): string {
    return [
      request.source,
      request.category,
      request.market ?? '-',
      request.exchangeCode ?? '-',
      request.stockCode ?? '-',
    ].join(':');
  }
}
