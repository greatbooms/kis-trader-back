import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Broker, BrokerEnvironment } from '@prisma/client';
import { createHash } from 'crypto';
import { TradingBrokerContextService } from './trading-broker-context.service';

describe('TradingBrokerContextService', () => {
  const buildService = (values: Record<string, unknown>) => {
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    const toss = {
      getBrokerContext: jest.fn().mockReturnValue({
        broker: Broker.TOSS,
        environment: BrokerEnvironment.PROD,
        accountHash: 'authoritative-toss-account-hash',
      }),
    };

    return new (TradingBrokerContextService as any)(
      configService,
      toss,
    ) as TradingBrokerContextService;
  };

  it('resolves TOSS from its authoritative broker service and includes broker in the tuple', () => {
    const configService = {
      get: jest.fn((key: string) => key === 'toss.accountNo' ? 'account-seq' : undefined),
    } as unknown as ConfigService;
    const toss = {
      getBrokerContext: jest.fn().mockReturnValue({
        broker: Broker.TOSS,
        environment: BrokerEnvironment.PROD,
        accountHash: 'authoritative-toss-account-hash',
      }),
    };
    const service = new (TradingBrokerContextService as any)(
      configService,
      toss,
    ) as TradingBrokerContextService;

    expect((service.getCurrentContext as any)(Broker.TOSS)).toEqual({
      broker: Broker.TOSS,
      environment: BrokerEnvironment.PROD,
      accountHash: 'authoritative-toss-account-hash',
      maskedAccount: '****-seq',
    });
    expect(toss.getBrokerContext).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the authoritative TOSS broker context is unavailable', () => {
    const configService = {
      get: jest.fn((key: string) => key === 'toss.accountNo' ? 'account-seq' : undefined),
    } as unknown as ConfigService;
    const toss = {
      getBrokerContext: jest.fn(() => {
        throw new Error('TOSS session unavailable');
      }),
    };
    const service = new (TradingBrokerContextService as any)(
      configService,
      toss,
    ) as TradingBrokerContextService;

    expect(() => service.getCurrentContext(Broker.TOSS)).toThrow(
      'TOSS session unavailable',
    );
  });

  it('preserves config-derived KIS context without consulting TOSS when TOSS is disabled by default', () => {
    const values: Record<string, unknown> = {
      'trading.brokers.toss.enabled': false,
      'kis.accountNo': '12345678',
      'kis.prodCode': '01',
      'kis.env': 'paper',
    };
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const toss = { getBrokerContext: jest.fn() };
    const service = new (TradingBrokerContextService as any)(
      configService,
      toss,
    ) as TradingBrokerContextService;

    expect(service.getCurrentContext(Broker.KIS)).toEqual({
      broker: Broker.KIS,
      environment: BrokerEnvironment.PAPER,
      accountHash: createHash('sha256').update('1234567801').digest('hex'),
      maskedAccount: '****5678-01',
    });
    expect(toss.getBrokerContext).not.toHaveBeenCalled();
  });

  it('hashes the effective eight-digit CANO and configured product code', () => {
    const service = buildService({
      'kis.accountNo': '12345678',
      'kis.prodCode': '01',
      'kis.env': 'paper',
    });

    expect(service.getCurrentContext(Broker.KIS)).toEqual({
      broker: Broker.KIS,
      environment: 'PAPER',
      accountHash: createHash('sha256').update('1234567801').digest('hex'),
      maskedAccount: '****5678-01',
    });
  });

  it('uses the embedded product code for a ten-digit account', () => {
    const service = buildService({
      'kis.accountNo': '1234567899',
      'kis.prodCode': '01',
      'kis.env': 'prod',
    });

    expect(service.getCurrentContext(Broker.KIS)).toEqual({
      broker: Broker.KIS,
      environment: 'PROD',
      accountHash: createHash('sha256').update('1234567899').digest('hex'),
      maskedAccount: '****5678-99',
    });
  });

  it('does not require or use the configured fallback for a ten-digit account', () => {
    const service = buildService({
      'kis.accountNo': '1234567899',
      'kis.prodCode': 'not-a-product-code',
      'kis.env': 'prod',
    });

    expect(service.getCurrentContext(Broker.KIS).accountHash).toBe(
      createHash('sha256').update('1234567899').digest('hex'),
    );
  });

  it('distinguishes configured product codes for an eight-digit account', () => {
    const base = {
      'kis.accountNo': '12345678',
      'kis.env': 'paper',
    };

    const first = buildService({ ...base, 'kis.prodCode': '01' }).getCurrentContext(Broker.KIS);
    const second = buildService({ ...base, 'kis.prodCode': '02' }).getCurrentContext(Broker.KIS);

    expect(first.accountHash).not.toBe(second.accountHash);
    expect(first.maskedAccount).toBe('****5678-01');
    expect(second.maskedAccount).toBe('****5678-02');
  });

  it('distinguishes paper and production through the context tuple', () => {
    const base = {
      'kis.accountNo': '1234567801',
      'kis.prodCode': '01',
    };

    const paper = buildService({ ...base, 'kis.env': 'paper' }).getCurrentContext(Broker.KIS);
    const prod = buildService({ ...base, 'kis.env': 'prod' }).getCurrentContext(Broker.KIS);

    expect(paper).toEqual({ ...prod, environment: 'PAPER' });
    expect(prod.environment).toBe('PROD');
  });

  it('matches only the exact stored broker environment and account hash', () => {
    const service = buildService({
      'kis.accountNo': '1234567801',
      'kis.prodCode': '01',
      'kis.env': 'prod',
    });
    const current = service.getCurrentContext(Broker.KIS);

    expect(service.matchesCurrentContext(Broker.KIS, 'PROD', current.accountHash)).toBe(true);
    expect(service.matchesCurrentContext(Broker.KIS, 'PAPER', current.accountHash)).toBe(false);
    expect(service.matchesCurrentContext(Broker.KIS, 'PROD', 'different-account-hash')).toBe(false);
    expect(service.matchesCurrentContext(Broker.KIS, null, current.accountHash)).toBe(false);
    expect(service.matchesCurrentContext(Broker.KIS, 'PROD', null)).toBe(false);
  });

  it('creates an opaque binding token that matches only the captured broker context', () => {
    const service = buildService({
      'kis.accountNo': '1234567801',
      'kis.prodCode': '01',
      'kis.env': 'prod',
      'auth.jwtSecret': 'test-only-context-binding-secret',
    });
    const current = service.getCurrentContext(Broker.KIS);

    const token = service.createContextBindingToken(current);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(current.accountHash);
    expect(service.matchesContextBindingToken(current, token)).toBe(true);
    expect(service.matchesContextBindingToken(
      { ...current, environment: 'PAPER' },
      token,
    )).toBe(false);
    expect(service.matchesContextBindingToken(
      { ...current, accountHash: 'different-account-hash' },
      token,
    )).toBe(false);
    expect(service.matchesContextBindingToken(
      { ...current, broker: Broker.TOSS },
      token,
    )).toBe(false);
    expect(service.matchesContextBindingToken(current, 'malformed')).toBe(false);
  });

  it.each([
    ['', '01', 'paper'],
    ['1234567', '01', 'paper'],
    ['123456789', '01', 'paper'],
    ['1234-5678', '01', 'paper'],
    ['12345678', '', 'paper'],
    ['12345678', '1', 'paper'],
    ['12345678', '0x', 'paper'],
    ['12345678', '01', 'sandbox'],
  ])('fails closed for invalid broker configuration', (accountNo, prodCode, environment) => {
    const service = buildService({
      'kis.accountNo': accountNo,
      'kis.prodCode': prodCode,
      'kis.env': environment,
    });

    expect(() => service.getCurrentContext(Broker.KIS)).toThrow('Invalid KIS broker configuration');
  });

  it('never exposes the raw account through returns, errors, or log arguments', () => {
    const rawAccount = '8765432101';
    const logSpies = (['debug', 'log', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
    );

    try {
      const validContext = buildService({
        'kis.accountNo': rawAccount,
        'kis.prodCode': '99',
        'kis.env': 'prod',
      }).getCurrentContext(Broker.KIS);

      expect(JSON.stringify(validContext)).not.toContain(rawAccount);

      const invalidService = buildService({
        'kis.accountNo': `${rawAccount}7`,
        'kis.prodCode': '99',
        'kis.env': 'prod',
      });
      let thrown: unknown;
      try {
        invalidService.getCurrentContext(Broker.KIS);
      } catch (error) {
        thrown = error;
      }

      expect(String(thrown)).not.toContain(rawAccount);
      expect(JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls))).not.toContain(
        rawAccount,
      );
    } finally {
      logSpies.forEach((spy) => spy.mockRestore());
    }
  });
});
