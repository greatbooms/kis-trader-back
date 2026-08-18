import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { TossTokenResponse } from './types/toss-auth.type';

const TOSS_BASE_URL = 'https://openapi.tossinvest.com';
const REFRESH_MARGIN_MS = 60_000;

@Injectable()
export class TossAuthService {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private issuance: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - REFRESH_MARGIN_MS) {
      return this.accessToken;
    }

    if (!this.issuance) {
      this.issuance = this.issueToken().finally(() => {
        this.issuance = null;
      });
    }
    return this.issuance;
  }

  invalidateToken(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private async issueToken(): Promise<string> {
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.get<string>('toss.clientId') || '',
        client_secret: this.config.get<string>('toss.clientSecret') || '',
      });
      const response = await axios.post<TossTokenResponse>(
        `${TOSS_BASE_URL}/oauth2/token`,
        body,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      );
      const token = response.data?.access_token?.trim();
      const expiresIn = response.data?.expires_in;
      if (
        !token
        || response.data?.token_type !== 'Bearer'
        || !Number.isFinite(expiresIn)
        || expiresIn <= 0
      ) {
        throw new Error('Malformed token response');
      }

      this.accessToken = token;
      this.expiresAt = Date.now() + expiresIn * 1_000;
      return token;
    } catch {
      throw new Error('Toss OAuth2 token request failed');
    }
  }
}
