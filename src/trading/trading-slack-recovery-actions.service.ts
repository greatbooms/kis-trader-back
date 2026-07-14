import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BrokerOrderActionChannel } from '@prisma/client';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';
import { TradingSlackActorAuthorizationService } from './trading-slack-actor-authorization.service';
import { TradingSlackRecoveryPresentationService } from './trading-slack-recovery-presentation.service';
import { BrokerActionContext } from './types/broker-action-context.type';
import { SlackMessageOrigin } from './types/slack-message-origin.type';
import { SlackRecoveryCandidatePayload } from './types/slack-recovery-candidate-payload.type';
import { SlackRecoveryExistingMatchPayload } from './types/slack-recovery-existing-match-payload.type';
import { SlackRecoveryModalAction } from './types/slack-recovery-modal-action.type';
import { SlackRecoveryTradePayload } from './types/slack-recovery-trade-payload.type';

@Injectable()
export class TradingSlackRecoveryActionsService implements OnModuleInit {
  private readonly logger = new Logger(TradingSlackRecoveryActionsService.name);

  constructor(
    private readonly recoveryService: TradingBrokerOrderRecoveryService,
    private readonly authorization: TradingSlackActorAuthorizationService,
    private readonly presentation: TradingSlackRecoveryPresentationService,
  ) {}

  onModuleInit(): void {
    const app = this.presentation.getApp();
    if (!app) return;

    app.command('/확인필요주문', async (args: any) => this.handleListCommand(args));

    app.action('broker_recovery_inspect_submission', async (args: any) => (
      this.handleSubmissionInspection(args)
    ));
    app.action('broker_recovery_assign_context', async (args: any) => (
      this.handleOpenModal('ASSIGN_CONTEXT', args)
    ));
    app.action('broker_recovery_link_candidate', async (args: any) => (
      this.handleOpenModal('LINK_CANDIDATE', args)
    ));
    app.action('broker_recovery_not_submitted', async (args: any) => (
      this.handleOpenModal('NOT_SUBMITTED', args)
    ));
    app.action('broker_recovery_match_existing', async (args: any) => (
      this.handleOpenModal('MATCH_EXISTING', args)
    ));
    app.action('broker_recovery_inspect_cancellation', async (args: any) => (
      this.handleOpenModal('INSPECT_CANCELLATION', args)
    ));
    app.action('broker_recovery_cancellation_not_accepted', async (args: any) => (
      this.handleOpenModal('CANCELLATION_NOT_ACCEPTED', args)
    ));

    app.view('broker_recovery_assign_context_confirm', async (args: any) => (
      this.handleViewSubmission('ASSIGN_CONTEXT', args)
    ));
    app.view('broker_recovery_link_candidate_confirm', async (args: any) => (
      this.handleViewSubmission('LINK_CANDIDATE', args)
    ));
    app.view('broker_recovery_not_submitted_confirm', async (args: any) => (
      this.handleViewSubmission('NOT_SUBMITTED', args)
    ));
    app.view('broker_recovery_match_existing_confirm', async (args: any) => (
      this.handleViewSubmission('MATCH_EXISTING', args)
    ));
    app.view('broker_recovery_inspect_cancellation_confirm', async (args: any) => (
      this.handleViewSubmission('INSPECT_CANCELLATION', args)
    ));
    app.view('broker_recovery_cancellation_not_accepted_confirm', async (args: any) => (
      this.handleViewSubmission('CANCELLATION_NOT_ACCEPTED', args)
    ));

    this.logger.log('Slack broker-order recovery actions registered');
  }

  private async handleListCommand(args: any): Promise<void> {
    const { ack, command, respond } = args;
    await ack();
    const actor = this.authorization.authorize(command?.user_id);
    if (!actor) {
      await this.presentation.respondUnauthorized(respond);
      return;
    }
    try {
      const items = await this.recoveryService.listRecoveryItems();
      await this.presentation.presentRecoveryItems(respond, items);
    } catch (error) {
      this.logger.warn(`Slack recovery list failed: ${this.errorMessage(error)}`);
      await this.presentation.respondFailure(respond, 'LIST');
    }
  }

  private async handleSubmissionInspection(args: any): Promise<void> {
    const { ack, body, respond } = args;
    await ack();
    const actor = this.authorization.authorize(body?.user?.id);
    if (!actor) {
      await this.presentation.respondUnauthorized(respond);
      return;
    }
    try {
      const payload = this.parseTradePayload(this.actionValue(body));
      const origin = payload.origin ?? this.originFromBody(body);
      const inspection = await this.recoveryService.inspectCandidates(
        payload.tradeRecordId,
        this.slackContext(actor),
      );
      await this.presentation.presentCandidates(respond, inspection, origin);
    } catch (error) {
      this.logger.warn(`Slack submission inspection failed: ${this.errorMessage(error)}`);
      await this.presentation.respondFailure(respond, 'INSPECTION');
    }
  }

