import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TossAuthService } from './toss-auth.service';
import { TossMutationError } from './toss-mutation.error';
import type {
  TossAccount,
  TossApiGroup,
  TossApiResponse,
  TossRequestOptions,
} from './types';

const TOSS_BASE_URL = 'https://openapi.tossinvest.com';
const GROUP_INTERVAL_MS: Record<TossApiGroup, number> = {
  AUTH: 200,
  ACCOUNT: 1_000,
  ASSET: 200,
  ORDER: 100,
  ORDER_INFO: 340, // D10: 정합 확인 전까지 장중 3 TPS 기준을 종일 적용한다.
  STOCK: 200,
  MARKET_DATA: 67,
};

@Injectable()
export class TossBaseService {
  private accountSeq: number | null = null;
  private accountResolution: Promise<number> | null = null;
  private readonly queues = Object.fromEntries(
    Object.keys(GROUP_INTERVAL_MS).map((group) => [group, Promise.resolve()]),
  ) as Record<TossApiGroup, Promise<void>>;

  constructor(
    private readonly auth: TossAuthService,
    private readonly config: ConfigService,
  ) {}

  async resolveAccountSeq(): Promise<number> {
    if (this.accountSeq !== null) return this.accountSeq;
    if (!this.accountResolution) {
      this.accountResolution = this.fetchAccountSeq().finally(() => {
        this.accountResolution = null;
      });
    }
    return this.accountResolution;
  }

  async request<T>(group: TossApiGroup, options: TossRequestOptions): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = await this.buildHeaders(options.accountScoped);
      await this.rateLimit(group);

      try {
        const response = await axios.request<T>({
          method: options.method,
          url: `${TOSS_BASE_URL}${options.path}`,
          headers,
          params: options.query,
          data: options.body,
          timeout: 10_000,
        });
        if (!this.isResponseEnvelope(response.data)) {
          throw options.mutation
            ? new TossMutationError(
              'TRANSPORT_UNKNOWN',
              `Toss mutation outcome unknown: malformed response`,
            )
            : new Error('Toss API returned a malformed response');
        }
        return response.data;
      } catch (error) {
        if (error instanceof TossMutationError) throw error;

        const status = this.statusOf(error);
        if (status === 401 && attempt === 0) {
          this.auth.invalidateToken();
          continue;
        }
        if (options.mutation && (status === undefined || status >= 500)) {
          throw new TossMutationError(
            'TRANSPORT_UNKNOWN',
            `Toss mutation outcome unknown${status ? ` (HTTP ${status})` : ''}`,
          );
        }
        if (status !== undefined) {
          throw new Error(`Toss API request rejected (HTTP ${status})`);
        }
        throw new Error('Toss API request failed');
      }
    }

    throw new Error('Toss API request rejected (HTTP 401)');
  }

  private async buildHeaders(accountScoped?: boolean): Promise<Record<string, string>> {
    try {
      const accountSeq = accountScoped ? await this.resolveAccountSeq() : undefined;
      const token = await this.auth.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (accountSeq !== undefined) headers['X-Tossinvest-Account'] = String(accountSeq);
      return headers;
    } catch {
      throw new Error('Toss API request setup failed');
    }
  }

  private async fetchAccountSeq(): Promise<number> {
    const accountNo = this.config.get<string>('toss.accountNo')?.replace(/\D/g, '');
    if (!accountNo) throw new Error('Toss account resolution failed');

    const response = await this.request<TossApiResponse<TossAccount[]>>('ACCOUNT', {
      method: 'GET',
      path: '/api/v1/accounts',
    });
    if (!Array.isArray(response.result)) throw new Error('Toss account resolution failed');

    const matches = response.result.filter((account) => (
      typeof account.accountNo === 'string'
      && account.accountNo.replace(/\D/g, '') === accountNo
    ));
    if (matches.length !== 1 || !Number.isInteger(matches[0].accountSeq)) {
      throw new Error('Toss account resolution failed');
    }
    this.accountSeq = matches[0].accountSeq;
    return this.accountSeq;
  }

  private rateLimit(group: TossApiGroup): Promise<void> {
    this.queues[group] = this.queues[group].then(
      () => new Promise((resolve) => setTimeout(resolve, GROUP_INTERVAL_MS[group])),
    );
    return this.queues[group];
  }

  private statusOf(error: unknown): number | undefined {
    const status = (error as { response?: { status?: unknown } })?.response?.status;
    return typeof status === 'number' ? status : undefined;
  }

  private isResponseEnvelope(data: unknown): data is Record<'result', unknown> {
    return !!data
      && typeof data === 'object'
      && Object.prototype.hasOwnProperty.call(data, 'result');
  }
}
