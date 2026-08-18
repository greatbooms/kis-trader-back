export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  kis: {
    appKey: process.env.KIS_APP_KEY || '',
    appSecret: process.env.KIS_APP_SECRET || '',
    accountNo: process.env.KIS_ACCOUNT_NO || '',
    prodCode: process.env.KIS_PROD_CODE || '01',
    env: (process.env.KIS_ENV || 'paper') as 'paper' | 'prod',
    debugRawBalance: process.env.KIS_DEBUG_RAW_BALANCE === 'true',
  },
  toss: {
    clientId: process.env.TOSS_CLIENT_ID || '',
    clientSecret: process.env.TOSS_CLIENT_SECRET || '',
    accountNo: process.env.TOSS_ACCOUNT_NO || '',
  },
  openDart: {
    apiKey: process.env.OPENDART_API_KEY || '',
  },
  sec: {
    userAgent: process.env.SEC_USER_AGENT || '',
  },
  fred: {
    apiKey: process.env.FRED_API_KEY || '',
  },
  trading: {
    enabled: process.env.TRADING_ENABLED?.trim().toLowerCase() === 'true',
    brokers: {
      kis: {
        enabled: process.env.TRADING_BROKER_KIS_ENABLED === undefined
          ? true
          : process.env.TRADING_BROKER_KIS_ENABLED.trim().toLowerCase() === 'true',
      },
      toss: {
        enabled: process.env.TRADING_BROKER_TOSS_ENABLED?.trim().toLowerCase() === 'true',
      },
    },
  },
  auth: {
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    jwtSecret: process.env.JWT_SECRET || '',
    cookieSecure:
      process.env.AUTH_COOKIE_SECURE === undefined
        ? undefined
        : process.env.AUTH_COOKIE_SECURE === 'true',
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    appToken: process.env.SLACK_APP_TOKEN || '',
    channel: process.env.SLACK_CHANNEL || '#trading-alerts',
    enabled: process.env.SLACK_ENABLED === 'true',
    approverUserIds: Array.from(new Set(
      (process.env.SLACK_APPROVER_USER_IDS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    )),
  },
});
