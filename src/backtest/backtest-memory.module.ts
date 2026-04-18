/**
 * In-memory backtest module — DB 의존 없이 KIS API + 전략만 사용.
 *
 * 일반 BacktestModule은 PrismaService를 통해 과거 데이터를 캐시/로드하지만,
 * 이 모듈은 DB 없이 매번 KIS API에서 수집하여 바로 백테스트를 돌린다.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KisModule } from '../kis/kis.module';
import { InfiniteBuyStrategy } from '../trading/strategy/infinite-buy.strategy';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), KisModule],
  providers: [InfiniteBuyStrategy],
  exports: [InfiniteBuyStrategy],
})
export class BacktestMemoryModule {}
