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
});
