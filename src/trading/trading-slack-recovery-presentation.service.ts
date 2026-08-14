import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { Button } from '@slack/types';
import { Broker, CancellationAttemptStatus } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { BrokerContextPreview } from './types/broker-context-preview.type';
import { BrokerOrderCandidateInspection } from './types/broker-order-candidate-inspection.type';
import { BrokerOrderRecoveryItem } from './types/broker-order-recovery-item.type';
import { BrokerOrderRecoverySlackAlert } from './types/broker-order-recovery-slack-alert.type';
import { SlackMessageOrigin } from './types/slack-message-origin.type';
import { SlackRecoveryCandidatePayload } from './types/slack-recovery-candidate-payload.type';
import { SlackRecoveryExistingMatchPayload } from './types/slack-recovery-existing-match-payload.type';
import { SlackRecoveryFailureKind } from './types/slack-recovery-failure-kind.type';
import { SlackRecoveryTradePayload } from './types/slack-recovery-trade-payload.type';

const MAX_PRESENTED_ITEMS = 10;
const SAFE_RECOVERY_FAILURE_MESSAGES: Record<SlackRecoveryFailureKind, string> = {
  UNAUTHORIZED: '주문 복구 작업을 수행할 권한이 없습니다.',
  LIST: '확인 필요 주문 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
  INSPECTION: '브로커 조회 결과를 확인하지 못했습니다. 웹 포트폴리오에서 현재 상태를 확인하세요.',
  MODAL: 'Slack 확인 창을 열지 못했습니다. 다시 시도하거나 웹 포트폴리오를 사용하세요.',
  MUTATION: '복구 작업을 확정하지 못했습니다. 웹 포트폴리오에서 현재 상태를 확인하세요.',
};

@Injectable()
export class TradingSlackRecoveryPresentationService {
  private readonly logger = new Logger(
    TradingSlackRecoveryPresentationService.name,
  );

