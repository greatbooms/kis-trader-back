import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { KisAuthService } from './kis-auth.service';
import { KisApiResponse } from './types/kis-api.types';

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
    this.rateLimitMs = env === 'prod' ? 67 : 300; // prod: 15 req/s
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
    await this.rateLimit();
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
        const response = await axios.get(url, config);
        this.checkError(response.data, path, trId);
        return response.data;
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
    await this.rateLimit();
    const url = `${this.kisAuthService.getBaseUrl()}${path}`;
    const headers = await this.buildHeaders(trId, additionalHeaders);

    this.logger.debug(`POST ${path} [${trId}]`);
    const config: AxiosRequestConfig = {
      headers,
      timeout: 10_000,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
    };

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.post(url, body, config);
        this.checkError(response.data, path, trId);
        return response.data;
      } catch (e) {
        if (attempt < this.maxRetries && this.isRetryable(e)) {
          const delay = (attempt + 1) * 500;
          this.logger.warn(
            `Retrying POST ${path} [${trId}] after ${delay}ms (attempt ${attempt + 1}): ${this.formatHttpError(e)}`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(this.formatHttpError(e));
      }
    }

    throw new Error('Unreachable');
  }

  private checkError(data: KisApiResponse, path: string, trId: string): void {
    if (data.rt_cd !== '0') {
      const msg = `KIS API error [${trId}] ${path}: ${data.msg_cd} - ${data.msg1}`;
      this.logger.error(msg);
      throw new Error(msg);
    }
  }
}
