import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { BrokerMutationError } from '../common/broker-mutation.error';
import { classifyKisMutationFailure } from '../kis/kis-mutation.error';
import { TossAuthService } from './toss-auth.service';
import { TossBaseService } from './toss-base.service';
import { TossMutationError } from './toss-mutation.error';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TossBaseService', () => {
  let service: TossBaseService;
  let accountNo: string | undefined;
  let auth: {
    getAccessToken: jest.Mock;
    invalidateToken: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    jest.resetAllMocks();

    auth = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidateToken: jest.fn(),
    };
    accountNo = '12345678901';
    const config = {
      get: jest.fn((key: string) => key === 'toss.accountNo' ? accountNo : undefined),
    } as unknown as ConfigService;
    service = new TossBaseService(auth as unknown as TossAuthService, config);
  });

  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  async function settle<T>(promise: Promise<T>): Promise<T> {
    await jest.runAllTimersAsync();
    return promise;
  }

  it('uses the existing KIS mutation detector for Toss rejection semantics', () => {
    const error = new TossMutationError('BUSINESS_REJECTION', 'declined');

    expect(classifyKisMutationFailure(error)).toMatchObject({
      outcome: 'REJECTED',
      success: false,
    });
  });

  it.each([
    ['AUTH', 200],
    ['ACCOUNT', 1_000],
    ['ASSET', 200],
    ['ORDER', 100],
    ['ORDER_INFO', 340],
    ['STOCK', 200],
    ['MARKET_DATA', 67],
  ] as const)('applies the %s group interval of %dms', async (group, interval) => {
    mockedAxios.request.mockResolvedValue({ data: { result: {} } });

    const request = service.request(group, { method: 'GET', path: '/test' });
    await jest.advanceTimersByTimeAsync(interval - 1);
    expect(mockedAxios.request).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual({ result: {} });
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  it('serializes requests in the same group', async () => {
    mockedAxios.request.mockResolvedValue({ data: { result: {} } });

    const first = service.request('ORDER', { method: 'GET', path: '/first' });
    const second = service.request('ORDER', { method: 'GET', path: '/second' });

    await jest.advanceTimersByTimeAsync(100);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(99);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  it('does not let one group block another group', async () => {
    mockedAxios.request.mockResolvedValue({ data: { result: {} } });

    const account = service.request('ACCOUNT', { method: 'GET', path: '/account' });
    const marketData = service.request('MARKET_DATA', { method: 'GET', path: '/price' });

    await jest.advanceTimersByTimeAsync(67);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    expect(mockedAxios.request.mock.calls[0][0]).toMatchObject({ url: expect.stringContaining('/price') });
    await jest.advanceTimersByTimeAsync(933);
    await expect(Promise.all([account, marketData])).resolves.toHaveLength(2);
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  it('resolves accountSeq once and reuses the cached value', async () => {
    mockedAxios.request.mockResolvedValue({
      data: {
        result: [{ accountNo: '12345678901', accountSeq: 42, accountType: 'BROKERAGE' }],
      },
    });

    await expect(settle(service.resolveAccountSeq())).resolves.toBe(42);
    await expect(service.resolveAccountSeq()).resolves.toBe(42);

    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  it('matches a dashed configured account number to an undashed API account number', async () => {
    accountNo = '151-01-123456';
    mockedAxios.request.mockResolvedValue({
      data: {
        result: [{ accountNo: '15101123456', accountSeq: 42, accountType: 'BROKERAGE' }],
      },
    });

    await expect(settle(service.resolveAccountSeq())).resolves.toBe(42);
  });

  it('shares one account resolution request between concurrent callers', async () => {
    mockedAxios.request.mockResolvedValue({
      data: {
        result: [{ accountNo: '12345678901', accountSeq: 42, accountType: 'BROKERAGE' }],
      },
    });

    const first = service.resolveAccountSeq();
    const second = service.resolveAccountSeq();

    await expect(settle(Promise.all([first, second]))).resolves.toEqual([42, 42]);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  it('propagates the resolved accountSeq in account-scoped headers', async () => {
    mockedAxios.request.mockImplementation((config) => Promise.resolve({
      data: config.url?.endsWith('/api/v1/accounts')
        ? {
          result: [{ accountNo: '12345678901', accountSeq: 42, accountType: 'BROKERAGE' }],
        }
        : { result: [] },
    }));

    const response = service.request('ASSET', {
      method: 'GET',
      path: '/api/v1/holdings',
      query: { symbol: 'TQQQ' },
      accountScoped: true,
    });
    await expect(settle(response)).resolves.toEqual({ result: [] });

    const holdingsRequest = mockedAxios.request.mock.calls
      .map(([config]) => config)
      .find((config) => config.url?.endsWith('/api/v1/holdings'));
    expect(holdingsRequest).toMatchObject({
      method: 'GET',
      params: { symbol: 'TQQQ' },
      headers: expect.objectContaining({
        Authorization: 'Bearer access-token',
        'X-Tossinvest-Account': '42',
      }),
    });
    expect(holdingsRequest?.headers).not.toHaveProperty(
      'X-Tossinvest-Account',
      '12345678901',
    );
  });

  it.each([undefined, '  ', '---'])('fails closed when toss.accountNo has no digits (%p)', async (value) => {
    accountNo = value;

    const errorPromise = service.resolveAccountSeq().catch((error) => error);
    const error = await settle(errorPromise);

    expect(error).toEqual(new Error('Toss account resolution failed'));
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('fails closed when no account number matches', async () => {
    mockedAxios.request.mockResolvedValue({
      data: {
        result: [{ accountNo: '99999999999', accountSeq: 7, accountType: 'BROKERAGE' }],
      },
    });

    const errorPromise = service.resolveAccountSeq().catch((error) => error);
    const error = await settle(errorPromise);

    expect(error).toEqual(new Error('Toss account resolution failed'));
  });

  it('fails closed when more than one account number matches', async () => {
    mockedAxios.request.mockResolvedValue({
      data: {
        result: [
          { accountNo: '12345678901', accountSeq: 7, accountType: 'BROKERAGE' },
          { accountNo: '12345678901', accountSeq: 8, accountType: 'BROKERAGE' },
        ],
      },
    });

    const errorPromise = service.resolveAccountSeq().catch((error) => error);
    const error = await settle(errorPromise);

    expect(error).toEqual(new Error('Toss account resolution failed'));
  });

  it('fails closed when two API account numbers collide after digit normalization', async () => {
    accountNo = '151-01-123456';
    mockedAxios.request.mockResolvedValue({
      data: {
        result: [
          { accountNo: '15101123456', accountSeq: 7, accountType: 'BROKERAGE' },
          { accountNo: '151-01-123456', accountSeq: 8, accountType: 'BROKERAGE' },
        ],
      },
    });

    const errorPromise = service.resolveAccountSeq().catch((error) => error);
    const error = await settle(errorPromise);

    expect(error).toEqual(new Error('Toss account resolution failed'));
  });

  it('invalidates the token and retries one time after 401', async () => {
    auth.getAccessToken
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('fresh-token');
    mockedAxios.request
      .mockRejectedValueOnce(Object.assign(new Error('401'), { response: { status: 401 } }))
      .mockResolvedValueOnce({ data: { result: 'ok' } });

    const response = service.request('MARKET_DATA', { method: 'GET', path: '/api/v1/prices' });
    await expect(settle(response)).resolves.toEqual({ result: 'ok' });

    expect(auth.invalidateToken).toHaveBeenCalledTimes(1);
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
    expect(mockedAxios.request.mock.calls[0][0].headers).toMatchObject({
      Authorization: 'Bearer expired-token',
    });
    expect(mockedAxios.request.mock.calls[1][0].headers).toMatchObject({
      Authorization: 'Bearer fresh-token',
    });
  });

  it.each([
    ['timeout', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })],
    ['network error', Object.assign(new Error('reset'), { code: 'ECONNRESET' })],
    ['HTTP 5xx', Object.assign(new Error('unavailable'), { response: { status: 503 } })],
  ])('classifies mutation %s through the existing KIS UNKNOWN detector', async (_label, failure) => {
    mockedAxios.request.mockRejectedValue(failure);

    const errorPromise = service.request('ORDER', {
      method: 'POST',
      path: '/api/v1/orders',
      body: {},
      mutation: true,
    }).catch((error) => error);
    const error: any = await settle(errorPromise);

    expect(error).toBeInstanceOf(TossMutationError);
    expect(error).toBeInstanceOf(BrokerMutationError);
    expect(error).toMatchObject({ kind: 'TRANSPORT_UNKNOWN' });
    expect(classifyKisMutationFailure(error)).toMatchObject({ outcome: 'UNKNOWN', success: false });
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  it('classifies a malformed mutation response as UNKNOWN', async () => {
    mockedAxios.request.mockResolvedValue({ data: 'not-json' });

    const errorPromise = service.request('ORDER', {
      method: 'POST',
      path: '/api/v1/orders',
      body: {},
      mutation: true,
    }).catch((error) => error);
    const error: any = await settle(errorPromise);

    expect(error).toBeInstanceOf(TossMutationError);
    expect(classifyKisMutationFailure(error).outcome).toBe('UNKNOWN');
  });

  it('keeps an explicit mutation 4xx outside the UNKNOWN error contract', async () => {
    mockedAxios.request.mockRejectedValue(Object.assign(new Error('secret response body'), {
      response: { status: 422 },
    }));

    const errorPromise = service.request('ORDER', {
      method: 'POST',
      path: '/api/v1/orders',
      body: {},
      mutation: true,
    }).catch((error) => error);
    const error: any = await settle(errorPromise);

    expect(error).toEqual(new Error('Toss API request rejected (HTTP 422)'));
    expect(error).not.toBeInstanceOf(BrokerMutationError);
    expect(error.message).not.toContain('secret');
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });
});
