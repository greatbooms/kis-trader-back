import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TossAuthService } from './toss-auth.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TossAuthService', () => {
  let service: TossAuthService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    jest.resetAllMocks();

    const config = {
      get: jest.fn((key: string) => ({
        'toss.clientId': 'client-id',
        'toss.clientSecret': 'client-secret',
      })[key]),
    } as unknown as ConfigService;
    service = new TossAuthService(config);
  });

  afterEach(() => jest.useRealTimers());

  function tokenResponse(accessToken: string, expiresIn = 86_399) {
    return {
      data: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
      },
    };
  }

  it('caches a valid token and sends the documented form body', async () => {
    mockedAxios.post.mockResolvedValue(tokenResponse('token-1'));

    await expect(service.getAccessToken()).resolves.toBe('token-1');
    await expect(service.getAccessToken()).resolves.toBe('token-1');

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://openapi.tossinvest.com/oauth2/token',
      expect.any(URLSearchParams),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    expect(String(mockedAxios.post.mock.calls[0][1])).toBe(
      'grant_type=client_credentials&client_id=client-id&client_secret=client-secret',
    );
  });

  it('reissues the token at the 60-second expiry margin', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(tokenResponse('token-1', 120))
      .mockResolvedValueOnce(tokenResponse('token-2', 120));

    await expect(service.getAccessToken()).resolves.toBe('token-1');
    jest.advanceTimersByTime(59_999);
    await expect(service.getAccessToken()).resolves.toBe('token-1');
    jest.advanceTimersByTime(1);
    await expect(service.getAccessToken()).resolves.toBe('token-2');

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight issuance across concurrent callers', async () => {
    let resolveRequest!: (value: ReturnType<typeof tokenResponse>) => void;
    mockedAxios.post.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const first = service.getAccessToken();
    const second = service.getAccessToken();
    const third = service.getAccessToken();
    await Promise.resolve();

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    resolveRequest(tokenResponse('shared-token'));
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      'shared-token',
      'shared-token',
      'shared-token',
    ]);
  });

  it('invalidates a cached token', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(tokenResponse('token-2'));

    await service.getAccessToken();
    service.invalidateToken();

    await expect(service.getAccessToken()).resolves.toBe('token-2');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('throws a sanitized error and allows a later retry', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(new Error('request exposed client-secret'))
      .mockResolvedValueOnce(tokenResponse('token-2'));

    const error = await service.getAccessToken().catch((reason) => reason);
    expect(error).toEqual(new Error('Toss OAuth2 token request failed'));
    expect(error.message).not.toContain('client-secret');
    await expect(service.getAccessToken()).resolves.toBe('token-2');
  });
});
