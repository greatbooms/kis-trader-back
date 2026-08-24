import { SlackService } from './slack.service';
import { OrderFailureAlertContext } from './types/order-failure-alert-context.type';
import { Broker } from '@prisma/client';

describe('SlackService', () => {
  let service: SlackService;
  let postMessage: jest.Mock;
  let updateMessage: jest.Mock;
  const failureContext: OrderFailureAlertContext = {
    broker: Broker.TOSS,
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'PROSHARES QQQ 3X',
    side: 'BUY',
    quantity: 2,
    orderType: 'LIMIT',
    price: 74.43,
    strategyName: 'infinite-buy',
    reason: 'Buy1: T=29.3',
    stage: 'SUBMISSION',
    brokerMessage: 'EGW00201 - 초당 거래건수를 초과하였습니다.',
    occurredAt: new Date('2026-08-07T06:30:00.879Z'),
  };

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
    updateMessage = jest.fn().mockResolvedValue({});
    (service as any).connected = true;
    (service as any).app = {
      client: {
        chat: { postMessage, update: updateMessage },
      },
    };
  });

  it('returns a configured Web API app before Socket Mode is connected', () => {
    const configuredApp = { client: {} };
    (service as any).connected = false;
    (service as any).app = null;
    const initialize = jest
      .spyOn(service as any, 'initializeApp')
      .mockImplementation(() => {
        (service as any).app = configuredApp;
      });

    expect(service.getConfiguredApp()).toBe(configuredApp);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(service.isEnabled()).toBe(false);
  });

  it('does not initialize a Web API app when Slack tokens are incomplete', () => {
    const disabled = new SlackService({
      get: jest.fn((key: string) => ({
        'slack.enabled': true,
        'slack.channel': '#test',
        'slack.botToken': 'xoxb-test',
        'slack.appToken': '',
      })[key]),
    } as any);
    const initialize = jest.spyOn(disabled as any, 'initializeApp');

    expect(disabled.getConfiguredApp()).toBeNull();
    expect(initialize).not.toHaveBeenCalled();
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
        broker: Broker.KIS,
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
        outcome: 'ACCEPTED',
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
        broker: Broker.KIS,
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
    expect(text).toContain('한국투자 · TQQQ');
    expect(text).toContain('*현재 보유 현황 (한국투자)*');
    expect(text).not.toContain('*전 증권사 합산:*');
    expect(text).not.toContain('*T값:* 17.6 / 40');
  });

  it('체결 알림은 두 증권사 보유가 있을 때만 전 증권사 합산을 표시한다', () => {
    const blocks = service.formatTradeAlert({
      signal: {
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY',
        quantity: 2,
        price: 75,
        reason: '매수',
        orderDivision: '00',
      },
      result: { outcome: 'ACCEPTED', success: true, orderNo: '1', message: '체결 완료' },
      position: {
        broker: Broker.KIS,
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        exchangeCode: 'NASD',
        market: 'OVERSEAS',
        quantity: 26,
        avgPrice: 100,
        currentPrice: 120,
        totalInvested: 2600,
        profitRate: 20,
        profitLoss: 520,
      },
      crossBrokerPosition: {
        totalQuantity: 36,
        totalValue: 4341.6,
        brokers: [
          { broker: Broker.KIS, quantity: 26, value: 3120 },
          { broker: Broker.TOSS, quantity: 10, value: 1221.6 },
        ],
      },
    });

    const text = blocks.map((block: any) => block.text?.text ?? '').join('\n');
    expect(text).toContain('*전 증권사 합산:* 36주 · $4,341.60 (한국투자 26 / 토스 10)');
  });

  it('단일 브로커 일일요약에는 증권사 소계를 표시하지 않는다', () => {
    const position = {
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      quantity: 10,
      avgPrice: 100,
      currentPrice: 90,
      profitLoss: -100,
      profitRate: -10,
      totalInvested: 1000,
    };
    const text = service.formatDailySummary({
      positions: [position],
      todayBuyCount: 0,
      todaySellCount: 0,
      skipCount: 0,
      skipReasons: [],
      totalInvested: 1000,
      totalEvaluation: 900,
      totalPnl: -100,
      totalPnlRate: -10,
      marketSummaries: [{
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        label: '미국',
        positions: [position],
        totalInvested: 1000,
        totalEvaluation: 900,
        totalPnl: -100,
        totalPnlRate: -10,
      }],
    }).map((block: any) => block.text?.text ?? '').join('\n');

    expect(text).not.toContain('*증권사별:*');
  });

  it('두 브로커 일일요약에는 한글 증권사 소계를 표시한다', () => {
    const kisPosition = {
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      quantity: 30,
      avgPrice: 100,
      currentPrice: 90,
      profitLoss: -300,
      profitRate: -10,
      totalInvested: 3000,
    };
    const tossPosition = {
      ...kisPosition,
      broker: Broker.TOSS,
      stockCode: 'SOXL',
      quantity: 10,
      profitLoss: -100,
      totalInvested: 1000,
    };
    const positions = [kisPosition, tossPosition];
    const text = service.formatDailySummary({
      positions,
      todayBuyCount: 0,
      todaySellCount: 0,
      skipCount: 0,
      skipReasons: [],
      totalInvested: 4000,
      totalEvaluation: 3600,
      totalPnl: -400,
      totalPnlRate: -10,
      marketSummaries: [{
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        label: '미국',
        positions,
        totalInvested: 4000,
        totalEvaluation: 3600,
        totalPnl: -400,
        totalPnlRate: -10,
      }],
    }).map((block: any) => block.text?.text ?? '').join('\n');

    expect(text).toContain('*증권사별:*');
    expect(text).toContain('한국투자 투자 $3,000.00 / 평가 $2,700.00 (-10.0%)');
    expect(text).toContain('토스 투자 $1,000.00 / 평가 $900.00 (-10.0%)');
  });

  it('매도 승인 요청에는 지금 매도 시 예상 손익을 표시한다', async () => {
    postMessage.mockResolvedValue({ ts: '123.45', channel: '#test' });

    await service.sendStopLossApproval({
      broker: Broker.TOSS,
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
      validityMinutes: 10,
      cooldownMinutes: 30,
    });

    const payload = postMessage.mock.calls[0][0];
    const text = payload.blocks.map((block: any) => block.text?.text ?? '').join('\n');
    const payloadJson = JSON.stringify(payload);

    expect(text).toContain('매도 승인 요청');
    expect(text).toContain('[토스 TQQQ]');
    expect(text).toContain('*지금 매도 시 예상 손익:* +$80.00 (+10.00%)');
    expect(text).toContain('*승인 사유:* Take profit 1: T=20.5, target +8.0%');
    expect(payloadJson).toContain('승인 버튼은 전송 시점부터 10분간 유효');
    expect(payloadJson).toContain('성공한 알림 후 30분');
    expect(payloadJson).not.toContain('30분마다 재알림');
  });

  it.each([
    ['APPROVED_ACCEPTED', '승인됨 - 주문 접수'],
    ['APPROVED_NOT_SUBMITTED', '승인됨 - 주문 미실행'],
    ['APPROVED_REJECTED', '승인됨 - 토스 거절'],
    ['APPROVED_UNKNOWN', '승인됨 - 결과 확인 필요'],
    ['REJECTED', '거절됨 - 스킵'],
    ['EXPIRED', '미응답 - 주문 미실행'],
  ] as const)('매도 승인 결과 %s를 원문에 %s로 표시한다', async (status, label) => {
    await service.updateStopLossApprovalMessage('C123', '123.45', Broker.TOSS, 'TQQQ', status);

    expect(updateMessage).toHaveBeenCalledTimes(1);
    expect(updateMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'C123',
      ts: '123.45',
      text: `매도 승인 ${label} | [토스 TQQQ]`,
    }));
  });

  it('브로커 접수 후 DB 저장 실패 경고에는 안전한 주문 식별자만 포함한다', async () => {
    await service.sendBrokerOrderPersistenceWarning({
      broker: Broker.TOSS,
      market: 'OVERSEAS',
      stockCode: 'TQQQ',
      tradeRecordId: 'trade-safe-id',
      orderNo: 'broker-safe-order',
    });

    const payload = postMessage.mock.calls[0][0];
    const text = payload.blocks.map((block: any) => block.text?.text ?? '').join('\n');

    expect(text).toContain('브로커 주문 접수 후 로컬 저장 실패');
    expect(text).toContain('OVERSEAS');
    expect(text).toContain('TQQQ');
    expect(text).toContain('[토스 TQQQ]');
    expect(text).toContain('trade-safe-id');
    expect(text).toContain('broker-safe-order');
    expect(JSON.stringify(payload)).not.toContain('account');
    expect(JSON.stringify(payload)).not.toContain('credential');
  });

  it('daily risk alert displays exchange-scoped cross-broker exposure without a blocking total', async () => {
    await service.sendRiskAlert({
      broker: Broker.KIS,
      market: 'OVERSEAS',
      riskType: 'MDD_BUY_BLOCK',
      reasons: ['KIS account threshold'],
      details: {
        crossBrokerExposures: [
          {
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            totalValue: 303,
            brokers: [
              { broker: Broker.KIS, value: 120 },
              { broker: Broker.TOSS, value: 183 },
            ],
          },
        ],
      },
    });

    const payload = postMessage.mock.calls[0][0];
    const text = payload.blocks.map((block: any) => block.text?.text ?? '').join('\n');
    expect(payload.text).toContain('한국투자 해외');
    expect(text).toContain('표시 전용');
    expect(text).toContain('NASD:TQQQ');
    expect(text).toContain('한국투자 $120.00 + 토스 $183.00');
    expect(text).not.toContain('크로스 브로커 매수 차단');
  });

  it('formats daily cross-broker exposure values in the exchange currency', () => {
    const summary = {
      positions: [],
      todayBuyCount: 0,
      todaySellCount: 0,
      skipCount: 0,
      skipReasons: [],
      totalInvested: 0,
      totalEvaluation: 0,
      totalPnl: 0,
      totalPnlRate: 0,
      marketSummaries: [],
      marketConditions: [],
      crossBrokerExposures: [
        {
          exchangeCode: 'SEHK',
          stockCode: '0700',
          totalValue: 2400,
          brokers: [
            { broker: Broker.KIS, value: 1000 },
            { broker: Broker.TOSS, value: 1400 },
          ],
        },
      ],
    };

    const text = service.formatDailySummary(summary)
      .map((block: any) => block.text?.text ?? '')
      .join('\n');

    expect(text).toContain('표시 전용');
    expect(text).toContain('SEHK:0700 총 HK$2,400.00');
    expect(text).toContain('한국투자 HK$1,000.00 + 토스 HK$1,400.00');
    expect(text).not.toContain('매수 차단');
  });

  it('shows broker ownership in operational position list and detail blocks', () => {
    const position = {
      broker: Broker.TOSS,
      market: 'OVERSEAS',
      exchangeCode: 'SEHK',
      stockCode: '0700',
      stockName: 'Tencent',
      quantity: 2,
      avgPrice: 300,
      currentPrice: 310,
      profitLoss: 20,
      profitRate: 3.33,
      totalInvested: 600,
    };

    const text = [
      ...service.formatPositionList([position]),
      ...service.formatStockDetail(position),
    ].map((block: any) => block.text?.text ?? '').join('\n');

    expect(text.match(/\[토스 0700\]/g)).toHaveLength(2);
  });

  it('shows broker ownership in the strategy-skip block title', () => {
    const blocks = service.formatFilterLog({
      broker: Broker.TOSS,
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      reason: 'market regime blocked entry',
      details: { regime: 'BEARISH' },
    });

    expect((blocks[0] as any).text.text).toBe(':warning: *전략 스킵 | [토스 TQQQ]*');
  });

  it('자동 주문 실패 알림은 재시도 금지와 안전한 주문 정보만 표시한다', async () => {
    await service.sendOrderFailureAlert(failureContext);

    const payload = postMessage.mock.calls[0][0];
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('자동 주문 실패');
    expect(serialized).toContain('[토스 TQQQ]');
    expect(serialized).toContain('TQQQ');
    expect(serialized).toContain('BUY');
    expect(serialized).toContain('2주');
    expect(serialized).toContain('74.43');
    expect(serialized).toContain('EGW00201');
    expect(serialized).toContain('자동 재시도 없음');
    expect(serialized).toContain('*주문번호:* 없음');
    expect(serialized).not.toContain('accountHash');
    expect(serialized).not.toContain('access-token');
  });

  it('자동 주문 실패 알림은 free-text 사유와 브로커 메시지의 민감값을 가린다', async () => {
    const accountHash = 'a'.repeat(64);

    await service.sendOrderFailureAlert({
      ...failureContext,
      reason: 'Bearer bearer-secret access-token=access-token-secret account=1234567890',
      brokerMessage: `EGW00201 - 초당 거래건수를 초과하였습니다. api-key: api-key-secret app_secret=app-secret-value hash=${accountHash}`,
    });

    const serialized = JSON.stringify(postMessage.mock.calls[0][0]);
    expect(serialized).toContain('EGW00201 - 초당 거래건수를 초과하였습니다.');
    expect(serialized).toContain('Bearer [REDACTED]');
    expect(serialized).toContain('access-token=[REDACTED]');
    expect(serialized).toContain('api-key:[REDACTED]');
    expect(serialized).toContain('app_secret=[REDACTED]');
    expect(serialized).not.toContain('bearer-secret');
    expect(serialized).not.toContain('access-token-secret');
    expect(serialized).not.toContain('api-key-secret');
    expect(serialized).not.toContain('app-secret-value');
    expect(serialized).not.toContain('1234567890');
    expect(serialized).not.toContain(accountHash);
  });

  it('KIS appkey/appsecret과 JSON 형식의 비밀값을 가린다', async () => {
    await service.sendOrderFailureAlert({
      ...failureContext,
      reason: 'appkey=KIS_APP_KEY_SECRET appsecret:KIS_APP_SECRET_SECRET',
      brokerMessage: '{"appkey":"JSON_KEY_SECRET","appsecret":"JSON_SECRET_SECRET"}',
    });

    const serialized = JSON.stringify(postMessage.mock.calls[0][0]);
    expect(serialized).toContain('appkey=[REDACTED]');
    expect(serialized).toContain('appsecret:[REDACTED]');
    expect(serialized).not.toContain('KIS_APP_KEY_SECRET');
    expect(serialized).not.toContain('KIS_APP_SECRET_SECRET');
    expect(serialized).not.toContain('JSON_KEY_SECRET');
    expect(serialized).not.toContain('JSON_SECRET_SECRET');
  });

  it('does not post an order failure alert while Slack is disconnected', async () => {
    jest.spyOn(service as any, 'ensureConnected').mockResolvedValue(false);

    await service.sendOrderFailureAlert(failureContext);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('absorbs an order failure alert send error', async () => {
    postMessage.mockRejectedValueOnce(new Error('slack down'));

    await expect(service.sendOrderFailureAlert(failureContext)).resolves.toBeUndefined();
  });
});
