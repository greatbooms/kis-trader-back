import { SimulationScheduler } from './simulation.scheduler';

/** 외부에서 resolve를 제어하는 pending promise — 실행 중인 run을 원하는 시점까지 붙잡는 용도 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

describe('SimulationScheduler', () => {
  let simulationService: any;
  let tradingScheduler: any;
  let prisma: any;
  let scheduler: SimulationScheduler;

  beforeEach(() => {
    simulationService = {
      updatePositionPrices: jest.fn().mockResolvedValue(undefined),
      checkPendingOrders: jest.fn().mockResolvedValue(undefined),
      executeSimulationTick: jest.fn().mockResolvedValue(undefined),
    };
    tradingScheduler = {
      isBusy: jest.fn().mockReturnValue(false),
      isMarketOpen: jest.fn().mockReturnValue(true),
      isExchangeHoliday: jest.fn().mockResolvedValue(false),
    };
    prisma = { simulationSession: { findMany: jest.fn().mockResolvedValue([]) } };
    // onModuleInit(cron 등록)은 호출하지 않고 실행 경로만 직접 검증
    scheduler = new SimulationScheduler(simulationService, tradingScheduler, prisma, {} as any);
  });

  it('해외 run이 진행 중이어도 국내 세션 틱은 실행된다 (마켓별 독립 실행)', async () => {
    // 2026-06-11 장애 재현: 해외 세션 0개인 해외 run이 플래그를 점유해 국내 틱이 통째로 누락
    const overseasQuery = deferred<any[]>();
    prisma.simulationSession.findMany.mockImplementation(({ where }: any) =>
      where.market === 'OVERSEAS'
        ? overseasQuery.promise
        : Promise.resolve([{ id: 's1', market: 'DOMESTIC', status: 'RUNNING' }]));

    const overseasRun = (scheduler as any).executeSimulationsOverseas();
    await flushMicrotasks(); // 해외 run이 세션 조회 pending 지점까지 진행하도록

    await (scheduler as any).executeSimulationsDomestic();

    expect(simulationService.executeSimulationTick).toHaveBeenCalledWith('s1');

    overseasQuery.resolve([]);
    await overseasRun;
  });

  it('같은 마켓 중복 실행은 건너뛰고 warn 로그를 남긴다', async () => {
    const firstQuery = deferred<any[]>();
    prisma.simulationSession.findMany.mockReturnValueOnce(firstQuery.promise);
    const warnSpy = jest.spyOn((scheduler as any).logger, 'warn').mockImplementation(() => undefined);

    const firstRun = (scheduler as any).executeSimulationsDomestic();
    await flushMicrotasks(); // 첫 run이 세션 조회 pending 지점까지 진행하도록

    await (scheduler as any).executeSimulationsDomestic();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DOMESTIC'));
    expect(prisma.simulationSession.findMany).toHaveBeenCalledTimes(1);

    firstQuery.resolve([]);
    await firstRun;
  });

  it('실행할 세션이 없는 마켓은 실거래 스케줄러 대기 없이 즉시 종료한다', async () => {
    // isBusy가 잠시 true여도 세션 0개면 대기 자체를 시작하지 않아야 한다
    tradingScheduler.isBusy
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await (scheduler as any).executeSimulationsOverseas();

    expect(tradingScheduler.isBusy).not.toHaveBeenCalled();
    expect(simulationService.executeSimulationTick).not.toHaveBeenCalled();
  });
});
