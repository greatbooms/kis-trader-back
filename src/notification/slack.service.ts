import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';
import { KnownBlock } from '@slack/types';
import {
  PositionInfo,
  TradeAlertContext,
  DailySummaryContext,
  FilterLogContext,
  RiskAlertContext,
  StopLossApprovalRequest,
} from './types/notification.types';

@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app: App | null = null;
  private connected = false;
  private reconnecting = false;
  private destroyed = false;
  private readonly enabled: boolean;
  private readonly channel: string;
  private readonly botToken: string;
  private readonly appToken: string;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly BASE_DELAY_MS = 3_000;

  constructor(private configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('slack.enabled')!;
    this.channel = this.configService.get<string>('slack.channel')!;
    this.botToken = this.configService.get<string>('slack.botToken') ?? '';
    this.appToken = this.configService.get<string>('slack.appToken') ?? '';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Slack notifications disabled');
      return;
    }

    if (!this.botToken || !this.appToken) {
      this.logger.warn('Slack tokens not configured, disabling notifications');
      return;
    }

    await this.connect();
  }

  private async connect(): Promise<boolean> {
    try {
      // 기존 앱이 있으면 정리
      if (this.app) {
        try { await this.app.stop(); } catch { /* ignore */ }
        this.app = null;
      }

      this.app = new App({
        token: this.botToken,
        appToken: this.appToken,
        socketMode: true,
        logLevel: LogLevel.WARN,
      });

      // WebSocket 에러가 프로세스를 죽이지 않도록
      this.app.error(async (error) => {
        this.logger.error(`Slack app error: ${error.message}`);
        this.connected = false;
        this.scheduleReconnect();
      });

      await this.app.start();
      this.connected = true;
      this.logger.log('Slack Socket Mode connected');
      return true;
    } catch (e) {
      this.logger.error(`Slack Socket Mode failed to connect: ${e.message}`);
      this.app = null;
      this.connected = false;
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || this.destroyed) return;
    this.reconnecting = true;

    // 별도 async 흐름으로 재접속 시도 (에러 전파 방지)
    void this.reconnectLoop();
  }

  private async reconnectLoop(): Promise<void> {
    for (let attempt = 1; attempt <= SlackService.MAX_RECONNECT_ATTEMPTS; attempt++) {
      if (this.destroyed) break;

      const delay = SlackService.BASE_DELAY_MS * Math.pow(2, attempt - 1); // 3s, 6s, 12s, 24s, 48s
      this.logger.warn(`Slack reconnect attempt ${attempt}/${SlackService.MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));

      if (this.destroyed) break;

      const success = await this.connect();
      if (success) {
        this.logger.log(`Slack reconnected after ${attempt} attempt(s)`);
        this.reconnecting = false;
        return;
      }
    }

    this.reconnecting = false;
    this.logger.error(
      `Slack reconnect failed after ${SlackService.MAX_RECONNECT_ATTEMPTS} attempts. ` +
      `Messages will be dropped until next successful reconnect.`,
    );
  }

  async onModuleDestroy() {
    this.destroyed = true;
    if (this.app) {
      try {
        await this.app.stop();
      } catch { /* ignore */ }
      this.logger.log('Slack disconnected');
    }
  }

  getApp(): App | null {
    return this.app;
  }

  isEnabled(): boolean {
    return this.enabled && this.connected && this.app !== null;
  }

  /** 메시지 전송 시 연결 끊겨있으면 재접속 시도 후 전송 */
  private async ensureConnected(): Promise<boolean> {
    if (this.connected && this.app) return true;
    if (!this.enabled || !this.botToken || !this.appToken) return false;

    // 이미 재접속 중이면 대기하지 않고 false
    if (this.reconnecting) return false;

    this.logger.warn('Slack disconnected, attempting immediate reconnect');
    return this.connect();
  }

  // --- Alert methods ---

  async sendTradeAlert(ctx: TradeAlertContext): Promise<void> {
    if (!await this.ensureConnected()) return;

    try {
      const blocks = this.formatTradeAlert(ctx);
      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `${ctx.signal.side === 'BUY' ? '매수' : '매도'} 체결 | ${ctx.signal.stockCode}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send trade alert: ${e.message}`);
      this.handleSendError(e);
    }
  }

  async sendDailySummary(ctx: DailySummaryContext): Promise<void> {
    if (!await this.ensureConnected()) return;

    try {
      const blocks = this.formatDailySummary(ctx);
      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `일일 매매 요약 | ${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send daily summary: ${e.message}`);
      this.handleSendError(e);
    }
  }

  async sendFilterLog(ctx: FilterLogContext): Promise<void> {
    if (!await this.ensureConnected()) return;

    try {
      const blocks = this.formatFilterLog(ctx);
      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `전략 스킵 | ${ctx.stockCode}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send filter log: ${e.message}`);
      this.handleSendError(e);
    }
  }

  /** 전송 실패 시 연결 문제면 재접속 스케줄링 */
  private handleSendError(e: any): void {
    const msg = e.message?.toLowerCase() ?? '';
    if (msg.includes('disconnect') || msg.includes('socket') || msg.includes('websocket') || msg.includes('not connected')) {
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  async sendRiskAlert(ctx: RiskAlertContext): Promise<void> {
    if (!await this.ensureConnected()) return;

    try {
      const blocks = this.formatRiskAlert(ctx);
      const marketLabel = ctx.market === 'DOMESTIC' ? '국내' : '해외';
      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `🚨 리스크 경고 | ${marketLabel} | ${ctx.reasons.join(', ')}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send risk alert: ${e.message}`);
      this.handleSendError(e);
    }
  }

  async sendScreeningResult(market: string, date: string, scores: { stockCode: string; stockName: string; exchangeCode: string; totalScore: number; technicalScore: number; fundamentalScore: number; momentumScore: number; reasons: string[]; currentPrice: number; changeRate: number }[]): Promise<void> {
    if (!await this.ensureConnected()) return;

    try {
      const top = scores.slice(0, 10);
      const marketLabel = market === 'DOMESTIC' ? '국내' : top[0]?.exchangeCode || '해외';
      const lines = top.map((s, i) =>
        `${i + 1}. *${s.stockName}* (${s.stockCode}) — ${s.totalScore.toFixed(1)}점\n` +
        `    기술 ${s.technicalScore.toFixed(0)} | 펀더 ${s.fundamentalScore.toFixed(0)} | 모멘텀 ${s.momentumScore.toFixed(0)} | ${s.changeRate >= 0 ? '+' : ''}${s.changeRate.toFixed(1)}%\n` +
        `    ${s.reasons.slice(0, 3).join(' / ')}`,
      );

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:mag: *종목 스크리닝 완료 | ${marketLabel} | ${date}*` },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: lines.join('\n\n') },
        },
      ];

      if (scores.length > 10) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `외 ${scores.length - 10}종목 추가 (GraphQL API로 조회)` }],
        });
      }

      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `종목 스크리닝 완료 | ${marketLabel} | ${date} | ${top.length}종목`,
      });
    } catch (e) {
      this.logger.error(`Failed to send screening result: ${e.message}`);
      this.handleSendError(e);
    }
  }

  /** 손절 승인 요청 메시지 전송 (버튼 포함) — 메시지 ts 반환 */
  async sendStopLossApproval(req: StopLossApprovalRequest): Promise<{ ts: string; channel: string } | null> {
    if (!await this.ensureConnected()) return null;

    try {
      const exchange = req.exchangeCode || 'KRX';
      const lossPercent = (req.lossRate * 100).toFixed(1);
      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:rotating_light: *손절 승인 요청 | ${exchange}:${req.stockCode}* (${req.stockName})`,
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `*현재가:* ${this.fmtPrice(req.currentPrice, req.market)}`,
              `*평균단가:* ${this.fmtPrice(req.avgPrice, req.market)}`,
              `*손실률:* -${lossPercent}%`,
              `*매도 수량:* ${req.quantity}주`,
              `*전략:* ${req.strategyName || 'N/A'}`,
            ].join('\n'),
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `:clock3: ${req.timeoutMinutes}분 내 미응답 시 자동 스킵됩니다.` }],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '승인 (손절 실행)' },
              style: 'danger',
              action_id: 'stop_loss_approve',
              value: req.approvalId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '거절 (스킵)' },
              action_id: 'stop_loss_reject',
              value: req.approvalId,
            },
          ],
        },
      ];

      const result = await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `손절 승인 요청 | ${exchange}:${req.stockCode} | -${lossPercent}%`,
      });

      return result.ts ? { ts: result.ts, channel: result.channel as string } : null;
    } catch (e) {
      this.logger.error(`Failed to send stop-loss approval: ${e.message}`);
      this.handleSendError(e);
      return null;
    }
  }

  /** 손절 승인 메시지 업데이트 (버튼 제거 + 결과 표시) */
  async updateStopLossApprovalMessage(
    channel: string,
    ts: string,
    stockCode: string,
    status: 'APPROVED' | 'REJECTED' | 'EXPIRED',
  ): Promise<void> {
    if (!this.app || !this.connected) return;

    const emoji = status === 'APPROVED' ? ':white_check_mark:' : status === 'REJECTED' ? ':no_entry_sign:' : ':hourglass:';
    const label = status === 'APPROVED' ? '승인됨 — 손절 실행' : status === 'REJECTED' ? '거절됨 — 스킵' : '시간 초과 — 자동 스킵';

    try {
      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `${emoji} *손절 ${label} | ${stockCode}*` },
        },
      ];

      if (status === 'EXPIRED') {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '사이트 포트폴리오 페이지에서 현재 상태를 확인하고 수동 매도할 수 있습니다.' }],
        });
      }

      await this.app.client.chat.update({
        channel,
        ts,
        blocks,
        text: `손절 ${label} | ${stockCode}`,
      });
    } catch (e) {
      this.logger.error(`Failed to update stop-loss message: ${e.message}`);
    }
  }

  // --- Block Kit Formatting (also used by SlackCommandsService) ---

  formatTradeAlert(ctx: TradeAlertContext): KnownBlock[] {
    const { signal, result, position, strategyDetails } = ctx;
    const isBuy = signal.side === 'BUY';
    const isStopLoss = signal.reason?.toLowerCase().includes('stop loss');

    let emoji: string;
    let title: string;
    if (isStopLoss) {
      emoji = ':rotating_light:';
      title = '손절 매도';
    } else if (isBuy) {
      emoji = ':chart_with_upwards_trend:';
      title = '매수 체결';
    } else {
      emoji = ':chart_with_downwards_trend:';
      title = '매도 체결';
    }

    const exchange = signal.exchangeCode || 'KRX';
    const header = `${emoji} ${title} | ${exchange}:${signal.stockCode}`;

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${header}*` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*주문:* ${signal.quantity}주 x ${this.fmtPrice(signal.price || 0, signal.market)} (${this.orderTypeLabel(signal.orderDivision)})`,
            `*주문번호:* ${result.orderNo || 'N/A'}`,
          ].join('\n'),
        },
      },
    ];

    // Strategy details
    if (strategyDetails) {
      const sd = strategyDetails;
      const lines: string[] = [];

      if (isStopLoss) {
        lines.push(`*사유:* 손절 — ${signal.reason}`);
        if (sd.realizedPnl !== undefined) {
          lines.push(`*실현 손실:* ${this.fmtMoney(sd.realizedPnl, signal.market)}`);
        }
      } else {
        lines.push(`*사유:* ${signal.reason}`);
        if (sd.tValue !== undefined && sd.maxCycles !== undefined) {
          lines.push(`*T값:* ${sd.tValue.toFixed(1)} / ${sd.maxCycles} (${((sd.tValue / sd.maxCycles) * 100).toFixed(1)}%)`);
        }
        if (sd.pivotPrice !== undefined) {
          lines.push(`*기준가(pivot):* ${this.fmtPrice(sd.pivotPrice, signal.market)}`);
        }
        if (sd.originalQuota !== undefined && sd.adjustedQuota !== undefined) {
          const diff = sd.adjustedQuota === sd.originalQuota ? '변동 없음' : `${sd.originalQuota} -> ${sd.adjustedQuota}`;
          lines.push(`*조정 quota:* ${this.fmtMoney(sd.originalQuota, signal.market)} -> ${this.fmtMoney(sd.adjustedQuota, signal.market)} (${diff})`);
        }
        if (sd.rsi !== undefined) lines.push(`*RSI:* ${sd.rsi.toFixed(1)}`);
        if (sd.ma200 !== undefined) lines.push(`*MA200:* ${this.fmtPrice(sd.ma200, signal.market)}`);
        if (!isBuy && sd.targetRate !== undefined) {
          lines.push(`*매도 목표:* +${((sd.targetRate - 1) * 100).toFixed(0)}%`);
        }
        if (!isBuy && sd.realizedPnl !== undefined) {
          lines.push(`*실현 수익:* ${this.fmtMoney(sd.realizedPnl, signal.market)}`);
        }
      }

      if (lines.length > 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:bulb: *전략 상세*\n${lines.join('\n')}`,
          },
        });
      }
    }

    // Current position
    if (position) {
      const evalAmount = position.quantity * position.currentPrice;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `:bar_chart: *${isBuy ? '현재 보유 현황' : '매도 후 보유 현황'}*`,
            `*보유:* ${position.quantity}주`,
            `*평단:* ${this.fmtPrice(position.avgPrice, signal.market)}`,
            `*현재가:* ${this.fmtPrice(position.currentPrice, signal.market)}`,
            `*총 투자금:* ${this.fmtMoney(position.totalInvested, signal.market)}`,
            `*평가금액:* ${this.fmtMoney(evalAmount, signal.market)}`,
            `*수익률:* ${position.profitRate >= 0 ? '+' : ''}${position.profitRate.toFixed(2)}% (${this.fmtMoney(position.profitLoss, signal.market)})`,
          ].join('\n'),
        },
      });
    }

    return blocks;
  }

  formatDailySummary(ctx: DailySummaryContext): KnownBlock[] {
    const today = new Date().toISOString().slice(0, 10);

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:clipboard: *일일 매매 요약 | ${today}*`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*오늘 체결:* 매수 ${ctx.todayBuyCount}건 / 매도 ${ctx.todaySellCount}건`,
            ctx.skipCount > 0
              ? `*스킵:* ${ctx.skipCount}건 (${ctx.skipReasons.join(', ')})`
              : '*스킵:* 없음',
          ].join('\n'),
        },
      },
    ];

    // Portfolio summary
    if (ctx.positions.length > 0) {
      const posLines = ctx.positions.map((p) => {
        const market = p.market === 'OVERSEAS' ? 'OVERSEAS' : 'DOMESTIC';
        const T = p.totalInvested > 0 ? (p.totalInvested / 1).toFixed(1) : '0.0';
        return `${p.stockCode}  ${p.quantity}주 | 평단 ${this.fmtPrice(p.avgPrice, market)} | ${p.profitRate >= 0 ? '+' : ''}${p.profitRate.toFixed(1)}%`;
      });

      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:bar_chart: *포트폴리오 현황*\n\`\`\`\n${posLines.join('\n')}\n\`\`\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `*총 투자금:* ${this.fmtMoney(ctx.totalInvested, 'OVERSEAS')}`,
              `*총 평가금:* ${this.fmtMoney(ctx.totalEvaluation, 'OVERSEAS')}`,
              `*총 손익:* ${ctx.totalPnl >= 0 ? '+' : ''}${this.fmtMoney(ctx.totalPnl, 'OVERSEAS')} (${ctx.totalPnlRate >= 0 ? '+' : ''}${ctx.totalPnlRate.toFixed(2)}%)`,
            ].join('\n'),
          },
        },
      );
    }

    // Market condition
    if (ctx.marketCondition) {
      const mc = ctx.marketCondition;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `:globe_with_meridians: *시장 상황*`,
            `*${mc.referenceIndexName}:* MA200 ${mc.referenceIndexAboveMA200 ? '위 :white_check_mark:' : '아래 :x:'}`,
            mc.interestRate !== undefined
              ? `*금리:* ${mc.interestRate.toFixed(2)}% ${mc.interestRateRising ? '(상승 :warning:)' : '(안정)'}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      });
    }

    return blocks;
  }

  formatFilterLog(ctx: FilterLogContext): KnownBlock[] {
    const exchange = ctx.exchangeCode || 'KRX';
    const detailLines = Object.entries(ctx.details)
      .map(([k, v]) => `*${k}:* ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n');

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:track_next: *전략 스킵 | ${exchange}:${ctx.stockCode}*`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*사유:* ${ctx.reason}\n${detailLines}`,
        },
      },
    ];
  }

  formatPositionList(positions: PositionInfo[]): KnownBlock[] {
    if (positions.length === 0) {
      return [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: ':bar_chart: *보유 포지션이 없습니다.*' },
        },
      ];
    }

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:bar_chart: *보유 포지션 (${positions.length}종목)*` },
      },
      { type: 'divider' },
    ];

    for (const p of positions) {
      const exchange = p.exchangeCode || 'KRX';
      const evalAmount = p.quantity * p.currentPrice;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*${exchange}:${p.stockCode}* (${p.stockName})`,
            `보유: ${p.quantity}주 | 평단: ${this.fmtPrice(p.avgPrice, p.market)} | 현재가: ${this.fmtPrice(p.currentPrice, p.market)}`,
            `투자금: ${this.fmtMoney(p.totalInvested, p.market)} | 평가: ${this.fmtMoney(evalAmount, p.market)} | ${p.profitRate >= 0 ? '+' : ''}${p.profitRate.toFixed(2)}%`,
          ].join('\n'),
        },
      });
    }

    return blocks;
  }

  formatStockDetail(
    position: PositionInfo,
    watchStock?: { quota?: number; cycle: number; maxCycles: number; stopLossRate: number },
  ): KnownBlock[] {
    const exchange = position.exchangeCode || 'KRX';
    const evalAmount = position.quantity * position.currentPrice;
    const T =
      watchStock?.quota && watchStock.quota > 0
        ? position.totalInvested / watchStock.quota
        : 0;

    const lines: string[] = [
      `*${exchange}:${position.stockCode}* (${position.stockName})`,
      '',
      `:bar_chart: *보유 현황*`,
      `*보유:* ${position.quantity}주`,
      `*평단:* ${this.fmtPrice(position.avgPrice, position.market)}`,
      `*현재가:* ${this.fmtPrice(position.currentPrice, position.market)}`,
      `*총 투자금:* ${this.fmtMoney(position.totalInvested, position.market)}`,
      `*평가금액:* ${this.fmtMoney(evalAmount, position.market)}`,
      `*수익률:* ${position.profitRate >= 0 ? '+' : ''}${position.profitRate.toFixed(2)}% (${this.fmtMoney(position.profitLoss, position.market)})`,
    ];

    if (watchStock) {
      lines.push(
        '',
        `:bulb: *전략 정보*`,
        `*T값:* ${T.toFixed(1)} / ${watchStock.maxCycles}`,
        `*Quota:* ${watchStock.quota ? this.fmtMoney(watchStock.quota, position.market) : 'N/A'}`,
        `*Cycle:* ${watchStock.cycle}`,
        `*손절률:* ${(watchStock.stopLossRate * 100).toFixed(0)}%`,
      );

      // Next buy/sell prices
      if (watchStock.quota && watchStock.quota > 0) {
        const baseRate = (10 - T / 2 + 100) / 100;
        const pivotPrice = baseRate * position.avgPrice;
        const isOverseas = position.market === 'OVERSEAS';
        const roundPrice = isOverseas
          ? (p: number) => Math.round(p * 100) / 100
          : (p: number) => Math.round(p);

        let targetRate: number;
        if (T < 10) targetRate = 1.05;
        else if (T < 20) targetRate = 1.10;
        else targetRate = 1.15;

        lines.push(
          '',
          `:dart: *다음 주문 예상가*`,
          `*기준가(pivot):* ${this.fmtPrice(roundPrice(pivotPrice), position.market)}`,
          `*Sell1 가격:* ${this.fmtPrice(roundPrice(pivotPrice), position.market)}`,
          `*Sell2 목표:* ${this.fmtPrice(roundPrice(position.avgPrice * targetRate), position.market)} (+${((targetRate - 1) * 100).toFixed(0)}%)`,
          `*손절가:* ${this.fmtPrice(roundPrice(position.avgPrice * (1 - watchStock.stopLossRate)), position.market)}`,
        );
      }
    }

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ];
  }

  formatRiskAlert(ctx: RiskAlertContext): KnownBlock[] {
    const marketLabel = ctx.market === 'DOMESTIC' ? '국내' : '해외';
    const d = ctx.details;

    const isLiquidate = ctx.riskType === 'MDD_LIQUIDATE';
    const emoji = isLiquidate ? ':rotating_light:' : ':warning:';
    const title = isLiquidate ? '전량 청산 발동' : '매수 차단 경고';

    const lines: string[] = [];

    if (d.drawdown !== undefined) {
      lines.push(`*MDD (최대 낙폭):* ${(d.drawdown * 100).toFixed(1)}%`);
      lines.push(
        `> MDD란 운용 이후 최고점 대비 현재 포트폴리오가 얼마나 하락했는지를 나타냅니다.`,
      );
    }
    if (d.peakValue !== undefined) {
      lines.push(`*역대 최고 가치:* ${this.fmtMoney(d.peakValue, ctx.market)}`);
    }
    if (d.currentValue !== undefined) {
      lines.push(`*현재 포트폴리오 가치:* ${this.fmtMoney(d.currentValue, ctx.market)}`);
    }
    if (d.peakValue !== undefined && d.currentValue !== undefined) {
      const loss = d.currentValue - d.peakValue;
      lines.push(`*고점 대비 손실:* ${this.fmtMoney(loss, ctx.market)}`);
    }
    if (d.dailyPnlRate !== undefined) {
      lines.push(`*일간 손익률:* ${(d.dailyPnlRate * 100).toFixed(1)}%`);
    }
    if (d.positionCount !== undefined) {
      lines.push(`*보유 종목 수:* ${d.positionCount}개`);
    }
    if (d.investedRate !== undefined) {
      lines.push(`*투자비율:* ${(d.investedRate * 100).toFixed(1)}%`);
    }

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `${emoji} *${title} | ${marketLabel}*` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ];

    if (ctx.reasons.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:exclamation: *발동 사유*\n${ctx.reasons.map((r) => `• ${r}`).join('\n')}`,
        },
      });
    }

    if (isLiquidate) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':information_source: MDD ≤ -15% 규칙에 따라 모든 보유 포지션을 자동 청산합니다. 청산 완료 후 개별 매도 알림이 전송됩니다.',
          },
        ],
      });
    }

    return blocks;
  }

  // --- Helpers ---

  private fmtPrice(price: number, market: string): string {
    if (market === 'OVERSEAS') {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${price.toLocaleString('ko-KR')}원`;
  }

  private fmtMoney(amount: number, market: string): string {
    if (market === 'OVERSEAS') {
      return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${amount.toLocaleString('ko-KR')}원`;
  }

  private orderTypeLabel(division?: string): string {
    switch (division) {
      case '34':
        return 'LOC';
      case '00':
        return '지정가';
      default:
        return '시장가';
    }
  }
}
