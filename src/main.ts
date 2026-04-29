import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();

  app.use(cookieParser());
  expressApp.disable('x-powered-by');

  // /assets/*는 SPA fallback에서 제외 — 새 배포로 옛 hash 청크가 사라지면 HTML(index.html) 대신
  // 명시적 404를 돌려야 클라이언트의 vite:preloadError 자동 복구가 정상 트리거된다.
  // (NestJS ServeStaticModule 기본 동작은 정적 파일 미스 시 index.html SPA fallback이라 MIME 오류 발생.)
  // 또한 hash가 포함된 immutable 자산이므로 1년 강한 캐시를 부여.
  const clientAssetsDir = join(__dirname, '..', 'client', 'dist', 'assets');
  app.use(
    '/assets',
    express.static(clientAssetsDir, {
      fallthrough: false,
      maxAge: '1y',
      immutable: true,
    }),
  );
  app.use((req, res, next) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "form-action 'self'",
        ].join('; '),
      );
    }

    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: process.env.CORS_ORIGIN || `http://localhost:${process.env.CLIENT_PORT || 5173}`,
      credentials: true,
    });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`);
}
bootstrap();
