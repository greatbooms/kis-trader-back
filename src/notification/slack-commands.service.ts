import { Injectable, Inject, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TradeRecordService } from '../trade-record/trade-record.service';
import { TradingService } from '../trading/trading.service';
import { SlackService } from './slack.service';
import { PositionInfo, DailySummaryContext } from './types/notification.types';
import { Market, ApprovalStatus, OrderStatus } from '@prisma/client';

@Injectable()
export class SlackCommandsService implements OnModuleInit {
  private readonly logger = new Logger(SlackCommandsService.name);

  constructor(
    private prisma: PrismaService,
    private tradeRecordService: TradeRecordService,
    @Inject(forwardRef(() => TradingService)) private tradingService: TradingService,
    private slackService: SlackService,
  ) {}

  onModuleInit() {
    const app = this.slackService.getApp();
    if (!app) return;

    this.registerCommands(app);
    this.logger.log('Slack commands registered');
  }

  private registerCommands(app: any) {
    // /잔고 — 전체 포지션 조회
    app.command('/잔고', async ({ ack, respond }) => {
      await ack();
      try {
        const positions = await this.getPositions();
        const blocks = this.slackService.formatPositionList(positions);
        await respond({ blocks, response_type: 'ephemeral' });
      } catch (e) {
        this.logger.error(`/잔고 command error: ${e.message}`);
        await respond({ text: `:x: 잔고 조회 실패: ${e.message}` });
      }
    });

    // /요약 — 오늘 매매 요약 + 포트폴리오
    app.command('/요약', async ({ ack, respond }) => {
      await ack();
      try {
        const summary = await this.buildDailySummary();
        const blocks = this.slackService.formatDailySummary(summary);
        await respond({ blocks, response_type: 'ephemeral' });
      } catch (e) {
        this.logger.error(`/요약 command error: ${e.message}`);
        await respond({ text: `:x: 요약 조회 실패: ${e.message}` });
      }
    });

    // /종목 [코드] — 특정 종목 상세
    app.command('/종목', async ({ ack, respond, command }) => {
      await ack();
      try {
        const stockCode = command.text?.trim().toUpperCase();
        if (!stockCode) {
          await respond({ text: '사용법: `/종목 SOXL` — 종목코드를 입력해주세요.' });
          return;
        }

        const result = await this.getStockDetail(stockCode);
        if (!result) {
          await respond({ text: `:mag: *${stockCode}* — 보유 포지션이 없습니다.` });
          return;
        }

        const blocks = this.slackService.formatStockDetail(result.position, result.watchStock);
        await respond({ blocks, response_type: 'ephemeral' });
      } catch (e) {
        this.logger.error(`/종목 command error: ${e.message}`);
        await respond({ text: `:x: 종목 조회 실패: ${e.message}` });
      }
    });

    // 손절 승인 버튼
    app.action('stop_loss_approve', async ({ ack, body, respond }) => {
      await ack();
      try {
        const approvalId = (body as any).actions?.[0]?.value;
        if (!approvalId) return;

        const approval = await this.prisma.stopLossApproval.findUnique({ where: { id: approvalId } }).catch(() => null);
        if (!approval) {
          await respond({ text: ':warning: 존재하지 않는 요청입니다.', replace_original: false });
          return;
        }
        if (approval.status !== ApprovalStatus.PENDING) {
          if (approval.status === ApprovalStatus.EXPIRED) {
            await respond({ text: ':hourglass: 만료된 요청입니다. 사이트에서 현재 상태를 확인해주세요.', replace_original: false });
          } else {
            const statusLabel = approval.status === ApprovalStatus.APPROVED ? '승인' : '거절';
            await respond({ text: `:information_source: 이미 처리된 요청입니다. (${statusLabel})`, replace_original: false });
          }
          return;
        }

        await this.prisma.stopLossApproval.update({
          where: { id: approvalId },
          data: { status: ApprovalStatus.APPROVED, respondedAt: new Date() },
        });

        // 메시지 업데이트 (버튼 제거)
        if (approval.slackMessageTs && approval.slackChannel) {
          await this.slackService.updateStopLossApprovalMessage(
            approval.slackChannel, approval.slackMessageTs, approval.stockCode, 'APPROVED',
          );
        }

        // 주문 실행
        await this.tradingService.executeApprovedStopLoss(approvalId);
        this.logger.log(`Stop-loss approved: ${approval.stockCode} (${approvalId})`);
      } catch (e) {
        this.logger.error(`Stop-loss approve error: ${e.message}`);
        await respond({ text: `:x: 승인 처리 실패: ${e.message}`, replace_original: false });
      }
    });

    // 손절 거절 버튼
    app.action('stop_loss_reject', async ({ ack, body, respond }) => {
      await ack();
      try {
        const approvalId = (body as any).actions?.[0]?.value;
        if (!approvalId) return;

        const approval = await this.prisma.stopLossApproval.findUnique({ where: { id: approvalId } }).catch(() => null);
        if (!approval) {
          await respond({ text: ':warning: 존재하지 않는 요청입니다.', replace_original: false });
          return;
        }
        if (approval.status !== ApprovalStatus.PENDING) {
          if (approval.status === ApprovalStatus.EXPIRED) {
            await respond({ text: ':hourglass: 만료된 요청입니다. 사이트에서 현재 상태를 확인해주세요.', replace_original: false });
          } else {
            const statusLabel = approval.status === ApprovalStatus.APPROVED ? '승인' : '거절';
            await respond({ text: `:information_source: 이미 처리된 요청입니다. (${statusLabel})`, replace_original: false });
          }
          return;
        }

        await this.prisma.stopLossApproval.update({
          where: { id: approvalId },
          data: { status: ApprovalStatus.REJECTED, respondedAt: new Date() },
        });
        await this.prisma.tradeRecord.update({
          where: { id: approval.tradeRecordId },
          data: { status: OrderStatus.CANCELLED, reason: 'Stop-loss rejected by user' },
        });

        if (approval.slackMessageTs && approval.slackChannel) {
          await this.slackService.updateStopLossApprovalMessage(
            approval.slackChannel, approval.slackMessageTs, approval.stockCode, 'REJECTED',
          );
        }

        this.logger.log(`Stop-loss rejected: ${approval.stockCode} (${approvalId})`);
      } catch (e) {
        this.logger.error(`Stop-loss reject error: ${e.message}`);
        await respond({ text: `:x: 거절 처리 실패: ${e.message}`, replace_original: false });
      }
    });

    // @봇 멘션 — 키워드 매칭
    app.event('app_mention', async ({ event, say }) => {
      try {
        const text = event.text?.toLowerCase() || '';

        if (text.includes('잔고') || text.includes('포지션')) {
          const positions = await this.getPositions();
          const blocks = this.slackService.formatPositionList(positions);
          await say({ blocks, text: '보유 포지션' });
        } else if (text.includes('요약')) {
          const summary = await this.buildDailySummary();
          const blocks = this.slackService.formatDailySummary(summary);
          await say({ blocks, text: '일일 요약' });
        } else {
          // 종목코드 추출 시도 (영문 대문자 3~5자 or 숫자 6자)
          const codeMatch = event.text?.match(/[A-Z]{3,5}|\d{6}/);
          if (codeMatch) {
            const stockCode = codeMatch[0];
            const result = await this.getStockDetail(stockCode);
            if (result) {
              const blocks = this.slackService.formatStockDetail(result.position, result.watchStock);
              await say({ blocks, text: `${stockCode} 상세` });
              return;
            }
          }

          await say({
            text: [
              ':robot_face: 다음 명령어를 사용할 수 있습니다:',
              '- `잔고` / `포지션` — 전체 보유 현황',
              '- `요약` — 오늘 매매 요약',
              '- `종목코드` (예: SOXL) — 종목 상세 조회',
            ].join('\n'),
          });
        }
      } catch (e) {
        this.logger.error(`app_mention error: ${e.message}`);
        await say({ text: `:x: 처리 중 오류: ${e.message}` });
      }
    });
  }

