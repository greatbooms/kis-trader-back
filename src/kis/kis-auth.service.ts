import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { KIS_BASE_URLS, KisEnv } from './types/kis-config.types';
import { PrismaService } from '../prisma.service';

@Injectable()
export class KisAuthService implements OnModuleInit {
  private readonly logger = new Logger(KisAuthService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private appKey: string;
  private appSecret: string;
  private kisEnv: KisEnv;
  private baseUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
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

    // 메모리에 없으면 DB에서 로드 시도
    const saved = await this.loadTokenFromDb();
    if (saved) {
      this.accessToken = saved.accessToken;
      this.tokenExpiry = saved.expiresAt;
      this.logger.log('KIS access token loaded from DB (reused)');
      return;
    }

    // DB에도 없거나 만료됐으면 새로 발급
    await this.issueToken();
  }

  private async loadTokenFromDb(): Promise<{ accessToken: string; expiresAt: Date } | null> {
    try {
      const token = await this.prisma.kisToken.findUnique({
        where: { id: 'kis_access_token' },
      });
      if (token && new Date() < token.expiresAt) {
        return { accessToken: token.accessToken, expiresAt: token.expiresAt };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async saveTokenToDb(accessToken: string, expiresAt: Date): Promise<void> {
    try {
      await this.prisma.kisToken.upsert({
        where: { id: 'kis_access_token' },
        update: { accessToken, expiresAt },
        create: { id: 'kis_access_token', accessToken, expiresAt },
      });
    } catch (e) {
      this.logger.warn(`Failed to save token to DB: ${e.message}`);
    }
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
    // KIS API 응답의 access_token_token_expired (KST, "yyyy-MM-dd HH:mm:ss" 형식) 사용
    const expiredStr: string = response.data.access_token_token_expired;
    this.tokenExpiry = new Date(expiredStr.replace(' ', 'T') + '+09:00');

    await this.saveTokenToDb(this.accessToken!, this.tokenExpiry);
    this.logger.log(`KIS access token issued (expires: ${expiredStr} KST)`);
  }
}
