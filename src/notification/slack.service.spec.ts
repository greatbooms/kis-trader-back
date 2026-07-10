import { SlackService } from './slack.service';

describe('SlackService', () => {
  let service: SlackService;
  let postMessage: jest.Mock;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'slack.enabled': true,
          'slack.channel': '#test',
          'slack.botToken': 'xoxb-test',
          'slack.appToken': 'xapp-test',
        };
        return values[key];
      }),
    };
    service = new SlackService(configService as any);
    postMessage = jest.fn().mockResolvedValue({});
    (service as any).connected = true;
    (service as any).app = {
      client: {
        chat: { postMessage },
      },
    };
  });

  it('당일청산 후보 리포트는 상세 지표가 길어져도 표시 종목 수를 제한한다', async () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      stockCode: String(100000 + i),
      stockName: `KODEX 테스트 레버리지 ${i + 1}`,
      rank: i + 1,
      score: 80 - i,
      prevRangePct: 3.12,
      atrPct: 2.34,
      avgTradeValue20d: 123_400_000_000,
      underlyingRegime: {
        proxyStockName: 'KODEX 200',
        regime: 'TRENDING_UP',
        reason: '기초지수 상승 레짐',
      },
      backtest: {
        tradeCount: 12,
        winRatePct: 58.3,
        totalReturnPct: 4.7,
        averageTradeReturnPct: 0.39,
        maxDrawdownPct: -2.1,
      },
      simulated: i < 3,
    }));

    await service.sendDayTradeCandidates({
      date: '20260611',
      candidates,
      excluded: [],
      warnings: [],
    });

    const payload = postMessage.mock.calls[0][0];
    const candidateSection = payload.blocks.find(
      (block: any) => block.type === 'section' && block.text?.text.includes('KODEX 테스트 레버리지'),
    );
    expect(candidateSection.text.text).toContain('8. *KODEX 테스트 레버리지 8*');
    expect(candidateSection.text.text).not.toContain('9. *KODEX 테스트 레버리지 9*');
    expect(candidateSection.text.text.length).toBeLessThan(3000);
    expect(payload.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'context',
          elements: expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining('외 12종목 추가 통과'),
            }),
          ]),
        }),
      ]),
    );
  });

  it('무한매수 체결 알림은 주문 당시 T와 체결 후 T를 분리해서 표시한다', () => {
    const blocks = service.formatTradeAlert({
      signal: {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY',
        quantity: 2,
        price: 75.78,
        reason: 'Buy1: T=17.6, 70%+잔여재배분, 2주 @ 75.78',
        orderDivision: '00',
      },
      result: {
        success: true,
        orderNo: '0031304419',
        message: '체결 완료',
      },
      execution: {
        quantity: 2,
        price: 75.76,
        remainingQuantity: 0,
        status: 'FILLED',
      },
      position: {
        stockCode: 'TQQQ',
        stockName: 'PROSHARES QQQ 3X',
        exchangeCode: 'NASD',
        market: 'OVERSEAS',
        quantity: 59,
        avgPrice: 77.3,
        currentPrice: 75.85,
        totalInvested: 4560.63,
        profitRate: -1.87,
        profitLoss: -85.48,
      },
      strategyDetails: {
        tValue: 17.6,
        postFillTValue: 18.2,
        maxCycles: 40,
      } as any,
    });

    const text = blocks.map((block: any) => block.text?.text ?? '').join('\n');

    expect(text).toContain('*주문 당시 T:* 17.6 / 40 (44.0%)');
    expect(text).toContain('*체결 후 T:* 18.2 / 40 (45.5%)');
    expect(text).not.toContain('*T값:* 17.6 / 40');
  });

  it('매도 승인 요청에는 지금 매도 시 예상 손익을 표시한다', async () => {
    postMessage.mockResolvedValue({ ts: '123.45', channel: '#test' });

    await service.sendStopLossApproval({
      approvalId: 'approval-1',
      tradeRecordId: 'trade-1',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      exchangeCode: 'NASD',
      market: 'OVERSEAS',
      strategyName: 'infinite-buy',
      quantity: 4,
      currentPrice: 220,
      avgPrice: 200,
      lossRate: -0.1,
      expectedPnl: 80,
      expectedPnlRate: 0.1,
      approvalReason: 'Take profit 1: T=20.5, target +8.0%',
      timeoutMinutes: 30,
    });

    const payload = postMessage.mock.calls[0][0];
    const text = payload.blocks.map((block: any) => block.text?.text ?? '').join('\n');

    expect(text).toContain('매도 승인 요청');
    expect(text).toContain('*지금 매도 시 예상 손익:* +$80.00 (+10.00%)');
    expect(text).toContain('*승인 사유:* Take profit 1: T=20.5, target +8.0%');
  });
});
