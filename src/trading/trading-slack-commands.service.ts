import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TradingSellApprovalWorkflowService } from './trading-sell-approval-workflow.service';
import { MarketAnalysisService } from './market-analysis.service';
import { SlackService } from '../notification/slack.service';
import {
  PositionInfo,
  DailySummaryContext,
  DailySummaryBuildOptions,
  DailySummaryMarketConditionSummary,
  DailySummaryMarketSummary,
} from '../notification/types/notification.types';
import { ApprovalStatus, Market } from '@prisma/client';
import { SellApprovalWorkflowResult } from './types/sell-approval-workflow-result.type';

const SUMMARY_COUNTRY_GROUPS = [
  { code: 'KR', label: '국내', market: Market.DOMESTIC, exchanges: ['KRX'], regimeExchangeCode: 'KRX' },
  { code: 'US', label: '미국', market: Market.OVERSEAS, exchanges: ['NASD', 'NYSE', 'AMEX'], regimeExchangeCode: 'NASD' },
  { code: 'HK', label: '홍콩', market: Market.OVERSEAS, exchanges: ['SEHK'], regimeExchangeCode: 'SEHK' },
  { code: 'CN', label: '중국', market: Market.OVERSEAS, exchanges: ['SHAA', 'SZAA'], regimeExchangeCode: 'SHAA' },
  { code: 'JP', label: '일본', market: Market.OVERSEAS, exchanges: ['TKSE'], regimeExchangeCode: 'TKSE' },
  { code: 'VN', label: '베트남', market: Market.OVERSEAS, exchanges: ['HASE', 'VNSE'], regimeExchangeCode: 'HASE' },
] as const;

const EXCHANGE_TO_COUNTRY = SUMMARY_COUNTRY_GROUPS.reduce<Record<string, (typeof SUMMARY_COUNTRY_GROUPS)[number]>>((acc, group) => {
  for (const exchange of group.exchanges) {
    acc[exchange] = group;
  }
  return acc;
}, {});

@Injectable()
export class TradingSlackCommandsService implements OnModuleInit {
  private readonly logger = new Logger(TradingSlackCommandsService.name);