  private async handleOpenModal(
    action: SlackRecoveryModalAction,
    args: any,
  ): Promise<void> {
    const { ack, body, respond } = args;
    await ack();
    const actor = this.authorization.authorize(body?.user?.id);
    if (!actor) {
      await this.presentation.respondUnauthorized(respond);
      return;
    }

    try {
      const triggerId = this.requiredString(body?.trigger_id, 'Slack trigger ID', 255);
      const origin = this.originFromBody(body);
      if (action === 'LINK_CANDIDATE') {
        const payload = this.withOrigin(
          this.parseCandidatePayload(this.actionValue(body)),
          origin,
        );
        await this.presentation.openLinkCandidateModal(triggerId, payload);
        return;
      }
      if (action === 'MATCH_EXISTING') {
        const payload = this.withOrigin(
          this.parseExistingPayload(this.actionValue(body)),
          origin,
        );
        await this.presentation.openMatchExistingModal(triggerId, payload);
        return;
      }

      const payload = this.withOrigin(
        this.parseTradePayload(this.actionValue(body)),
        origin,
      );
      switch (action) {
        case 'ASSIGN_CONTEXT': {
          const preview = this.recoveryService.getCurrentContextPreview();
          await this.presentation.openContextAssignmentModal(
            triggerId,
            { ...payload, contextToken: preview.contextToken },
            preview,
          );
          return;
        }
        case 'NOT_SUBMITTED':
          await this.presentation.openNotSubmittedModal(triggerId, payload);
          return;
        case 'INSPECT_CANCELLATION':
          await this.presentation.openCancellationInspectionModal(triggerId, payload);
          return;
        case 'CANCELLATION_NOT_ACCEPTED':
          await this.presentation.openCancellationNotAcceptedModal(triggerId, payload);
          return;
        default:
          throw new Error('Unsupported Slack recovery action');
      }
    } catch (error) {
      this.logger.warn(`Slack recovery confirmation failed: ${this.errorMessage(error)}`);
      await this.presentation.respondFailure(respond, 'MODAL');
    }
  }

  private async handleViewSubmission(
    action: SlackRecoveryModalAction,
    args: any,
  ): Promise<void> {
    const { ack, body, view } = args;
    const userId = typeof body?.user?.id === 'string' ? body.user.id : '';
    let payload: SlackRecoveryTradePayload;
    try {
      payload = action === 'LINK_CANDIDATE'
        ? this.parseCandidatePayload(view?.private_metadata)
        : action === 'MATCH_EXISTING'
          ? this.parseExistingPayload(view?.private_metadata)
          : this.parseTradePayload(view?.private_metadata);
    } catch (error) {
      await ack();
      this.logger.warn(`Invalid Slack recovery modal payload: ${this.errorMessage(error)}`);
      return;
    }

    const actor = this.authorization.authorize(userId);
    if (!actor) {
      await ack();
      await this.presentation.presentFailure(
        payload.origin ?? null,
        userId,
        'UNAUTHORIZED',
      );
      return;
    }
    if (!this.isAcknowledged(view)) {
      await ack({
        response_action: 'errors',
        errors: { confirmation: '필수 확인 항목에 동의해주세요.' },
      });
      return;
    }
    await ack();

    try {
      const context = this.slackContext(actor);
      const item = await this.executeConfirmedAction(action, payload, context);
      if (action === 'ASSIGN_CONTEXT') {
        await this.presentation.presentContextAssignment(
          payload.origin ?? null,
          actor,
          item,
        );
        return;
      }
      if (action === 'INSPECT_CANCELLATION') {
        await this.presentation.presentCancellationInspection(
          payload.origin ?? null,
          actor,
          item,
        );
        return;
      }
      await this.presentation.presentResolution(
        payload.origin ?? null,
        actor,
        item,
        this.resolutionLabel(action),
      );
    } catch (error) {
      this.logger.warn(`Slack recovery mutation failed: ${this.errorMessage(error)}`);
      await this.presentation.presentFailure(
        payload.origin ?? null,
        actor,
        'MUTATION',
      );
    }
  }

  private executeConfirmedAction(
    action: SlackRecoveryModalAction,
    payload: SlackRecoveryTradePayload,
    context: BrokerActionContext,
  ) {
    switch (action) {
      case 'ASSIGN_CONTEXT':
        return this.recoveryService.assignCurrentContext(
          payload.tradeRecordId,
          this.requiredString(payload.contextToken, 'Broker context token', 200),
          context,
        );
      case 'LINK_CANDIDATE': {
        const candidate = payload as SlackRecoveryCandidatePayload;
        return this.recoveryService.linkCandidate({
          tradeRecordId: candidate.tradeRecordId,
          brokerOrderDate: candidate.brokerOrderDate,
          exchangeCode: candidate.exchangeCode,
          orderNo: candidate.orderNo,
        }, context);
      }
      case 'NOT_SUBMITTED':
        return this.recoveryService.confirmNotSubmitted(payload.tradeRecordId, context);
      case 'MATCH_EXISTING': {
        const existing = payload as SlackRecoveryExistingMatchPayload;
        return this.recoveryService.confirmMatchesExisting({
          tradeRecordId: existing.tradeRecordId,
          brokerOrderDate: existing.brokerOrderDate,
          exchangeCode: existing.exchangeCode,
          orderNo: existing.orderNo,
          existingTradeRecordId: existing.existingTradeRecordId,
        }, context);
      }
      case 'INSPECT_CANCELLATION':
        return this.recoveryService.inspectCancellation(payload.tradeRecordId, context);
      case 'CANCELLATION_NOT_ACCEPTED':
        return this.recoveryService.confirmCancellationNotAccepted(
          payload.tradeRecordId,
          context,
        );
    }
  }

