import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

type LoginAttemptState = {
  count: number;
  firstAttemptAt: number;
  blockedUntil?: number;
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly adminUsername: string;
  private readonly adminPassword: string;
  private readonly loginAttempts = new Map<string, LoginAttemptState>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.adminUsername = this.configService.get<string>('auth.adminUsername')!;
    this.adminPassword = this.configService.get<string>('auth.adminPassword')!;
    if (!this.adminPassword) {
      throw new Error('ADMIN_PASSWORD must be configured');
    }
  }

  async login(username: string, password: string, clientKey: string): Promise<{ accessToken: string }> {
    this.assertLoginAllowed(clientKey);

    if (username !== this.adminUsername || password !== this.adminPassword) {
      this.recordFailedLogin(clientKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.loginAttempts.delete(clientKey);
    const payload = { sub: 'admin', username: this.adminUsername };
    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  validateToken(payload: any): any {
    if (payload.sub === 'admin') {
      return { userId: 'admin', username: payload.username };
    }
    return null;
  }

  private assertLoginAllowed(clientKey: string): void {
    const attempt = this.loginAttempts.get(clientKey);
    if (!attempt) return;

    const now = Date.now();
    if (attempt.blockedUntil && attempt.blockedUntil > now) {
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (now - attempt.firstAttemptAt > LOGIN_WINDOW_MS) {
      this.loginAttempts.delete(clientKey);
    }
  }

  private recordFailedLogin(clientKey: string): void {
    const now = Date.now();
    const attempt = this.loginAttempts.get(clientKey);

    if (!attempt || now - attempt.firstAttemptAt > LOGIN_WINDOW_MS) {
      this.loginAttempts.set(clientKey, {
        count: 1,
        firstAttemptAt: now,
      });
      return;
    }

    attempt.count += 1;
    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
      attempt.blockedUntil = now + LOGIN_BLOCK_MS;
    }
    this.loginAttempts.set(clientKey, attempt);
  }
}