  constructor(
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {}

  getApp(): App | null {
    return this.slackService.getApp();
  }

  async sendUnknownAlert(
    alert: BrokerOrderRecoverySlackAlert,
  ): Promise<SlackMessageOrigin | null> {
    const app = this.availableApp();
    const channel = this.configuredChannel();
    if (!app || !channel) return null;

    const lifecycleLabel = alert.lifecycle === 'CANCELLATION'
      ? '취소 결과 불명'
      : '주문 제출 결과 불명';
    const action = this.recoveryAction(
      alert.lifecycle,
      alert.brokerContextAssigned,
      { v: 1, tradeRecordId: alert.tradeRecordId, broker: alert.broker },
    );
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *${lifecycleLabel} | ${this.brokerTag(alert.broker, alert.stockCode)}* (${alert.stockName}, ${alert.exchangeCode})`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*구분:* ${alert.side}`,
            `*시장:* ${alert.market}`,
            `*수량:* ${alert.quantity}주`,
            `*의도 가격:* ${alert.price}`,
            `*시작 시각:* ${this.formatDate(alert.startedAt)}`,
            `*TradeRecord ID:* \`${alert.tradeRecordId}\``,
          ].join('\n'),
        },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `:no_entry: ${alert.broker} 확인 전 주문이나 취소를 다시 제출하지 마세요.`,
        }],
      },
      { type: 'actions', elements: [action] },
    ];

    try {
      const response = await app.client.chat.postMessage({
        channel,
        blocks,
        text: `${lifecycleLabel} | ${this.brokerTag(alert.broker, alert.stockCode)}`,
      });
      const messageTs = typeof response.ts === 'string' ? response.ts.trim() : '';
      const responseChannel = typeof response.channel === 'string'
        ? response.channel.trim()
        : '';
      return messageTs && responseChannel
        ? { channel: responseChannel, messageTs }
        : null;
    } catch (error) {
      this.logger.warn(
        `${this.brokerTag(alert.broker, alert.stockCode)} [RECOVERY ${alert.tradeRecordId}] Slack unknown alert failed: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  async sendStartupSummary(unresolvedCount: number): Promise<void> {
    const app = this.availableApp();
    const channel = this.configuredChannel();
    if (!app || !channel || !Number.isSafeInteger(unresolvedCount) || unresolvedCount <= 0) {
      return;
    }

    try {
      await app.client.chat.postMessage({
        channel,
        text: `시작 시 확인 필요 주문 ${unresolvedCount}건`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:warning: *시작 시 확인 필요 주문 ${unresolvedCount}건*`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '브로커 주문·취소 결과가 불명확한 항목입니다. 주문을 다시 제출하지 말고 웹 포트폴리오 또는 `/확인필요주문`에서 확인하세요.',
            },
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `Slack startup recovery summary failed: ${this.errorMessage(error)}`,
      );
    }
  }

  async presentRecoveryItems(
    respond: any,
    items: BrokerOrderRecoveryItem[],
  ): Promise<void> {
    if (items.length === 0) {
      await respond({
        text: ':white_check_mark: 현재 확인이 필요한 주문이 없습니다.',
        response_type: 'ephemeral',
      });
      return;
    }

    const blocks: any[] = [{
      type: 'section',
      text: { type: 'mrkdwn', text: `*확인 필요 주문 ${items.length}건*` },
    }];
    for (const item of items.slice(0, MAX_PRESENTED_ITEMS)) {
      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `*${item.lifecycle === 'CANCELLATION' ? '취소 결과 불명' : '주문 제출 결과 불명'}*`,
              `${this.brokerTag(item.broker, item.stockCode)} ${item.exchangeCode} ${item.side} ${item.quantity}주`,
              `TradeRecord: \`${item.tradeRecordId}\``,
            ].join('\n'),
          },
        },
        {
          type: 'actions',
          elements: [this.recoveryAction(
            item.lifecycle,
            item.brokerContextAssigned,
            { v: 1, tradeRecordId: item.tradeRecordId, broker: item.broker },
          )],
        },
      );
    }
    if (items.length > MAX_PRESENTED_ITEMS) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `외 ${items.length - MAX_PRESENTED_ITEMS}건은 웹 포트폴리오에서 확인하세요.`,
        }],
      });
    }
    await respond({ blocks, response_type: 'ephemeral' });
  }

  async presentCandidates(
    respond: any,
    inspection: BrokerOrderCandidateInspection,
    origin: SlackMessageOrigin | null,
  ): Promise<void> {
    const blocks: any[] = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${inspection.recoveryItem.broker} 주문 후보 조회 | ${this.brokerTag(inspection.recoveryItem.broker, inspection.recoveryItem.stockCode)}*`,
      },
    }];

    if (inspection.candidates.length > MAX_PRESENTED_ITEMS) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `완전한 ${inspection.recoveryItem.broker} 이력에서 후보가 ${inspection.candidates.length}건 조회되었습니다.`,
            '일부 후보만 표시하면 잘못된 주문을 선택할 수 있으므로 Slack 연결 버튼을 제공하지 않습니다.',
            '*웹 포트폴리오의 확인 필요 주문에서 전체 후보를 검토하세요.*',
          ].join('\n'),
        },
      });
      await respond({
        blocks,
        text: `${inspection.recoveryItem.broker} 주문 후보 ${inspection.candidates.length}건 · 웹 포트폴리오 확인 필요`,
        response_type: 'ephemeral',
        replace_original: false,
      });
      return;
    }

    if (inspection.candidates.length === 0) {
      blocks.push(
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `완전한 ${inspection.recoveryItem.broker} 이력에서 일치 후보가 없습니다.` },
        },
        {
          type: 'actions',
          elements: [{
            type: 'button',
            style: 'danger',
            text: { type: 'plain_text', text: '미주문 확정' },
            action_id: 'broker_recovery_not_submitted',
            value: this.encode({
              v: 1,
              tradeRecordId: inspection.recoveryItem.tradeRecordId,
              broker: inspection.recoveryItem.broker,
              ...(origin ? { origin } : {}),
            }),
          }],
        },
      );
    } else {
      for (const candidate of inspection.candidates) {
        const payload: SlackRecoveryCandidatePayload = {
          v: 1,
          tradeRecordId: inspection.recoveryItem.tradeRecordId,
          broker: inspection.recoveryItem.broker,
          brokerOrderDate: candidate.orderDate,
          exchangeCode: candidate.exchangeCode,
          orderNo: candidate.orderNo,
          ...(origin ? { origin } : {}),
        };
        const collision = candidate.existingTradeRecordId;
        blocks.push(
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: [
                `*${candidate.orderDate} ${candidate.orderTime} | ${candidate.exchangeCode} #${candidate.orderNo}*`,
                `${candidate.side} ${candidate.orderQuantity}주 / 체결 ${candidate.filledQuantity}주`,
                `거절 상태: ${candidate.rejectionState}`,
                collision ? `기존 TradeRecord: \`${collision}\`` : null,
              ].filter(Boolean).join('\n'),
            },
          },
          {
            type: 'actions',
            elements: [{
              type: 'button',
              text: {
                type: 'plain_text',
                text: collision ? '기존 기록과 동일' : '이 주문 연결',
              },
              action_id: collision
                ? 'broker_recovery_match_existing'
                : 'broker_recovery_link_candidate',
              value: collision
                ? this.encode({
                    ...payload,
                    existingTradeRecordId: collision,
                  } as SlackRecoveryExistingMatchPayload)
                : this.encode(payload),
            }],
          },
        );
      }
    }

    await respond({
      blocks,
      text: `${inspection.recoveryItem.broker} 주문 후보 ${inspection.candidates.length}건`,
      response_type: 'ephemeral',
      replace_original: false,
    });
  }

  openContextAssignmentModal(
    triggerId: string,
    payload: SlackRecoveryTradePayload,
    preview: BrokerContextPreview,
  ): Promise<void> {
    return this.openConfirmationModal(
      triggerId,
      'broker_recovery_assign_context_confirm',
      '현재 계좌 컨텍스트 지정',
      '지정',
      payload,
      `브로커: ${payload.broker}\n환경: ${preview.environment}\n계좌: ${preview.maskedAccount}`,
      '표시된 환경과 마스킹 계좌를 이 기록에 지정합니다.',
    );
  }

  openLinkCandidateModal(
    triggerId: string,
    payload: SlackRecoveryCandidatePayload,
  ): Promise<void> {
    return this.openConfirmationModal(
      triggerId,
      'broker_recovery_link_candidate_confirm',
      `${payload.broker} 주문 연결`,
      '연결',
      payload,
      `${payload.brokerOrderDate} ${payload.exchangeCode} #${payload.orderNo}`,
      `표시된 ${payload.broker} 주문을 이 TradeRecord에 연결합니다.`,
    );
  }

  openNotSubmittedModal(
    triggerId: string,
    payload: SlackRecoveryTradePayload,
  ): Promise<void> {
    return this.openConfirmationModal(
      triggerId,
      'broker_recovery_not_submitted_confirm',
      '미주문 확정',
      '확정',
      payload,
      `TradeRecord: ${payload.tradeRecordId}`,
      `${payload.broker} 주문 이력을 직접 확인했으며 주문이 제출되지 않았음을 확정합니다.`,
    );
  }

  openMatchExistingModal(
    triggerId: string,
    payload: SlackRecoveryExistingMatchPayload,
  ): Promise<void> {
    return this.openConfirmationModal(
      triggerId,
      'broker_recovery_match_existing_confirm',
      '기존 기록과 동일 확정',
      '확정',
      payload,
      `${payload.brokerOrderDate} ${payload.exchangeCode} #${payload.orderNo}\n기존 TradeRecord: ${payload.existingTradeRecordId}`,
      `표시된 ${payload.broker} 주문이 기존 TradeRecord와 동일함을 확인했습니다.`,
    );
  }

  openCancellationInspectionModal(
    triggerId: string,
    payload: SlackRecoveryTradePayload,
  ): Promise<void> {
    return this.openConfirmationModal(
      triggerId,
      'broker_recovery_inspect_cancellation_confirm',
      '취소 상태 조회',
      '조회',
      payload,
      `TradeRecord: ${payload.tradeRecordId}`,
      `완전한 ${payload.broker} 조회 결과에 따라 주문과 취소 상태가 확정될 수 있습니다.`,
    );
  }

  openCancellationNotAcceptedModal(
    triggerId: string,
    payload: SlackRecoveryTradePayload,
  ): Promise<void> {
    return this.openConfirmationModal(
      triggerId,
      'broker_recovery_cancellation_not_accepted_confirm',
      '취소 미접수 확정',
      '확정',
      payload,
      `TradeRecord: ${payload.tradeRecordId}`,
      `${payload.broker}에서 원주문이 아직 미체결 상태임을 확인했습니다.`,
    );
  }

  async presentCancellationInspection(
    origin: SlackMessageOrigin | null,
    userId: string,
    item: BrokerOrderRecoveryItem,
  ): Promise<void> {
    if (item.cancellationStatus !== CancellationAttemptStatus.UNKNOWN) {
      await this.presentResolution(origin, userId, item, '취소 상태 확인 완료');
      return;
    }
    const app = this.availableApp();
    if (!app || !origin || !userId.trim()) return;
    try {
      await app.client.chat.postEphemeral({
        channel: origin.channel,
        user: userId,
        text: '원주문이 아직 열려 있습니다.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':information_source: 원주문이 아직 열려 있어 취소 결과를 불명 상태로 유지했습니다.',
            },
          },
          {
            type: 'actions',
            elements: [{
              type: 'button',
              style: 'danger',
              text: { type: 'plain_text', text: '취소 미접수 확정' },
              action_id: 'broker_recovery_cancellation_not_accepted',
              value: this.encode({
                v: 1,
                tradeRecordId: item.tradeRecordId,
                broker: item.broker,
                origin,
              }),
            }],
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `${this.brokerTag(item.broker, item.stockCode)} [RECOVERY ${item.tradeRecordId}] Slack cancellation result failed: ${this.errorMessage(error)}`,
      );
    }
  }

  async presentContextAssignment(
    origin: SlackMessageOrigin | null,
    userId: string,
    item: BrokerOrderRecoveryItem,
  ): Promise<void> {
    const app = this.availableApp();
    if (!app || !origin) return;

    if (userId.trim()) {
      try {
        await app.client.chat.postEphemeral({
          channel: origin.channel,
          user: userId,
          text: `:white_check_mark: 현재 계좌 컨텍스트를 지정했습니다. ${item.broker} 조회로 결과를 확인하세요.`,
        });
      } catch (error) {
        this.logger.warn(
          `${this.brokerTag(item.broker, item.stockCode)} [RECOVERY ${item.tradeRecordId}] Slack context response failed: ${this.errorMessage(error)}`,
        );
      }
    }

    const lifecycleLabel = item.lifecycle === 'CANCELLATION'
      ? '취소 결과 불명'
      : '주문 제출 결과 불명';
    const startedAt = item.lifecycle === 'CANCELLATION'
      ? item.cancellationStartedAt
      : item.submissionStartedAt;
    try {
      await app.client.chat.update({
        channel: origin.channel,
        ts: origin.messageTs,
        text: `${lifecycleLabel} | ${this.brokerTag(item.broker, item.stockCode)}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:warning: *${lifecycleLabel} | ${this.brokerTag(item.broker, item.stockCode)}* (${item.stockName}, ${item.exchangeCode})`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: [
                `*구분:* ${item.side}`,
                `*시장:* ${item.market}`,
                `*수량:* ${item.quantity}주`,
                `*의도 가격:* ${item.price}`,
                `*시작 시각:* ${this.formatDate(startedAt)}`,
                `*TradeRecord ID:* \`${item.tradeRecordId}\``,
              ].join('\n'),
            },
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `:information_source: 계좌 컨텍스트 지정 완료 · ${item.broker} 조회 전 주문이나 취소를 다시 제출하지 마세요.`,
            }],
          },
          {
            type: 'actions',
            elements: [this.recoveryAction(
              item.lifecycle,
              true,
              { v: 1, tradeRecordId: item.tradeRecordId, broker: item.broker, origin },
            )],
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `${this.brokerTag(item.broker, item.stockCode)} [RECOVERY ${item.tradeRecordId}] Context-assigned Slack alert update failed: ${this.errorMessage(error)}`,
      );
    }
  }

  async presentResolution(
    origin: SlackMessageOrigin | null,
    userId: string,
    item: BrokerOrderRecoveryItem,
    label: string,
  ): Promise<void> {
    const app = this.availableApp();
    if (!app || !origin) return;
    if (userId.trim()) {
      try {
        await app.client.chat.postEphemeral({
          channel: origin.channel,
          user: userId,
          text: `:white_check_mark: ${this.brokerTag(item.broker, item.stockCode)} ${label} (${item.tradeRecordId})`,
        });
      } catch (error) {
        this.logger.warn(
          `${this.brokerTag(item.broker, item.stockCode)} [RECOVERY ${item.tradeRecordId}] Slack resolution response failed: ${this.errorMessage(error)}`,
        );
      }
    }
    try {
      await app.client.chat.update({
        channel: origin.channel,
        ts: origin.messageTs,
        text: `${label} | ${item.tradeRecordId}`,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:white_check_mark: *${label} | ${this.brokerTag(item.broker, item.stockCode)}*\nTradeRecord: \`${item.tradeRecordId}\`\n상태: ${item.status}${item.cancellationStatus ? ` / 취소 ${item.cancellationStatus}` : ''}`,
          },
        }],
      });
    } catch (error) {
      this.logger.warn(
        `${this.brokerTag(item.broker, item.stockCode)} [RECOVERY ${item.tradeRecordId}] Original Slack message update failed: ${this.errorMessage(error)}`,
      );
    }
  }

  async respondUnauthorized(respond: any): Promise<void> {
    await respond({
      text: ':no_entry: 주문 복구 작업을 수행할 권한이 없습니다.',
      response_type: 'ephemeral',
      replace_original: false,
    });
  }

  async respondFailure(
    respond: any,
    kind: SlackRecoveryFailureKind,
  ): Promise<void> {
    await respond({
      text: `:x: 복구 작업 실패: ${SAFE_RECOVERY_FAILURE_MESSAGES[kind]}`,
      response_type: 'ephemeral',
      replace_original: false,
    });
  }

  async presentFailure(
    origin: SlackMessageOrigin | null,
    userId: string,
    kind: SlackRecoveryFailureKind,
  ): Promise<void> {
    const app = this.availableApp();
    if (!app || !origin || !userId.trim()) return;
    try {
      await app.client.chat.postEphemeral({
        channel: origin.channel,
        user: userId,
        text: `:x: 복구 작업 실패: ${SAFE_RECOVERY_FAILURE_MESSAGES[kind]}`,
      });
    } catch (error) {
      this.logger.warn(`Slack recovery failure response failed: ${this.errorMessage(error)}`);
    }
  }

  private async openConfirmationModal(
    triggerId: string,
    callbackId: string,
    title: string,
    submitText: string,
    payload: SlackRecoveryTradePayload,
    detail: string,
    acknowledgement: string,
  ): Promise<void> {
    const app = this.availableApp();
    const normalizedTrigger = triggerId?.trim();
    if (!app || !normalizedTrigger) {
      throw new Error('Slack confirmation modal is unavailable');
    }
    try {
      await app.client.views.open({
        trigger_id: normalizedTrigger,
        view: {
          type: 'modal',
          callback_id: callbackId,
          private_metadata: this.encode(payload),
          title: { type: 'plain_text', text: title.slice(0, 24) },
          submit: { type: 'plain_text', text: submitText },
          close: { type: 'plain_text', text: '취소' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: detail },
            },
            {
              type: 'input',
              block_id: 'confirmation',
              label: { type: 'plain_text', text: '필수 확인' },
              element: {
                type: 'checkboxes',
                action_id: 'acknowledged',
                options: [{
                  text: { type: 'plain_text', text: acknowledgement.slice(0, 150) },
                  value: 'confirmed',
                }],
              },
            },
          ],
        },
      });
    } catch (error) {
      this.logger.warn(`Slack recovery modal failed: ${this.errorMessage(error)}`);
      throw error;
    }
  }

  private recoveryAction(
    lifecycle: BrokerOrderRecoveryItem['lifecycle'],
    brokerContextAssigned: boolean,
    payload: SlackRecoveryTradePayload,
  ): Button {
    if (!brokerContextAssigned) {
      return {
        type: 'button',
        text: { type: 'plain_text', text: '현재 계좌 컨텍스트 지정' },
        action_id: 'broker_recovery_assign_context',
        value: this.encode(payload),
      };
    }
    const cancellation = lifecycle === 'CANCELLATION';
    return {
      type: 'button',
      text: { type: 'plain_text', text: cancellation ? '취소 상태 조회' : `${payload.broker} 주문 조회` },
      action_id: cancellation
        ? 'broker_recovery_inspect_cancellation'
        : 'broker_recovery_inspect_submission',
      value: this.encode(payload),
    };
  }

  private availableApp(): App | null {
    return this.slackService.getConfiguredApp();
  }

  private configuredChannel(): string {
    const channel = this.configService.get<unknown>('slack.channel');
    return typeof channel === 'string' ? channel.trim() : '';
  }

  private encode(payload: SlackRecoveryTradePayload): string {
    return JSON.stringify(payload);
  }

  private formatDate(value: Date | null): string {
    return value instanceof Date && !Number.isNaN(value.getTime())
      ? value.toISOString()
      : 'N/A';
  }

  private brokerTag(broker: Broker, stockCode: string): string {
    return `[${broker} ${stockCode}]`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