  // --- Data helpers ---

  private async getPositions(): Promise<PositionInfo[]> {
    const positions = await this.prisma.position.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return positions.map((p) => ({
      stockCode: p.stockCode,
      stockName: p.stockName,
      exchangeCode: p.exchangeCode || undefined,
      market: p.market,
      quantity: p.quantity,
      avgPrice: Number(p.avgPrice),
      currentPrice: Number(p.currentPrice),
      profitLoss: Number(p.profitLoss),
      profitRate: Number(p.profitRate),
      totalInvested: Number(p.totalInvested),
    }));
  }

  private async getStockDetail(stockCode: string) {
    const position = await this.prisma.position.findFirst({
      where: { stockCode },
    });

    if (!position) return null;

    const watchStock = await this.prisma.watchStock.findFirst({
      where: { stockCode, isActive: true },
    });

    return {
      position: {
        stockCode: position.stockCode,
        stockName: position.stockName,
        exchangeCode: position.exchangeCode || undefined,
        market: position.market,
        quantity: position.quantity,
        avgPrice: Number(position.avgPrice),
        currentPrice: Number(position.currentPrice),
        profitLoss: Number(position.profitLoss),
        profitRate: Number(position.profitRate),
        totalInvested: Number(position.totalInvested),
      } as PositionInfo,
      watchStock: watchStock
        ? {
            quota: watchStock.quota ? Number(watchStock.quota) : undefined,
            cycle: watchStock.cycle,
            maxCycles: watchStock.maxCycles,
            stopLossRate: Number(watchStock.stopLossRate),
          }
        : undefined,
    };
  }

  async buildDailySummary(): Promise<DailySummaryContext> {
    const positions = await this.getPositions();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTrades = await this.prisma.tradeRecord.findMany({
      where: {
        createdAt: { gte: today },
        status: 'FILLED',
      },
    });

    const todayBuyCount = todayTrades.filter((t) => t.side === 'BUY').length;
    const todaySellCount = todayTrades.filter((t) => t.side === 'SELL').length;

    const totalInvested = positions.reduce((sum, p) => sum + p.totalInvested, 0);
    const totalEvaluation = positions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    const totalPnl = totalEvaluation - totalInvested;
    const totalPnlRate = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    return {
      positions,
      todayBuyCount,
      todaySellCount,
      skipCount: 0,
      skipReasons: [],
      totalInvested,
      totalEvaluation,
      totalPnl,
      totalPnlRate,
    };
  }
}
