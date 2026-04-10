import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthPayload } from './dto/auth.object';
import { LoginInput } from './dto/login.input';
import { Request, Response } from 'express';

const COOKIE_NAME = 'access_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Resolver()
export class AuthResolver {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Mutation(() => AuthPayload)
  async login(
    @Args('input') input: LoginInput,
    @Context() ctx: { req: Request; res: Response },
  ): Promise<AuthPayload> {
    const forwardedFor = ctx.req.headers['x-forwarded-for'];
    const clientIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : ctx.req.ip;
    const forwardedProto = ctx.req.headers['x-forwarded-proto'];
    const isHttpsRequest = ctx.req.secure
      || forwardedProto === 'https'
      || (Array.isArray(forwardedProto) && forwardedProto.includes('https'));
    const configuredCookieSecure = this.configService.get<boolean | undefined>('auth.cookieSecure');
    const secureCookie = configuredCookieSecure ?? isHttpsRequest;
    const clientKey = `${clientIp || 'unknown'}:${input.username}`;
    const { accessToken } = await this.authService.login(input.username, input.password, clientKey);

    ctx.res.cookie(COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });

    return { success: true };
  }

  @Mutation(() => AuthPayload)
  logout(@Context() ctx: { res: Response }): AuthPayload {
    const configuredCookieSecure = this.configService.get<boolean | undefined>('auth.cookieSecure');
    ctx.res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: configuredCookieSecure ?? false,
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
    });

    return { success: true };
  }
}
