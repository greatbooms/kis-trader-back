import { Injectable, Logger, Optional } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { SellApprovalMessageStatus } from '../notification/types/sell-approval-message-status.type';
import { PrismaService } from '../prisma.service';
import { SellApprovalWorkflowResult } from './types/sell-approval-workflow-result.type';

@Injectable()
export class TradingSellApprovalNotificationService {
  private readonly logger = new Logger(TradingSellApprovalNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly slackService?: SlackService,
  ) {}

  async updateApprovedOutcome(
    approvalId: string,
    result: SellApprovalWorkflowResult,
  ): Promise<void> {
    await this.updatePersistedMessage(approvalId, this.approvedStatus(result));
  }

  async updateDecision(
    approvalId: string,
    status: 'REJECTED' | 'EXPIRED',
  ): Promise<void> {
    await this.updatePersistedMessage(approvalId, status);
  }

  private approvedStatus(result: SellApprovalWorkflowResult): SellApprovalMessageStatus {
    if (!result.submitted) {
      return result.tradeStatus === OrderStatus.CANCELLED
        ? 'APPROVED_NOT_SUBMITTED'
        : 'APPROVED_UNKNOWN';
    }
    if (result.reason === 'BROKER_REJECTED') return 'APPROVED_REJECTED';
    if (
      result.tradeStatus === OrderStatus.PENDING
      || result.reason === 'ACCEPTED_PERSISTENCE_PENDING'
    ) {
      return 'APPROVED_ACCEPTED';
    }
    return 'APPROVED_UNKNOWN';
  }

  private async updatePersistedMessage(
    approvalId: string,
    status: SellApprovalMessageStatus,
  ): Promise<void> {
    try {
      const approval = await this.prisma.stopLossApproval.findUnique({
        where: { id: approvalId },
      });
      if (!approval) return;
      await this.updateSlackMessage(
        approval.slackChannel,
        approval.slackMessageTs,
        approval.stockCode,
        status,
      );
    } catch (error) {
      this.logger.warn(
        `[APPROVAL ${approvalId}] Slack outcome lookup failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private async updateSlackMessage(
    channel: string | null,
    ts: string | null,
    stockCode: string,
    status: SellApprovalMessageStatus,
  ): Promise<void> {
    if (!this.slackService || !channel?.trim() || !ts?.trim()) return;
    try {
      await this.slackService.updateStopLossApprovalMessage(channel, ts, stockCode, status);
    } catch (error) {
      this.logger.warn(
        `[${stockCode}] Slack approval update failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
