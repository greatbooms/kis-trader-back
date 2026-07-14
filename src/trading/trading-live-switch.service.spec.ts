import { ConfigService } from '@nestjs/config';
import { TradingLiveSwitchService } from './trading-live-switch.service';

describe('TradingLiveSwitchService', () => {
  let configGet: jest.Mock;
  let service: TradingLiveSwitchService;

  beforeEach(() => {
    configGet = jest.fn();
    service = new TradingLiveSwitchService({ get: configGet } as unknown as ConfigService);
  });

  it.each([undefined, false, 'true', 1])('is disabled unless config is boolean true: %p', (value) => {
    configGet.mockReturnValue(value);

    expect(service.isEnabled()).toBe(false);
  });

  it('is enabled for boolean true', () => {
    configGet.mockReturnValue(true);

    expect(service.isEnabled()).toBe(true);
  });

  it('reads the current ConfigService value on every call', () => {
    configGet.mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(service.isEnabled()).toBe(false);
    expect(service.isEnabled()).toBe(true);
  });

  it('blocks an action when live trading is disabled', () => {
    configGet.mockReturnValue(false);

    expect(() => service.assertEnabled('manual sell')).toThrow(
      'manual sell blocked: live trading is disabled',
    );
  });

  it('allows an action when live trading is enabled', () => {
    configGet.mockReturnValue(true);

    expect(() => service.assertEnabled('manual sell')).not.toThrow();
  });
});
