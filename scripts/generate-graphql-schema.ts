import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { printSchema } from 'graphql';

import { TradingResolver } from '../src/trading/trading.resolver';
import { TradingBrokerOrderRecoveryResolver } from '../src/trading/trading-broker-order-recovery.resolver';
import { WatchStockResolver } from '../src/watch-stock/watch-stock.resolver';
import { TradeRecordResolver } from '../src/trade-record/trade-record.resolver';
import { AuthResolver } from '../src/auth/auth.resolver';
import { SimulationResolver } from '../src/simulation/simulation.resolver';
import { StockMasterResolver } from '../src/stock-master/stock-master.resolver';
import { ScreeningResolver } from '../src/screening/screening.resolver';

/**
 * src/schema.gql를 앱을 부팅하지 않고 재생성한다.
 *
 * 보통 NestJS 코드-퍼스트 스키마는 `autoSchemaFile` 설정 덕에 앱이 부팅될 때(GraphQLModule)
 * 자동 갱신된다 — 하지만 전체 앱 부팅은 cron 등록/KIS 인증/Slack 연결 등 실제 부작용을
 * 일으킬 수 있어(과거 사고 전례) 로컬/에이전트 환경에서 함부로 재현하면 위험하다.
 *
 * `GraphQLSchemaBuilderModule` + `GraphQLSchemaFactory`는 NestJS가 공식 제공하는 오프라인 방법 —
 * 리졸버 "클래스"를 넘기면 데코레이터 메타데이터만 읽어 스키마를 조립하며, 어떤 서비스도
 * 인스턴스화하지 않는다(Prisma/KIS/Slack 접근 없음). 실행: `npm run schema:generate`
 *
 * 리졸버 배열 순서는 AppModule의 모듈 import 순서 + 각 모듈 providers 순서와 동일해야
 * 기존 schema.gql과 diff가 깨끗하게 유지된다. 새 모듈/리졸버 추가 시 이 배열도 함께 갱신할 것.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(GraphQLSchemaBuilderModule, {
    logger: false,
  });
  const gqlSchemaFactory = app.get(GraphQLSchemaFactory);

  const schema = await gqlSchemaFactory.create([
    TradingResolver,
    TradingBrokerOrderRecoveryResolver,
    WatchStockResolver,
    TradeRecordResolver,
    AuthResolver,
    SimulationResolver,
    StockMasterResolver,
    ScreeningResolver,
  ]);

  // @nestjs/graphql의 GRAPHQL_SDL_FILE_HEADER와 동일한 문구 — 앱 부팅 시 생성되는 파일과
  // 텍스트가 일치해야 diff가 깨끗하다.
  const header = [
    '# ------------------------------------------------------',
    '# THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)',
    '# ------------------------------------------------------',
    '',
    '',
  ].join('\n');

  // 기존 schema.gql 컨벤션과 맞추기 위해 파일 끝에 개행 하나를 유지한다 (printSchema 자체는 안 붙임).
  writeFileSync(join(__dirname, '..', 'src', 'schema.gql'), `${header}${printSchema(schema)}\n`);
  await app.close();
  // eslint-disable-next-line no-console
  console.log('src/schema.gql regenerated offline (no DB/KIS/Slack access).');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
