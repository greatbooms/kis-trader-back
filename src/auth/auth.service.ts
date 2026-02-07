import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly adminUsername: string;
  private readonly adminPassword: string;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.adminUsername = this.configService.get<string>('auth.adminUsername')!;
    this.adminPassword = this.configService.get<string>('auth.adminPassword')!;
  }

  async login(username: string, password: string): Promise<{ accessToken: string }> {
    if (username !== this.adminUsername || password !== this.adminPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

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
}
