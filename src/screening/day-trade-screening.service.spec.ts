import { SimulationStatus } from '@prisma/client';
import { DayTradeScreeningService } from './day-trade-screening.service';
import { DailyPrice } from '../kis/types/kis-api.types';

const DATE = '20260611';

const TEST_STOCK_NAMES: Record<string, string> = {
  '122630': 'KODEX 레버리지',
  '252670': 'KODEX 200선물인버스2X',
  '233740': 'KODEX 코스닥150레버리지',
  '251340': 'KODEX 코스닥150선물인버스',
  '114800': 'KODEX 인버스',
  '069500': 'KODEX 200',
  '229200': 'KODEX 코스닥150',
};

/** 게이트 통과용 봉: 상승 추세 + 반복 돌파 → MA20/ATR/거래대금/백테스트 통과 */
function passingBars(): DailyPrice[] {
  return Array.from({ length: 90 }, (_, i) => {
    const base = 100 + i;
    return {
      date: String(20260101 + i),
      close: base + 4,
      open: base,
      high: base + 4,
      low: base,
      volume: 600_000_000,
    };
  }).reverse();
}

/** 기초지수 상승 레짐용 봉: 추세는 강하지만 당일 돌파는 거의 없어 후보 백테스트는 탈락 */
function regimeOnlyUpBars(): DailyPrice[] {
  return Array.from({ length: 90 }, (_, i) => {
    const base = 100 + i;
    return {
      date: String(20260101 + i),
      close: base + 1,
      open: base,
      high: base + 1,
      low: base - 3,
      volume: 600_000_000,
    };
  }).reverse();
}

/** 레짐 탈락용 봉: 전 구간 동일 → aboveMa20 false */
function flatBars(): DailyPrice[] {
  return Array.from({ length: 90 }, (_, i) => ({
    date: String(20260610 - i),
    close: 100, open: 100, high: 102, low: 98, volume: 600_000_000,
  }));
}

