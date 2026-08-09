import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { KisAuthService } from './kis-auth.service';
import {
  isKisBusinessRejectionCode,
  KisMutationError,
} from './kis-mutation.error';
import { KisApiResponse } from './types/kis-api.types';
import { KisResponseWithMetadata } from './types/kis-response-metadata.type';

const RETRYABLE_ERRORS = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

@Injectable()
export class KisBaseService {
  private readonly logger = new Logger(KisBaseService.name);
  private readonly rateLimitMs: number;
  private readonly maxRetries = 2;
  private rateLimitQueue: Promise<void> = Promise.resolve();
  private readonly httpAgent = new http.Agent({ keepAlive: true, maxSockets: 5 });
  private readonly httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });

  constructor(
    private kisAuthService: KisAuthService,
    private configService: ConfigService,
  ) {
    const env = this.configService.get<string>('kis.env');
    this.rateLimitMs = env === 'prod' ? 100 : 300;
  }

  private rateLimit(): Promise<void> {
    this.rateLimitQueue = this.rateLimitQueue.then(
      () => new Promise((resolve) => setTimeout(resolve, this.rateLimitMs)),
    );
    return this.rateLimitQueue;
  }

  private async buildHeaders(trId: string, additionalHeaders?: Record<string, string>): Promise<Record<string, string>> {
    const token = await this.kisAuthService.getAccessToken();
    return {
      'Content-Type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: this.kisAuthService.getAppKey(),
      appsecret: this.kisAuthService.getAppSecret(),
      tr_id: trId,
      custtype: 'P',
      ...additionalHeaders,
    };
  }

  private isRetryable(error: any): boolean {
    const status = error?.response?.status;
    if (typeof status === 'number' && status >= 500) return true;
    if (error.code && RETRYABLE_ERRORS.has(error.code)) return true;
    const msg = error.message?.toLowerCase() ?? '';
    return msg.includes('socket hang up') || msg.includes('econnreset');
  }

  private formatHttpError(error: any): string {
    const status = error?.response?.status;
    const data = error?.response?.data;
    if (typeof status !== 'number') {
      return error?.message ?? 'Unknown error';
    }

    const msgCode = data?.msg_cd;
    const msg = data?.msg1;
    if (msgCode || msg) {
      return `${error.message} (${status}${msgCode ? `, ${msgCode}` : ''}${msg ? `, ${msg}` : ''})`;
    }
    return `${error.message} (${status})`;
  }

  async get<T = any>(
    path: string,
    trId: string,
    params: Record<string, string>,
    additionalHeaders?: Record<string, string>,
  ): Promise<KisApiResponse<T>> {
    const response = await this.getWithMetadata<T>(path, trId, params, additionalHeaders);
    return response.data;
  }

  async getWithMetadata<T = any>(
    path: string,
    trId: string,
    params: Record<string, string>,
    additionalHeaders?: Record<string, string>,
  ): Promise<KisResponseWithMetadata<KisApiResponse<T>>> {
    const url = `${this.kisAuthService.getBaseUrl()}${path}`;
    const headers = await this.buildHeaders(trId, additionalHeaders);

    this.logger.debug(`GET ${path} [${trId}]`);
    const config: AxiosRequestConfig = {
      headers,
      params,
      timeout: 10_000,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    };

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.rateLimit();
        const response = await axios.get(url, config);
        this.checkError(response.data, path, trId);
        const trCont = this.readTrCont(response.headers);
        return {
          data: response.data,
          ...(trCont ? { trCont } : {}),
        };
      } catch (e) {
        if (attempt < this.maxRetries && this.isRetryable(e)) {
          const delay = (attempt + 1) * 500;
          this.logger.warn(
            `Retrying GET ${path} [${trId}] after ${delay}ms (attempt ${attempt + 1}): ${this.formatHttpError(e)}`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(this.formatHttpError(e));
      }
    }

    throw new Error('Unreachable');
  }

  async post<T = any>(
    path: string,
    trId: string,
    body: Record<string, any>,
    additionalHeaders?: Record<string, string>,
  ): Promise<KisApiResponse<T>> {
    let url: string;
    let config: AxiosRequestConfig;
    try {
      url = `${this.kisAuthService.getBaseUrl()}${path}`;
      const headers = await this.buildHeaders(trId, additionalHeaders);

      this.logger.debug(`POST ${path} [${trId}]`);
      config = {
        headers,
        timeout: 10_000,
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
      };
    } catch {
      const message = `KIS mutation not submitted [${trId}] ${path}: request setup failed`;
      this.logger.warn(message);
      throw new KisMutationError('BUSINESS_REJECTION', message);
    }

    await this.rateLimit();
    let response;
    try {
      response = await axios.post(url, body, config);
    } catch (e) {
      const rejection = e?.response?.data;
      if (this.isBusinessRejection(rejection)) {
        throw this.businessRejectionError(rejection, path, trId);
      }
      throw new KisMutationError(
        'TRANSPORT_UNKNOWN',
        `KIS mutation outcome unknown [${trId}] ${path}: ${this.formatHttpError(e)}`,
      );
    }

    const data: unknown = response.data;
    if (!this.isKisEnvelope(data)) {
      throw new KisMutationError(
        'TRANSPORT_UNKNOWN',
        `KIS mutation outcome unknown [${trId}] ${path}: malformed response`,
      );
    }
    if (data.rt_cd !== '0') {
      if (this.isBusinessRejection(data)) {
        throw this.businessRejectionError(data, path, trId);
      }
      throw new KisMutationError(
        'TRANSPORT_UNKNOWN',
        `KIS mutation outcome unknown [${trId}] ${path}: incomplete rejection response`,
      );
    }

    return data as KisApiResponse<T>;
  }

  private readTrCont(headers: any): string | undefined {
    const value = typeof headers?.get === 'function'
      ? headers.get('tr_cont') ?? headers.get('tr-cont')
      : headers?.tr_cont ?? headers?.['tr-cont'];
    const firstValue = Array.isArray(value) ? value[0] : value;
    if (typeof firstValue !== 'string') return undefined;
    const trimmed = firstValue.trim();
    return trimmed || undefined;
  }

  private isKisEnvelope(data: unknown): data is KisApiResponse {
    return !!data
      && typeof data === 'object'
      && typeof (data as Partial<KisApiResponse>).rt_cd === 'string';
  }

  private isBusinessRejection(data: unknown): data is KisApiResponse {
    if (!this.isKisEnvelope(data) || !isKisBusinessRejectionCode(data.rt_cd)) return false;
    if (typeof data.msg_cd !== 'string' || typeof data.msg1 !== 'string') return false;
    return data.msg_cd.trim().length > 0 || data.msg1.trim().length > 0;
  }

  private businessRejectionError(data: KisApiResponse, path: string, trId: string): KisMutationError {
    const message = `KIS API rejection [${trId}] ${path}: ${data.msg_cd} - ${data.msg1}`;
    this.logger.warn(message);
    return new KisMutationError('BUSINESS_REJECTION', message, data);
  }

  private checkError(data: KisApiResponse, path: string, trId: string): void {
    if (data.rt_cd !== '0') {
      const msg = `KIS API error [${trId}] ${path}: ${data.msg_cd} - ${data.msg1}`;
      this.logger.error(msg);
      throw new Error(msg);
    }
  }
}
