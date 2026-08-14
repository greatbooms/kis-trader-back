import configuration from './configuration';

describe('trading.enabled', () => {
  afterEach(() => delete process.env.TRADING_ENABLED);

  it.each([undefined, '', 'false', '1', 'yes'])('is disabled for %p', (value) => {
    if (value !== undefined) process.env.TRADING_ENABLED = value;
    expect(configuration().trading.enabled).toBe(false);
  });

  it.each(['true', ' TRUE ', 'True'])('is enabled only for normalized true: %s', (value) => {
    process.env.TRADING_ENABLED = value;
    expect(configuration().trading.enabled).toBe(true);
  });
});

describe('trading.brokers', () => {
  afterEach(() => {
    delete process.env.TRADING_BROKER_KIS_ENABLED;
    delete process.env.TRADING_BROKER_TOSS_ENABLED;
  });

  it('keeps KIS active and Toss inactive by default', () => {
    expect(configuration().trading.brokers).toEqual({
      kis: { enabled: true },
      toss: { enabled: false },
    });
  });

  it.each(['', '   ', 'false', '1', 'yes'])(
    'fails closed for malformed KIS enable value %p',
    (value) => {
      process.env.TRADING_BROKER_KIS_ENABLED = value;

      expect(configuration().trading.brokers.kis.enabled).toBe(false);
    },
  );

  it.each([
    ['TRADING_BROKER_KIS_ENABLED', 'false', false],
    ['TRADING_BROKER_TOSS_ENABLED', 'true', true],
    ['TRADING_BROKER_TOSS_ENABLED', ' TRUE ', true],
  ])('normalizes %s=%s', (name, value, expected) => {
    process.env[name] = value;

    const brokers = configuration().trading.brokers;
    expect(name === 'TRADING_BROKER_KIS_ENABLED' ? brokers.kis.enabled : brokers.toss.enabled).toBe(expected);
  });
});

describe('slack.approverUserIds', () => {
  afterEach(() => delete process.env.SLACK_APPROVER_USER_IDS);

  it.each([undefined, '', '   ', ',,'])('is fail-closed for %p', (value) => {
    if (value !== undefined) process.env.SLACK_APPROVER_USER_IDS = value;
    expect(configuration().slack.approverUserIds).toEqual([]);
  });

  it('trims, filters, and de-duplicates comma-separated Slack user IDs', () => {
    process.env.SLACK_APPROVER_USER_IDS = ' U123, U456, U123, ,U789 ';

    expect(configuration().slack.approverUserIds).toEqual(['U123', 'U456', 'U789']);
  });
});

describe('toss', () => {
  afterEach(() => {
    delete process.env.TOSS_CLIENT_ID;
    delete process.env.TOSS_CLIENT_SECRET;
    delete process.env.TOSS_ACCOUNT_NO;
  });

  it('defaults credentials and account to empty strings', () => {
    expect(configuration().toss).toEqual({
      clientId: '',
      clientSecret: '',
      accountNo: '',
    });
  });

  it('maps Toss environment variables', () => {
    process.env.TOSS_CLIENT_ID = 'client-id';
    process.env.TOSS_CLIENT_SECRET = 'client-secret';
    process.env.TOSS_ACCOUNT_NO = 'account-no';

    expect(configuration().toss).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      accountNo: 'account-no',
    });
  });
});
