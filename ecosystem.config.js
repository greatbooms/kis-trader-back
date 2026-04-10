const path = require('path');

const defaultLogDir = '/Users/shinsanghoon/workspace/script/logs/kis-trader-back';
const pm2LogDir = process.env.PM2_LOG_DIR || defaultLogDir;

module.exports = {
  apps: [
    {
      name: 'kis-trader-back',
      cwd: __dirname,
      script: 'dist/main.js',
      interpreter: 'node',
      node_args: '-r dotenv/config',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        DOTENV_CONFIG_PATH: path.join(__dirname, '.env.prod'),
        PM2_LOG_DIR: pm2LogDir,
      },
      out_file: path.join(pm2LogDir, 'pm2.out.log'),
      error_file: path.join(pm2LogDir, 'pm2.error.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
