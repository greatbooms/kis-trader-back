module.exports = {
  apps: [
    {
      name: 'kis-trader-back',
      cwd: '/Users/shinsanghoon/workspace/kis-trader-back',
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
        DOTENV_CONFIG_PATH: '/Users/shinsanghoon/workspace/kis-trader-back/.env.prod',
      },
      out_file: '/Users/shinsanghoon/workspace/script/logs/kis-trader-back/pm2.out.log',
      error_file: '/Users/shinsanghoon/workspace/script/logs/kis-trader-back/pm2.error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
