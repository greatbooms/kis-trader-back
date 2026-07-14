import { MODULE_METADATA } from '@nestjs/common/constants';
import { NotificationModule } from '../notification/notification.module';
import { SlackService } from '../notification/slack.service';
import { TradingModule } from './trading.module';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';
import { TradingBrokerCancellationRecoveryService } from './trading-broker-cancellation-recovery.service';
import { TradingBrokerOrderRecoveryResolver } from './trading-broker-order-recovery.resolver';
import { TradingBrokerRecoverySlackAlertService } from './trading-broker-recovery-slack-alert.service';
import { TradingBrokerOrderSubmissionService } from './trading-broker-order-submission.service';
import { TradingLiveSwitchService } from './trading-live-switch.service';
import { TradingOrderCancellationService } from './trading-order-cancellation.service';
import { TradingOrderExecutionService } from './trading-order-execution.service';
import { TradingSellApprovalService } from './trading-sell-approval.service';
import { TradingSellApprovalNotificationService } from './trading-sell-approval-notification.service';
import { TradingSellApprovalWorkflowService } from './trading-sell-approval-workflow.service';
import { TradingSlackActorAuthorizationService } from './trading-slack-actor-authorization.service';
import { TradingSlackCommandsService } from './trading-slack-commands.service';
import { TradingSlackRecoveryActionsService } from './trading-slack-recovery-actions.service';
import { TradingSlackRecoveryPresentationService } from './trading-slack-recovery-presentation.service';

describe('TradingModule', () => {
  it('registers TradingSellApprovalService as a provider before exporting it', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TradingModule) || [];

    expect(providers).toContain(TradingSellApprovalService);
  });

  it('registers the sell approval workflow as a local provider', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TradingModule) || [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, TradingModule) || [];

    expect(providers).toContain(TradingSellApprovalWorkflowService);
    expect(exports).not.toContain(TradingSellApprovalWorkflowService);
  });

  it('keeps broker submission and approval notification gateways local', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TradingModule) || [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, TradingModule) || [];

    expect(providers).toEqual(expect.arrayContaining([
      TradingBrokerOrderSubmissionService,
      TradingSellApprovalNotificationService,
    ]));
    expect(exports).not.toContain(TradingBrokerOrderSubmissionService);
    expect(exports).not.toContain(TradingSellApprovalNotificationService);
  });

  it('keeps NotificationModule independent and exports only SlackService', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, NotificationModule) || [];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, NotificationModule) || [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, NotificationModule) || [];

    expect(imports).toEqual([]);
    expect(providers).toEqual([SlackService]);
    expect(exports).toEqual([SlackService]);
  });

  it('owns the Slack command adapter without exporting it back across the module boundary', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, TradingModule) || [];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TradingModule) || [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, TradingModule) || [];

    expect(imports).toContain(NotificationModule);
    expect(providers).toContain(TradingSlackCommandsService);
    expect(exports).not.toContain(TradingSlackCommandsService);
  });

  it('registers Slack recovery actions, presentation, authorization, and alerts as local providers', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TradingModule) || [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, TradingModule) || [];
    const localProviders = [
      TradingSlackActorAuthorizationService,
      TradingSlackRecoveryPresentationService,
      TradingSlackRecoveryActionsService,
      TradingBrokerRecoverySlackAlertService,
    ];

    expect(providers).toEqual(expect.arrayContaining(localProviders));
    for (const provider of localProviders) {
      expect(exports).not.toContain(provider);
    }
  });

  it('registers order lifecycle services and exports the shared trade-record dependencies', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TradingModule) || [];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, TradingModule) || [];

    expect(providers).toEqual(
      expect.arrayContaining([
        TradingLiveSwitchService,
        TradingBrokerOrderRecoveryService,
        TradingBrokerCancellationRecoveryService,
        TradingBrokerOrderRecoveryResolver,
        TradingOrderExecutionService,
        TradingOrderCancellationService,
      ]),
    );
    expect(exports).toEqual(
      expect.arrayContaining([TradingLiveSwitchService, TradingBrokerOrderRecoveryService]),
    );
  });
});
