import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly adminUsername: string;
  private readonly adminPassword: string;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.adminUsername = this.configService.get<string>('auth.adminUsername')!;
    this.adminPassword = this.configService.get<string>('auth.adminPassword')!;
    if (!this.adminPassword) {
      throw new Error('ADMIN_PASSWORD must be configured');
    }
  }

  async login(username: string, password: string, clientKey: string): Promise<{ accessToken: string }> {
    await this.assertLoginAllowed(clientKey);

    if (username !== this.adminUsername || password !== this.adminPassword) {
      await this.recordFailedLogin(clientKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 성공 시 해당 clientKey의 누적 실패 기록 제거
    await this.prisma.loginAttempt.deleteMany({ where: { clientKey } });
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

  private async assertLoginAllowed(clientKey: string): Promise<void> {
    const attempt = await this.prisma.loginAttempt.findUnique({ where: { clientKey } });
    if (!attempt) return;

    const now = Date.now();
    if (attempt.blockedUntil && attempt.blockedUntil.getTime() > now) {
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // 윈도우 만료된 항목은 깨끗하게 정리 (실패 카운트가 다음 호출에서 다시 1부터 시작하도록)
    if (now - attempt.firstAttemptAt.getTime() > LOGIN_WINDOW_MS) {
      await this.prisma.loginAttempt.deleteMany({ where: { clientKey } });
    }
  }

  private async recordFailedLogin(clientKey: string): Promise<void> {
    const now = new Date();
    const existing = await this.prisma.loginAttempt.findUnique({ where: { clientKey } });

    if (!existing || now.getTime() - existing.firstAttemptAt.getTime() > LOGIN_WINDOW_MS) {
      await this.prisma.loginAttempt.upsert({
        where: { clientKey },
        create: {
          clientKey,
          count: 1,
          firstAttemptAt: now,
        },
        update: {
          count: 1,
          firstAttemptAt: now,
          blockedUntil: null,
        },
      });
      return;
    }

    const nextCount = existing.count + 1;
    const blockedUntil = nextCount >= MAX_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOGIN_BLOCK_MS)
      : existing.blockedUntil;

    await this.prisma.loginAttempt.update({
      where: { clientKey },
      data: { count: nextCount, blockedUntil },
    });
  }
}
