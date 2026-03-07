export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  kis: {
    appKey: process.env.KIS_APP_KEY || '',
    appSecret: process.env.KIS_APP_SECRET || '',
    accountNo: process.env.KIS_ACCOUNT_NO || '',
    prodCode: process.env.KIS_PROD_CODE || '01',
    env: (process.env.KIS_ENV || 'paper') as 'paper' | 'prod',
  },
  trading: {},
  auth: {
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    appToken: process.env.SLACK_APP_TOKEN || '',
    channel: process.env.SLACK_CHANNEL || '#trading-alerts',
    enabled: process.env.SLACK_ENABLED === 'true',
  },
});
