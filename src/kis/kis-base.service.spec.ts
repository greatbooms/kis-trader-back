import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { KisAuthService } from './kis-auth.service';
import { KisBaseService } from './kis-base.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('KisBaseService', () => {
  let service: KisBaseService;
  let mockAuthService: {
    getAccessToken: jest.Mock;
    getAppKey: jest.Mock;
    getAppSecret: jest.Mock;
    getBaseUrl: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();

    mockAuthService = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      getAppKey: jest.fn().mockReturnValue('app-key'),
      getAppSecret: jest.fn().mockReturnValue('app-secret'),
      getBaseUrl: jest.fn().mockReturnValue('https://kis.example'),
    };
    const configService = {
      get: jest.fn().mockReturnValue('prod'),
    } as unknown as ConfigService;

    service = new KisBaseService(
      mockAuthService as unknown as KisAuthService,
      configService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function advanceTimersFor<T>(expectation: Promise<T>): Promise<T> {
    await jest.runAllTimersAsync();
    return expectation;
  }

  it.each([
    ['base URL', () => mockAuthService.getBaseUrl.mockImplementationOnce(() => { throw new Error('sensitive base URL'); })],
    ['access token', () => mockAuthService.getAccessToken.mockRejectedValueOnce(new Error('sensitive access token'))],
    ['header', () => mockAuthService.getAppKey.mockImplementationOnce(() => { throw new Error('sensitive app key'); })],
  ])('classifies %s setup failure as not submitted before POST', async (_label, failSetup) => {
    failSetup();

    const errorPromise = service.post('/order', 'TTTC0012U', {}).catch((error) => error);
    await jest.runAllTimersAsync();
    const error = await errorPromise;

    expect(error).toMatchObject({
      kind: 'BUSINESS_REJECTION',
      message: 'KIS mutation not submitted [TTTC0012U] /order: request setup failed',
    });
    expect(error.message).not.toContain('sensitive');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it.each(['ETIMEDOUT', 'ECONNRESET'])('issues one POST for %s', async (code) => {
    mockedAxios.post.mockRejectedValue(Object.assign(new Error(code), { code }));

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'TRANSPORT_UNKNOWN',
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('classifies a normal KIS rejection envelope as a business rejection', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { rt_cd: '1', msg_cd: 'APBK0919', msg1: '주문가능수량을 초과했습니다' },
      headers: {},
    });

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'BUSINESS_REJECTION',
      response: expect.objectContaining({ rt_cd: '1', msg_cd: 'APBK0919' }),
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('preserves a valid KIS rejection envelope carried by an HTTP error', async () => {
    mockedAxios.post.mockRejectedValue(Object.assign(new Error('Request failed with status code 400'), {
      response: {
        status: 400,
        data: { rt_cd: '1', msg_cd: 'APBK0919', msg1: '주문가능수량을 초과했습니다' },
      },
    }));

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'BUSINESS_REJECTION',
      response: expect.objectContaining({ rt_cd: '1', msg_cd: 'APBK0919' }),
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it.each([400, 500])('classifies a bare HTTP %s as transport unknown without retry', async (status) => {
    mockedAxios.post.mockRejectedValue(Object.assign(new Error(`HTTP ${status}`), {
      response: { status },
    }));

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'TRANSPORT_UNKNOWN',
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('classifies a malformed successful HTTP response as transport unknown', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { msg1: 'unexpected response shape' },
      headers: {},
    });

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'TRANSPORT_UNKNOWN',
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('does not treat an incomplete rejection-shaped body as a business rejection', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { rt_cd: '1' },
      headers: {},
    });

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'TRANSPORT_UNKNOWN',
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('keeps a malformed rt_cd response transport unknown', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { rt_cd: '0 ', msg_cd: '0000', msg1: '정상처리 되었습니다' },
      headers: {},
    });

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'TRANSPORT_UNKNOWN',
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('classifies an HTTP error carrying rt_cd=0 as transport unknown', async () => {
    mockedAxios.post.mockRejectedValue(Object.assign(new Error('contradictory response'), {
      response: {
        status: 500,
        data: { rt_cd: '0', msg_cd: '0000', msg1: '정상처리 되었습니다' },
      },
    }));

    const expectation = expect(service.post('/order', 'TTTC0012U', {})).rejects.toMatchObject({
      kind: 'TRANSPORT_UNKNOWN',
    });
    await advanceTimersFor(expectation);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('keeps bounded retries for GET', async () => {
    const starts: number[] = [];
    mockedAxios.get
      .mockImplementationOnce(async () => {
        starts.push(Date.now());
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      })
      .mockImplementationOnce(async () => {
        starts.push(Date.now());
        return { data: { rt_cd: '0', output: [] }, headers: {} } as never;
      });

    const resultPromise = service.get('/history', 'TTTC0081R', {});
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ rt_cd: '0', output: [] });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(600);
  });

  it('spaces actual prod HTTP starts by 100ms after shared token setup completes', async () => {
    let releaseToken!: (token: string) => void;
    const tokenReady = new Promise<string>((resolve) => {
      releaseToken = resolve;
    });
    mockAuthService.getAccessToken.mockReturnValue(tokenReady);

    const starts: number[] = [];
    mockedAxios.get.mockImplementation(async () => {
      starts.push(Date.now());
      return { data: { rt_cd: '0', output: [] }, headers: {} } as never;
    });

    const first = service.get('/price-a', 'TR-A', {});
    const second = service.get('/price-b', 'TR-B', {});
    releaseToken('access-token');

    await jest.advanceTimersByTimeAsync(99);
    expect(mockedAxios.get).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(99);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    await Promise.all([first, second]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(100);
  });

  it('preserves FIFO order across GET and POST', async () => {
    const starts: string[] = [];
    mockedAxios.get.mockImplementation(async () => {
      starts.push('GET');
      return { data: { rt_cd: '0', output: [] }, headers: {} } as never;
    });
    mockedAxios.post.mockImplementation(async () => {
      starts.push('POST');
      return { data: { rt_cd: '0', output: {} } } as never;
    });

    const getPromise = service.get('/price', 'TR-GET', {});
    const postPromise = service.post('/order', 'TR-POST', {});
    await jest.runAllTimersAsync();
    await Promise.all([getPromise, postPromise]);

    expect(starts).toEqual(['GET', 'POST']);
  });

  it('keeps paper HTTP starts 300ms apart', async () => {
    const paperService = new KisBaseService(
      mockAuthService as unknown as KisAuthService,
      { get: jest.fn().mockReturnValue('paper') } as unknown as ConfigService,
    );
    const starts: number[] = [];
    mockedAxios.get.mockImplementation(async () => {
      starts.push(Date.now());
      return { data: { rt_cd: '0', output: [] }, headers: {} } as never;
    });

    const first = paperService.get('/paper-a', 'TR-A', {});
    const second = paperService.get('/paper-b', 'TR-B', {});
    await jest.advanceTimersByTimeAsync(599);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);

    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(300);
  });

  it('returns GET response metadata without changing the response body', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { rt_cd: '0', output: [] },
      headers: { tr_cont: 'F' },
    });

    const resultPromise = (service as any).getWithMetadata('/history', 'TTTC0081R', {});
    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      data: { rt_cd: '0', output: [] },
      trCont: 'F',
    });
  });
});