  constructor(
    private prisma: PrismaService,
    private approvalWorkflow: TradingSellApprovalWorkflowService,
    private marketAnalysisService: MarketAnalysisService,
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

    // 매도 승인 버튼
    app.action('stop_loss_approve', async ({ ack, body, respond }) => {
      await ack();
      const approvalId = (body as any).actions?.[0]?.value;
      if (!approvalId) return;
      const slackUserId = (body as any).user?.id;
      let result: SellApprovalWorkflowResult;
      try {
        result = await this.approvalWorkflow.approve(approvalId, slackUserId);
      } catch (e) {
        this.logger.error(`Sell approve error: ${e.message}`);
        try {
          await respond({ text: `:x: 승인 처리 실패: ${e.message}`, replace_original: false });
        } catch (respondError) {
          this.logger.warn(
            `[APPROVAL ${approvalId}] Slack failure response failed: ${respondError.message}`,
          );
        }
        return;
      }
      try {
        await this.presentApprovalWorkflowResult(result, respond);
      } catch (e) {
        this.logger.warn(`[APPROVAL ${approvalId}] Slack presentation failed: ${e.message}`);
      }
      if (result.claimed) {
        this.logger.log(`[APPROVAL ${approvalId}] Sell approval workflow completed`);
      }
    });

    // 매도 거절 버튼
    app.action('stop_loss_reject', async ({ ack, body, respond }) => {
      await ack();
      const approvalId = (body as any).actions?.[0]?.value;
      if (!approvalId) return;
      const slackUserId = (body as any).user?.id;
      let result: SellApprovalWorkflowResult;
      try {
        result = await this.approvalWorkflow.reject(approvalId, slackUserId);
      } catch (e) {
        this.logger.error(`Sell reject error: ${e.message}`);
        try {
          await respond({ text: `:x: 거절 처리 실패: ${e.message}`, replace_original: false });
        } catch (respondError) {
          this.logger.warn(
            `[APPROVAL ${approvalId}] Slack failure response failed: ${respondError.message}`,
          );
        }
        return;
      }
      try {
        await this.presentApprovalWorkflowResult(result, respond);
      } catch (e) {
        this.logger.warn(`[APPROVAL ${approvalId}] Slack presentation failed: ${e.message}`);
      }
      if (result.claimed) {
        this.logger.log(`[APPROVAL ${approvalId}] Sell rejection workflow completed`);
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

  private async presentApprovalWorkflowResult(
    result: SellApprovalWorkflowResult,
    respond: any,
  ): Promise<void> {
    if (result.reason === 'UNAUTHORIZED') {
      await respond({
        text: ':no_entry: 이 매도 요청을 처리할 권한이 없습니다.',
        replace_original: false,
      });
      return;
    }
    if (result.reason === 'ALREADY_HANDLED') {
      const statusLabel = result.approvalStatus === ApprovalStatus.APPROVED
        ? '승인'
        : result.approvalStatus === ApprovalStatus.REJECTED
          ? '거절'
          : '처리 완료';
      await respond({
        text: `:information_source: 이미 처리된 요청입니다. (${statusLabel})`,
        replace_original: false,
      });
      return;
    }
    if (result.reason === 'EXPIRED') {
      await respond({
        text: ':hourglass: 만료된 요청입니다. 사이트에서 현재 상태를 확인해주세요.',
        replace_original: false,
      });
      return;
    }

    let text: string | undefined;
    switch (result.reason) {
      case 'NOT_FOUND':
        text = ':warning: 존재하지 않는 요청입니다.';
        break;
      case 'DELIVERY_NOT_READY':
        text = ':hourglass: Slack 전달이 완료되지 않은 요청입니다. 사이트에서 현재 상태를 확인해주세요.';
        break;
      case 'TRADING_DISABLED':
        text = ':no_entry: 실전 거래가 비활성 상태여서 주문을 제출하지 않았습니다.';
        break;
      case 'BROKER_CONTEXT_MISMATCH':
        text = ':no_entry: 승인 요청의 브로커 계좌가 현재 계좌와 일치하지 않아 주문을 제출하지 않았습니다.';
        break;
      case 'REFRESH_FAILED':
        text = ':x: 포지션 새로고침 실패로 주문을 제출하지 않았습니다.';
        break;
      case 'NO_HOLDING':
        text = ':information_source: 현재 보유 수량이 없어 주문을 제출하지 않았습니다.';
        break;
      case 'SUBMISSION_CLAIM_LOST':
      case 'STATE_CHANGED':
        text = ':information_source: 주문 상태가 이미 변경되어 추가 제출하지 않았습니다.';
        break;
      case 'BROKER_REJECTED':
        text = ':x: 브로커가 주문을 거절했습니다.';
        break;
      case 'BROKER_UNKNOWN':
        text = ':warning: 브로커 주문 결과를 확인해야 합니다. 추가 주문은 제출하지 마세요.';
        break;
      case 'ACCEPTED_PERSISTENCE_PENDING':
        text = ':warning: 브로커 주문은 접수됐지만 DB 저장 확인이 필요합니다.';
        break;
    }
    if (text) {
      await respond({ text, replace_original: false });
    }
  }

  // --- Data helpers ---

  private async getPositions(options: DailySummaryBuildOptions = {}): Promise<PositionInfo[]> {
    const positions = await this.prisma.position.findMany({
      where: this.buildMarketWhere(options),
      orderBy: { updatedAt: 'desc' },
    });

    return positions.map((p) => ({
      broker: p.broker,
      stockCode: p.stockCode,
      stockName: p.stockName,
      exchangeCode: p.exchangeCode,
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
    const positions = await this.prisma.position.findMany({
      where: { stockCode },
      take: 2,
    });

    if (positions.length === 0) return null;
    if (positions.length > 1) {
      throw new Error('동일 종목이 여러 브로커에 있어 종목코드만으로 식별할 수 없습니다.');
    }
    const position = positions[0];

    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        broker_market_exchangeCode_stockCode: {
          broker: position.broker,
          market: position.market,
          exchangeCode: position.exchangeCode,
          stockCode: position.stockCode,
        },
      },
    });

    return {
      position: {
        broker: position.broker,
        stockCode: position.stockCode,
        stockName: position.stockName,
        exchangeCode: position.exchangeCode,
        market: position.market,
        quantity: position.quantity,
        avgPrice: Number(position.avgPrice),
        currentPrice: Number(position.currentPrice),
        profitLoss: Number(position.profitLoss),
        profitRate: Number(position.profitRate),
        totalInvested: Number(position.totalInvested),
      } as PositionInfo,
      watchStock: watchStock?.isActive
        ? {
            quota: watchStock.quota ? Number(watchStock.quota) : undefined,
            cycle: watchStock.cycle,
            maxCycles: watchStock.maxCycles,
            stopLossRate: Number(watchStock.stopLossRate),
          }
        : undefined,
    };
  }

  async buildDailySummary(options: DailySummaryBuildOptions = {}): Promise<DailySummaryContext> {
    const positions = await this.getPositions(options);
    const kstDate = this.getKstDateString();
    const todayStart = options.tradeStart ?? new Date(`${kstDate}T00:00:00+09:00`);
    const todayEnd = options.tradeEnd ?? new Date(`${kstDate}T23:59:59.999+09:00`);

    const todayTrades = await this.prisma.tradeRecord.findMany({
      where: {
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: 'FILLED',
        ...this.buildMarketWhere(options),
      },
      select: {
        side: true,
        market: true,
        exchangeCode: true,
      },
    });

    const todayBuyCount = todayTrades.filter((t) => t.side === 'BUY').length;
    const todaySellCount = todayTrades.filter((t) => t.side === 'SELL').length;

    const totalInvested = positions.reduce((sum, p) => sum + p.totalInvested, 0);
    const totalEvaluation = positions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
    const totalPnl = totalEvaluation - totalInvested;
    const totalPnlRate = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    const marketSummaries = this.buildMarketSummaries(positions);
    const marketConditions = await this.buildMarketConditions(positions);

    return {
      summaryTitle: options.summaryTitle,
      positions,
      todayBuyCount,
      todaySellCount,
      skipCount: 0,
      skipReasons: [],
      totalInvested,
      totalEvaluation,
      totalPnl,
      totalPnlRate,
      marketSummaries,
      marketConditions,
      marketCondition: marketConditions.length === 1 ? marketConditions[0].condition : undefined,
    };
  }

  private buildMarketWhere(options: DailySummaryBuildOptions): Record<string, any> | undefined {
    const where: Record<string, any> = {};

    if (options.market) {
      where.market = options.market as Market;
    }

    if (options.exchangeCodes && options.exchangeCodes.length > 0) {
      where.exchangeCode = { in: options.exchangeCodes };
    }

    return Object.keys(where).length > 0 ? where : undefined;
  }

  private buildMarketSummaries(positions: PositionInfo[]): DailySummaryMarketSummary[] {
    const groups = new Map<string, { label: string; market: Market; exchangeCode: string; positions: PositionInfo[] }>();

    for (const position of positions) {
      const groupMeta = EXCHANGE_TO_COUNTRY[position.exchangeCode]
        ?? (position.market === 'DOMESTIC'
          ? SUMMARY_COUNTRY_GROUPS[0]
          : undefined);
      if (!groupMeta) continue;

      if (!groups.has(groupMeta.code)) {
        groups.set(groupMeta.code, {
          label: groupMeta.label,
          market: groupMeta.market,
          exchangeCode: groupMeta.regimeExchangeCode,
          positions: [],
        });
      }

      groups.get(groupMeta.code)!.positions.push(position);
    }

    return SUMMARY_COUNTRY_GROUPS
      .filter((group) => groups.has(group.code))
      .map((group) => {
        const summary = groups.get(group.code)!;
        const marketPositions = summary.positions;
        const totalInvested = marketPositions.reduce((sum, p) => sum + p.totalInvested, 0);
        const totalEvaluation = marketPositions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
        const totalPnl = totalEvaluation - totalInvested;
        const totalPnlRate = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

        return {
          market: summary.market,
          exchangeCode: summary.exchangeCode,
          label: summary.label,
          positions: marketPositions,
          totalInvested,
          totalEvaluation,
          totalPnl,
          totalPnlRate,
        };
      });
  }

  private async buildMarketConditions(
    positions: PositionInfo[],
  ): Promise<DailySummaryMarketConditionSummary[]> {
    const summaries = this.buildMarketSummaries(positions);
    const conditions = await Promise.all(
      summaries.map(async (summary) => ({
        market: summary.market,
        exchangeCode: summary.exchangeCode,
        label: summary.label,
        condition: await this.marketAnalysisService.getMarketCondition(summary.exchangeCode),
      })),
    );

    return conditions;
  }

  private getKstDateString(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}
