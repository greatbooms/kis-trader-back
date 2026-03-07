import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import configuration from './config/configuration';
import { KisModule } from './kis/kis.module';
import { TradingModule } from './trading/trading.module';
import { WatchStockModule } from './watch-stock/watch-stock.module';
import { TradeRecordModule } from './trade-record/trade-record.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { NotificationModule } from './notification/notification.module';
import { SimulationModule } from './simulation/simulation.module';
import { StockMasterModule } from './stock-master/stock-master.module';
import { ScreeningModule } from './screening/screening.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      playground: true,
      introspection: true,
      context: ({ req, res }) => ({ req, res }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client', 'dist'),
      exclude: ['/graphql', '/health'],
    }),
    ScheduleModule.forRoot(),
    KisModule,
    TradingModule,
    WatchStockModule,
    TradeRecordModule,
    AuthModule,
    NotificationModule,
    SimulationModule,
    StockMasterModule,
    ScreeningModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
