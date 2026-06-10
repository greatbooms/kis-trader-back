import { SimulationStatus } from '@prisma/client';
import { DayTradeScreeningService } from './day-trade-screening.service';
import { DailyPrice } from '../kis/types/kis-api.types';

const DATE = '20260611';

/** 게이트 통과용 봉: 최신 봉만 상승 → aboveMa20 true, ATR/거래대금 충분 */
function passingBars(): DailyPrice[] {
  return Array.from({ length: 25 }, (_, i) => ({
    date: String(20260610 - i),
    close: i === 0 ? 105 : 100,
    open: 100,
    high: i === 0 ? 108 : 102,
    low: i === 0 ? 102 : 98,
    volume: 600_000_000, // 평균 거래대금 ≈ 600억 ≥ 300억
  }));
}

/** 레짐 탈락용 봉: 전 구간 동일 → aboveMa20 false */
function flatBars(): DailyPrice[] {
  return Array.from({ length: 25 }, (_, i) => ({
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
      },
    };
    kis = {
      getVolumeRanking: jest.fn().mockResolvedValue([]),
      getFluctuationRanking: jest.fn().mockResolvedValue([]),
      getDailyPrices: jest.fn().mockResolvedValue([]), // 기본: 봉 부족 → 평가 제외
      getPrice: jest.fn().mockImplementation((code: string) =>
        Promise.resolve({ stockCode: code, stockName: `name-${code}`, currentPrice: 100 })),
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
      if (code === '252670') return Promise.resolve(flatBars());
      return Promise.resolve([]);
    });

    const result = await service.runDailySelection(DATE);

    expect(result.skipped).toBe(false);
    expect(result.saved).toBe(2); // 통과 1 + 탈락 1
    expect(result.simulated).toBe(1);
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalledTimes(2);
    expect(sessionManager.createSession).toHaveBeenCalledTimes(1);
    expect(sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        stockCode: '122630',
        strategyName: 'momentum-breakout',
        name: `[DT] ${DATE} name-122630`,
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
    kis.getDailyPrices.mockImplementation((code: string) =>
      Promise.resolve(code === '122630' ? passingBars() : []));

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
    kis.getDailyPrices.mockImplementation((code: string) =>
      Promise.resolve(code === '122630' ? passingBars() : []));
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
      if (code === '252670') return Promise.resolve(passingBars());
      return Promise.resolve([]);
    });

    const result = await service.runDailySelection(DATE);

    expect(result.saved).toBe(1); // 252670만 평가됨
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('getPrice 실패 종목은 건너뛰고 나머지는 계속 평가한다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) => {
      if (code === '122630' || code === '252670') return Promise.resolve(passingBars());
      return Promise.resolve([]);
    });
    kis.getPrice.mockImplementation((code: string) =>
      code === '122630'
        ? Promise.reject(new Error('KIS price error'))
        : Promise.resolve({ stockCode: code, stockName: `name-${code}`, currentPrice: 100 }),
    );

    const result = await service.runDailySelection(DATE);

    expect(result.saved).toBe(1); // 252670만 평가/저장됨
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalledTimes(1);
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
  });

  it('시뮬 생성이 실패해도 후보 저장과 Slack 리포트는 유지된다', async () => {
    kis.getDailyPrices.mockImplementation((code: string) =>
      Promise.resolve(code === '122630' ? passingBars() : []));
    sessionManager.createSession.mockRejectedValue(new Error('sim error'));

    const result = await service.runDailySelection(DATE);

    expect(result.skipped).toBe(false);
    expect(result.simulated).toBe(0);
    expect(prisma.dayTradeCandidate.upsert).toHaveBeenCalled();
    expect(slack.sendDayTradeCandidates).toHaveBeenCalledTimes(1);
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
