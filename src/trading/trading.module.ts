import { Module } from '@nestjs/common';
import { TradingService } from './trading.service';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { TradingPositionRefreshService } from './trading-position-refresh.service';
import { TradingSellApprovalService } from './trading-sell-approval.service';
import { TradingSellApprovalWorkflowService } from './trading-sell-approval-workflow.service';
import { TradingOrderReconciliationService } from './trading-order-reconciliation.service';
import { TradingOrchestrator } from './trading-orchestrator.service';
import { TradingSlackCommandsService } from './trading-slack-commands.service';
import { TradingSlackActorAuthorizationService } from './trading-slack-actor-authorization.service';
import { TradingSlackRecoveryPresentationService } from './trading-slack-recovery-presentation.service';
import { TradingSlackRecoveryActionsService } from './trading-slack-recovery-actions.service';
import { MarketStateSyncService } from './market-state-sync.service';
import { TradingScheduler } from './trading.scheduler';
import { TradingResolver } from './trading.resolver';
import { MarketAnalysisService } from './market-analysis.service';
import { MarketRegimeService } from './market-regime.service';
import { RiskManagementService } from './risk-management.service';
import { StrategyRegistryService } from './strategy/strategy-registry.service';
import { InfiniteBuyStrategy } from './strategy/infinite-buy.strategy';
import { MomentumBreakoutStrategy } from './strategy/momentum-breakout.strategy';
import { GridMeanReversionStrategy } from './strategy/grid-mean-reversion.strategy';
import { ConservativeStrategy } from './strategy/conservative.strategy';
import { TrendFollowingStrategy } from './strategy/trend-following.strategy';
import { ValueFactorStrategy } from './strategy/value-factor.strategy';
import { DailyDcaStrategy } from './strategy/daily-dca.strategy';
import { OrderSyncService } from './order-sync.service';
import { KisModule } from '../kis/kis.module';
import { PrismaService } from '../prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';
import { TradingLiveSwitchService } from './trading-live-switch.service';
import { TradingOrderCancellationService } from './trading-order-cancellation.service';
import { TradingOrderExecutionService } from './trading-order-execution.service';
import { TradingOrderGuardService } from './trading-order-guard.service';
import { TradingBrokerOrderMatcherService } from './trading-broker-order-matcher.service';
import { TradingBrokerOrderResolutionService } from './trading-broker-order-resolution.service';
import { TradingBrokerCancellationRecoveryService } from './trading-broker-cancellation-recovery.service';
import { TradingBrokerOrderRecoveryResolver } from './trading-broker-order-recovery.resolver';
import { TradingBrokerRecoverySlackAlertService } from './trading-broker-recovery-slack-alert.service';
import { TradingBrokerOrderSubmissionService } from './trading-broker-order-submission.service';
import { TradingSellApprovalNotificationService } from './trading-sell-approval-notification.service';

@Module({
  imports: [KisModule, NotificationModule],
  providers: [
    TradingService,
    TradingPositionSyncService,
    TradingPositionRefreshService,
    TradingSellApprovalService,
    TradingSellApprovalWorkflowService,
    TradingSellApprovalNotificationService,
    TradingOrderReconciliationService,
    OrderSyncService,
    TradingOrchestrator,
    TradingSlackCommandsService,
    TradingSlackActorAuthorizationService,
    TradingSlackRecoveryPresentationService,
    TradingSlackRecoveryActionsService,
    MarketStateSyncService,
    TradingScheduler,
    TradingResolver,
    TradingBrokerOrderRecoveryResolver,
    MarketAnalysisService,
    MarketRegimeService,
    RiskManagementService,
    StrategyRegistryService,
    InfiniteBuyStrategy,
    MomentumBreakoutStrategy,
    GridMeanReversionStrategy,
    ConservativeStrategy,
    TrendFollowingStrategy,
    ValueFactorStrategy,
    DailyDcaStrategy,
    TradingBrokerContextService,
    TradingBrokerOrderRecoveryService,
    TradingLiveSwitchService,
    TradingOrderCancellationService,
    TradingOrderExecutionService,
    TradingBrokerOrderSubmissionService,
    TradingOrderGuardService,
    TradingBrokerOrderMatcherService,
    TradingBrokerOrderResolutionService,
    TradingBrokerCancellationRecoveryService,
    TradingBrokerRecoverySlackAlertService,
    PrismaService,
  ],
  exports: [
    TradingService,
    TradingPositionSyncService,
    TradingPositionRefreshService,
    TradingSellApprovalService,
    TradingOrderReconciliationService,
    OrderSyncService,
    TradingOrchestrator,
    MarketStateSyncService,
    TradingScheduler,
    MarketAnalysisService,
    MarketRegimeService,
    StrategyRegistryService,
    RiskManagementService,
    TradingBrokerContextService,
    TradingBrokerOrderRecoveryService,
    TradingLiveSwitchService,
    TradingOrderGuardService,
  ],
})
export class TradingModule {}
