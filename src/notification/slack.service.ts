import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';
import { KnownBlock } from '@slack/types';
import {
  PositionInfo,
  TradeAlertContext,
  DailySummaryContext,
  FilterLogContext,
} from './types/notification.types';

@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app: App | null = null;
  private readonly enabled: boolean;
  private readonly channel: string;

  constructor(private configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('slack.enabled')!;
    this.channel = this.configService.get<string>('slack.channel')!;
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Slack notifications disabled');
      return;
    }

    const botToken = this.configService.get<string>('slack.botToken')!;
    const appToken = this.configService.get<string>('slack.appToken')!;

    if (!botToken || !appToken) {
      this.logger.warn('Slack tokens not configured, disabling notifications');
      return;
    }

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    await this.app.start();
    this.logger.log('Slack Socket Mode connected');
  }

  async onModuleDestroy() {
    if (this.app) {
      await this.app.stop();
      this.logger.log('Slack disconnected');
    }
  }

  getApp(): App | null {
    return this.app;
  }

  isEnabled(): boolean {
    return this.enabled && this.app !== null;
  }

  // --- Alert methods ---

  async sendTradeAlert(ctx: TradeAlertContext): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const blocks = this.formatTradeAlert(ctx);
      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `${ctx.signal.side === 'BUY' ? '매수' : '매도'} 체결 | ${ctx.signal.stockCode}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send trade alert: ${e.message}`);
    }
  }

  async sendDailySummary(ctx: DailySummaryContext): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const blocks = this.formatDailySummary(ctx);
      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `일일 매매 요약 | ${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send daily summary: ${e.message}`);
    }
  }

  async sendFilterLog(ctx: FilterLogContext): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const blocks = this.formatFilterLog(ctx);
      await this.app!.client.chat.postMessage({
        channel: this.channel,
        blocks,
        text: `전략 스킵 | ${ctx.stockCode}`,
      });
    } catch (e) {
      this.logger.error(`Failed to send filter log: ${e.message}`);
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
