import { ConfigService } from '@nestjs/config';
import configuration from '../src/config/configuration';
import { TossAuthService } from '../src/toss/toss-auth.service';
import { TossBaseService } from '../src/toss/toss-base.service';
import type {
  TossApiResponse,
  TossHoldingsOverview,
} from '../src/toss/types';

async function runStep<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    const result = await action();
    console.log(`${name}: success`);
    return result;
  } catch {
    console.error(`${name}: failure`);
    throw new Error(`${name} failed`);
  }
}

async function main(): Promise<void> {
  const config = new ConfigService(configuration());
  const auth = new TossAuthService(config);
  const base = new TossBaseService(auth, config);

  await runStep('token', () => auth.getAccessToken());
  await runStep('accounts', () => base.resolveAccountSeq());
  await runStep('holdings', () => base.request<TossApiResponse<TossHoldingsOverview>>('ASSET', {
    method: 'GET',
    path: '/api/v1/holdings',
    accountScoped: true,
  }));
  await runStep('prices', () => base.request<TossApiResponse<unknown>>('MARKET_DATA', {
    method: 'GET',
    path: '/api/v1/prices',
    query: { symbols: 'TQQQ' },
  }));
}

main().catch(() => {
  process.exitCode = 1;
});