describe('DayTradeScreeningService', () => {
  let prisma: any;
  let kis: any;
  let sessionManager: any;
  let slack: any;
  let service: DayTradeScreeningService;

  beforeEach(() => {
    prisma = {
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) }, // 기본 설정 사용
      simulationSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      dayTradeCandidate: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    kis = {
      getVolumeRanking: jest.fn().mockResolvedValue([]),
      getFluctuationRanking: jest.fn().mockResolvedValue([]),
      // 기본: 122630만 통과, 069500은 122630의 기초지수 프록시로만 사용
      getDailyPrices: jest.fn().mockImplementation((code: string) => {
        if (code === '122630') return Promise.resolve(passingBars());
        if (code === '069500') return Promise.resolve(regimeOnlyUpBars());
        return Promise.resolve([]);
      }),
      getPrice: jest.fn().mockImplementation((code: string) =>
        Promise.resolve({ stockCode: code, stockName: TEST_STOCK_NAMES[code] ?? `name-${code}`, currentPrice: 100 })),
    };
    sessionManager = {
      createSession: jest.fn().mockImplementation((input: any) =>
        Promise.resolve({ id: `session-${input.stockCode}` })),
      updateStatus: jest.fn().mockResolvedValue({}),
    };
    slack = { sendDayTradeCandidates: jest.fn().mockResolvedValue(undefined) };
    service = new DayTradeScreeningService(kis, sessionManager, slack, prisma);
  });

  it('설정이 비활성화면 아무것도 하지 않고 skipped를 반환한다', async () => {
    prisma.appSetting.findUnique.mockResolvedValue({ value: { enabled: false } });
    const result = await service.runDailySelection(DATE);
    expect(result.skipped).toBe(true);
    expect(kis.getVolumeRanking).not.toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).not.toHaveBeenCalled();
  });

  it('통과 후보를 저장하고 topN만 시뮬에 투입한다', async () => {
    // 시드 7종목 중 122630만 통과, 252670은 레짐 탈락, 나머지는 봉 부족으로 제외
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.resolve(passingBars());
      if (code === '069500') return Promise.resolve(regimeOnlyUpBars());
      if (code === '252670') return Promise.resolve(flatBars());
      return Promise.resolve([]);
    });

    const result = await service.runDailySelection(DATE);

    expect(result.skipped).toBe(false);
    expect(result.saved).toBe(3); // 통과 1 + 탈락 2(프록시 ETF/252670)
    expect(result.simulated).toBe(1);
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalledTimes(3);
    expect(sessionManager.createSession).toHaveBeenCalledTimes(1);
    expect(sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        stockCode: '122630',
        strategyName: 'momentum-breakout',
        name: `[DT] ${DATE} KODEX 레버리지`,
        strategyParams: JSON.stringify({ dayTradeAuto: true, screeningDate: DATE }),
      }),
    );
    // 시뮬 세션 ID가 후보에 연결됨
    expect(prisma.dayTradeCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { simulationSessionId: 'session-122630' },
      }),
    );
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('전일 [DT] 세션은 포지션이 없으면 COMPLETED 처리한다', async () => {
    prisma.simulationSession.findMany.mockResolvedValue([
      {
        id: 's1', stockCode: '122630', stockName: 'KODEX 레버리지',
        name: '[DT] 20260610 KODEX 레버리지',
        strategyParams: { dayTradeAuto: true, screeningDate: '20260610' },
        positions: [],
      },
    ]);
    await service.runDailySelection(DATE);
    expect(sessionManager.updateStatus).toHaveBeenCalledWith('s1', SimulationStatus.COMPLETED);
  });

  it('전일 [DT] 세션에 포지션이 남아 있으면 RUNNING 유지하고 경고를 Slack에 포함한다', async () => {
    prisma.simulationSession.findMany.mockResolvedValue([
      {
        id: 's2', stockCode: '122630', stockName: 'KODEX 레버리지',
        name: '[DT] 20260610 KODEX 레버리지',
        strategyParams: { dayTradeAuto: true, screeningDate: '20260610' },
        positions: [{ quantity: 10 }],
      },
    ]);
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.resolve(passingBars());
      if (code === '069500') return Promise.resolve(regimeOnlyUpBars());
      return Promise.resolve([]);
    });

    await service.runDailySelection(DATE);

    expect(sessionManager.updateStatus).not.toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        warnings: expect.arrayContaining([expect.stringContaining('122630')]),
      }),
    );
  });

  it('오늘 생성된 [DT] 세션은 재실행 시 정리 대상에서 제외한다', async () => {
    prisma.simulationSession.findMany.mockResolvedValue([
      {
        id: 's3', stockCode: '122630', stockName: 'KODEX 레버리지',
        name: `[DT] ${DATE} KODEX 레버리지`,
        strategyParams: { dayTradeAuto: true, screeningDate: DATE },
        positions: [],
      },
    ]);
    await service.runDailySelection(DATE);
    expect(sessionManager.updateStatus).not.toHaveBeenCalled();
  });

  it('같은 날 같은 종목 세션이 이미 있으면 중복 생성하지 않는다 (멱등)', async () => {
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.resolve(passingBars());
      if (code === '069500') return Promise.resolve(regimeOnlyUpBars());
      return Promise.resolve([]);
    });
    prisma.simulationSession.findFirst.mockResolvedValue({ id: 'existing-session' });

    const result = await service.runDailySelection(DATE);

    expect(sessionManager.createSession).not.toHaveBeenCalled();
    expect(prisma.dayTradeCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { simulationSessionId: 'existing-session' } }),
    );
    expect(result.simulated).toBe(1);
  });

  it('일부 종목의 KIS 호출이 실패해도 나머지는 계속 평가한다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.reject(new Error('KIS timeout'));
      if (code === '233740') return Promise.resolve(passingBars());
      if (code === '229200') return Promise.resolve(regimeOnlyUpBars());
      return Promise.resolve([]);
    });

    const result = await service.runDailySelection(DATE);

    expect(result.saved).toBe(2); // 233740 통과 + 229200 프록시 후보 탈락
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('getPrice 실패 종목은 건너뛰고 나머지는 계속 평가한다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630' || code === '233740') return Promise.resolve(passingBars());
      if (code === '229200') return Promise.resolve(regimeOnlyUpBars());
      return Promise.resolve([]);
    });
    kis.getPrice.mockImplementation((code: string) =>
      code === '122630'
        ? Promise.reject(new Error('KIS price error'))
        : Promise.resolve({ stockCode: code, stockName: TEST_STOCK_NAMES[code] ?? `name-${code}`, currentPrice: 100 }),
    );

    const result = await service.runDailySelection(DATE);

    expect(result.saved).toBe(2); // 233740 통과 + 229200 프록시 후보 탈락
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalledTimes(2);
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('시뮬 생성이 실패해도 후보 저장과 Slack 리포트는 유지된다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.resolve(passingBars());
      if (code === '069500') return Promise.resolve(regimeOnlyUpBars());
      return Promise.resolve([]);
    });
    sessionManager.createSession.mockRejectedValue(new Error('sim error'));

    const result = await service.runDailySelection(DATE);

    expect(result.skipped).toBe(false);
    expect(result.simulated).toBe(0);
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('유니버스 전체가 평가 불능이면 KIS 이상으로 간주해 throw한다 (silent success 방지)', async () => {
    kis.getDailyPrices.mockResolvedValue([]); // 전 종목 봉 없음 — KIS 장애 시나리오

    await expect(service.runDailySelection(DATE)).rejects.toThrow('평가 불능');
    expect(prisma.dayTradeCandidate.upsert).not.toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).not.toHaveBeenCalled();
  });

  it('같은 날 재실행 시 이번 평가에 없는 잔존 후보를 정리한다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630') return Promise.resolve(passingBars());
      if (code === '069500') return Promise.resolve(regimeOnlyUpBars());
      if (code === '252670') return Promise.resolve(flatBars());
      return Promise.resolve([]);
    });

    await service.runDailySelection(DATE);

    expect(prisma.dayTradeCandidate.deleteMany).toHaveBeenCalledWith({
      where: {
        screeningDate: DATE,
        market: 'DOMESTIC',
        stockCode: { notIn: expect.arrayContaining(['122630', '252670', '069500']) },
      },
    });
  });

  it('랭킹에서 수집한 strict ETF가 유니버스에 합류한다', async () => {
    kis.getVolumeRanking.mockResolvedValue([
      { mksc_shrn_iscd: '305720', hts_kor_isnm: 'KODEX 2차전지산업' }, // strict ETF → 합류
      { mksc_shrn_iscd: '005930', hts_kor_isnm: '삼성전자' }, // 일반주 → 제외
      { mksc_shrn_iscd: 'Q500001', hts_kor_isnm: '미래에셋 레버리지 ETN' }, // ETN → 제외
    ]);
    await service.runDailySelection(DATE);
    const requested = kis.getDailyPrices.mock.calls.map((c: any[]) => c[0]);
    expect(requested).toContain('305720');
    expect(requested).not.toContain('005930');
    expect(requested).not.toContain('Q500001');
  });
});