  private parseTradePayload(value: unknown): SlackRecoveryTradePayload {
    const parsed = this.parseJsonObject(value);
    if (parsed.v !== 1) throw new Error('Unsupported Slack recovery payload version');
    const tradeRecordId = this.requiredString(
      parsed.tradeRecordId,
      'TradeRecord ID',
      200,
    );
    const origin = this.parseOrigin(parsed.origin);
    const contextToken = parsed.contextToken === undefined
      ? undefined
      : this.requiredString(parsed.contextToken, 'Broker context token', 200);
    return {
      v: 1,
      tradeRecordId,
      ...(contextToken ? { contextToken } : {}),
      ...(origin ? { origin } : {}),
    };
  }

  private parseCandidatePayload(value: unknown): SlackRecoveryCandidatePayload {
    const parsed = this.parseJsonObject(value);
    const trade = this.parseTradePayload(value);
    const brokerOrderDate = this.requiredString(
      parsed.brokerOrderDate,
      'Broker order date',
      8,
    );
    if (!/^\d{8}$/.test(brokerOrderDate)) {
      throw new Error('Invalid broker order date');
    }
    return {
      ...trade,
      brokerOrderDate,
      exchangeCode: this.requiredString(
        parsed.exchangeCode,
        'Exchange code',
        20,
      ).toUpperCase(),
      orderNo: this.requiredString(parsed.orderNo, 'Broker order number', 100),
    };
  }

  private parseExistingPayload(value: unknown): SlackRecoveryExistingMatchPayload {
    const parsed = this.parseJsonObject(value);
    return {
      ...this.parseCandidatePayload(value),
      existingTradeRecordId: this.requiredString(
        parsed.existingTradeRecordId,
        'Existing TradeRecord ID',
        200,
      ),
    };
  }

  private parseJsonObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string' || !value.trim() || value.length > 3_000) {
      throw new Error('Invalid Slack recovery payload');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('Invalid Slack recovery payload');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid Slack recovery payload');
    }
    return parsed as Record<string, unknown>;
  }

  private parseOrigin(value: unknown): SlackMessageOrigin | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid Slack message origin');
    }
    const origin = value as Record<string, unknown>;
    return {
      channel: this.requiredString(origin.channel, 'Slack channel', 200),
      messageTs: this.requiredString(origin.messageTs, 'Slack message timestamp', 100),
    };
  }

  private originFromBody(body: any): SlackMessageOrigin | null {
    const channel = typeof body?.container?.channel_id === 'string'
      ? body.container.channel_id.trim()
      : '';
    const messageTs = typeof body?.container?.message_ts === 'string'
      ? body.container.message_ts.trim()
      : '';
    return channel && messageTs ? { channel, messageTs } : null;
  }

  private withOrigin<T extends SlackRecoveryTradePayload>(
    payload: T,
    origin: SlackMessageOrigin | null,
  ): T {
    return payload.origin || !origin ? payload : { ...payload, origin };
  }

  private actionValue(body: any): unknown {
    return body?.actions?.[0]?.value;
  }

  private isAcknowledged(view: any): boolean {
    const selected = view?.state?.values?.confirmation?.acknowledged?.selected_options;
    return Array.isArray(selected)
      && selected.some((option) => option?.value === 'confirmed');
  }

  private slackContext(actor: string): BrokerActionContext {
    return {
      channel: BrokerOrderActionChannel.SLACK,
      actor: `slack:${actor}`,
    };
  }

  private resolutionLabel(action: SlackRecoveryModalAction): string {
    switch (action) {
      case 'ASSIGN_CONTEXT': return '현재 계좌 컨텍스트 지정 완료';
      case 'LINK_CANDIDATE': return 'KIS 주문 연결 완료';
      case 'NOT_SUBMITTED': return '미주문 확정 완료';
      case 'MATCH_EXISTING': return '기존 기록과 동일 확정 완료';
      case 'CANCELLATION_NOT_ACCEPTED': return '취소 미접수 확정 완료';
      case 'INSPECT_CANCELLATION': return '취소 상태 확인 완료';
    }
  }

  private requiredString(value: unknown, label: string, maxLength: number): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > maxLength) {
      throw new Error(`Invalid ${label}`);
    }
    return normalized;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
