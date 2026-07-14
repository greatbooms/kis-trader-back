import { ConfigService } from '@nestjs/config';
import { TradingSlackActorAuthorizationService } from './trading-slack-actor-authorization.service';

describe('TradingSlackActorAuthorizationService', () => {
  let configGet: jest.Mock;
  let service: TradingSlackActorAuthorizationService;

  beforeEach(() => {
    configGet = jest.fn();
    service = new TradingSlackActorAuthorizationService(
      { get: configGet } as unknown as ConfigService,
    );
  });

  it('trims actor and configured IDs while returning the unprefixed Slack user ID', () => {
    configGet.mockReturnValue([' U123 ', 'U456']);

    expect(service.authorize('  U123  ')).toBe('U123');
    expect(configGet).toHaveBeenCalledWith('slack.approverUserIds');
  });

  it('matches configured Slack user IDs case-sensitively', () => {
    configGet.mockReturnValue(['U123']);

    expect(service.authorize('u123')).toBeNull();
    expect(service.authorize('U123')).toBe('U123');
  });

  it.each([
    undefined,
    null,
    '',
    '   ',
    123,
    {},
    [],
  ])('fails closed for a missing or invalid actor: %p', (actor) => {
    configGet.mockReturnValue(['U123']);

    expect(service.authorize(actor)).toBeNull();
  });

  it.each([
    undefined,
    null,
    'U123',
    { userIds: ['U123'] },
    [],
    ['', '   ', 123],
  ])('fails closed for an empty, missing, or non-array allowlist: %p', (allowlist) => {
    configGet.mockReturnValue(allowlist);

    expect(service.authorize('U123')).toBeNull();
  });

  it('ignores non-string allowlist entries', () => {
    configGet.mockReturnValue([123, null, {}, 'U456']);

    expect(service.authorize('U123')).toBeNull();
    expect(service.authorize('U456')).toBe('U456');
  });
});
