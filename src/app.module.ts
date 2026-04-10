import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { MarketDataModule } from './market-data/market-data.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get<string>('NODE_ENV') === 'production';
        return {
          autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
          playground: !isProduction,
          introspection: !isProduction,
          context: ({ req, res }) => ({ req, res }),
        };
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client', 'dist'),
      exclude: ['/graphql', '/health'],
    }),
    ScheduleModule.forRoot(),
    MarketDataModule,
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
