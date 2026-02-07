import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { KIS_BASE_URLS, KisEnv } from './types/kis-config.types';

@Injectable()
export class KisAuthService implements OnModuleInit {
  private readonly logger = new Logger(KisAuthService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private appKey: string;
  private appSecret: string;
  private kisEnv: KisEnv;
  private baseUrl: string;

  constructor(private configService: ConfigService) {
    this.appKey = this.configService.get<string>('kis.appKey')!;
    this.appSecret = this.configService.get<string>('kis.appSecret')!;
    this.kisEnv = this.configService.get<KisEnv>('kis.env')!;
    this.baseUrl = KIS_BASE_URLS[this.kisEnv];
  }

  async onModuleInit() {
    if (this.appKey && this.appSecret) {
      try {
        await this.ensureToken();
        this.logger.log(`KIS Auth initialized (env: ${this.kisEnv})`);
      } catch (e) {
        this.logger.warn(`KIS Auth init failed: ${e.message}. Will retry on first API call.`);
      }
    } else {
      this.logger.warn('KIS API credentials not configured. Set KIS_APP_KEY and KIS_APP_SECRET.');
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getAppKey(): string {
    return this.appKey;
  }

  getAppSecret(): string {
    return this.appSecret;
  }

  getKisEnv(): KisEnv {
    return this.kisEnv;
  }

  async getAccessToken(): Promise<string> {
    await this.ensureToken();
    return this.accessToken!;
  }

  private async ensureToken(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return;
    }
    await this.issueToken();
  }

  private async issueToken(): Promise<void> {
    const url = `${this.baseUrl}/oauth2/tokenP`;
    const body = {
      grant_type: 'client_credentials',
      appkey: this.appKey,
      appsecret: this.appSecret,
    };

    this.logger.log('Requesting KIS access token...');
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
    });

    this.accessToken = response.data.access_token;
    // 토큰은 24시간 유효, 안전하게 23시간 후 갱신
    this.tokenExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);
    this.logger.log('KIS access token issued successfully');
  }
}
