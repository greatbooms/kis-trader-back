import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { KisAuthService } from './kis-auth.service';
import { KisApiResponse } from './types/kis-api.types';

@Injectable()
export class KisBaseService {
  private readonly logger = new Logger(KisBaseService.name);
  private lastCallTime = 0;
  private readonly rateLimitMs: number;

  constructor(
    private kisAuthService: KisAuthService,
    private configService: ConfigService,
  ) {
    const env = this.configService.get<string>('kis.env');
    this.rateLimitMs = env === 'prod' ? 50 : 500;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.rateLimitMs) {
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs - elapsed));
    }
    this.lastCallTime = Date.now();
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
    const config: AxiosRequestConfig = { headers, params };
    const response = await axios.get(url, config);

    this.checkError(response.data, path, trId);
    return response.data;
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
    const response = await axios.post(url, body, { headers });

    this.checkError(response.data, path, trId);
    return response.data;
  }

  private checkError(data: KisApiResponse, path: string, trId: string): void {
    if (data.rt_cd !== '0') {
      const msg = `KIS API error [${trId}] ${path}: ${data.msg_cd} - ${data.msg1}`;
      this.logger.error(msg);
      throw new Error(msg);
    }
  }
}
