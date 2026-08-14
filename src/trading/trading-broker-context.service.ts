import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Broker, BrokerEnvironment } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { TossBrokerService } from '../toss/toss-broker.service';
import { BrokerContext } from './types/broker-context.type';

@Injectable()
export class TradingBrokerContextService {
  private readonly logger = new Logger(TradingBrokerContextService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly tossBrokerService: TossBrokerService,
  ) {}

  getCurrentContext(broker: Broker): BrokerContext {
    if (broker === Broker.TOSS) return this.getTossContext();
    if (broker !== Broker.KIS) return this.invalidConfiguration(broker);

    const configuredAccount = this.configService.get<unknown>('kis.accountNo');
    const configuredEnvironment = this.configService.get<unknown>('kis.env');
    if (typeof configuredAccount !== 'string' || typeof configuredEnvironment !== 'string') {
      return this.invalidConfiguration();
    }

    const account = configuredAccount.trim();
    if (!/^\d{8}(?:\d{2})?$/.test(account)) {
      return this.invalidConfiguration();
    }

    const normalizedEnvironment = configuredEnvironment.trim().toLowerCase();
    if (normalizedEnvironment !== 'paper' && normalizedEnvironment !== 'prod') {
      return this.invalidConfiguration();
    }

    const cano = account.slice(0, 8);
    let productCode: string;
    if (account.length === 10) {
      productCode = account.slice(8, 10);
    } else {
      const configuredProductCode = this.configService.get<unknown>('kis.prodCode');
      if (
        typeof configuredProductCode !== 'string' ||
        !/^\d{2}$/.test(configuredProductCode.trim())
      ) {
        return this.invalidConfiguration();
      }
      productCode = configuredProductCode.trim();
    }

    const effectiveAccount = `${cano}${productCode}`;
    return {
      broker: Broker.KIS,
      environment: normalizedEnvironment === 'paper' ? 'PAPER' : 'PROD',
      accountHash: createHash('sha256').update(effectiveAccount).digest('hex'),
      maskedAccount: `****${cano.slice(-4)}-${productCode}`,
    };
  }

  matchesCurrentContext(
    broker: Broker,
    environment: BrokerEnvironment | null | undefined,
    accountHash: string | null | undefined,
  ): boolean {
    if (!environment || typeof accountHash !== 'string' || !accountHash.trim()) {
      return false;
    }

    const current = this.getCurrentContext(broker);
    return current.broker === broker
      && current.environment === environment
      && current.accountHash === accountHash;
  }

  createContextBindingToken(context: BrokerContext): string {
    return createHmac('sha256', this.contextBindingSecret())
      .update(`v2\0${context.broker}\0${context.environment}\0${context.accountHash}`)
      .digest('base64url');
  }

  matchesContextBindingToken(context: BrokerContext, token: unknown): boolean {
    if (typeof token !== 'string' || !token.trim()) return false;

    const expected = Buffer.from(this.createContextBindingToken(context));
    const actual = Buffer.from(token.trim());
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private contextBindingSecret(): string {
    const configured = this.configService.get<unknown>('auth.jwtSecret');
    if (typeof configured !== 'string' || !configured.trim()) {
      this.logger.warn('Broker context binding token configuration failed');
      throw new Error('Invalid broker context binding configuration');
    }
    return configured;
  }

  private getTossContext(): BrokerContext {
    const current = this.tossBrokerService.getBrokerContext();
    const configuredAccount = this.configService.get<unknown>('toss.accountNo');
    if (
      current.broker !== Broker.TOSS
      || current.environment !== BrokerEnvironment.PROD
      || typeof current.accountHash !== 'string'
      || !current.accountHash.trim()
      || typeof configuredAccount !== 'string'
      || !configuredAccount.trim()
    ) {
      return this.invalidConfiguration(Broker.TOSS);
    }

    const account = configuredAccount.trim();
    return {
      broker: Broker.TOSS,
      environment: current.environment,
      accountHash: current.accountHash,
      maskedAccount: `****${account.slice(-4)}`,
    };
  }

  private invalidConfiguration(broker: Broker = Broker.KIS): never {
    this.logger.warn(`${broker} broker context validation failed`);
    throw new Error(`Invalid ${broker === Broker.KIS ? 'KIS' : 'Toss'} broker configuration`);
  }
}
