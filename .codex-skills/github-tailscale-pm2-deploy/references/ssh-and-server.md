# SSH And Server Setup

The deployment server must be reachable over Tailscale SSH/port 22 from the GitHub Actions runner after the runner joins the tailnet.

## Required Server Software

- Node.js 20+
- Yarn 1.x
- PostgreSQL 15+ or another reachable PostgreSQL service
- PM2
- PM2 logrotate module
- Tailscale
- SSH server enabled

Install PM2:

```bash
npm install -g pm2
```

The deploy script installs and configures `pm2-logrotate` automatically if it is missing. To preinstall it manually:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 save
```

## Deployment Directory

Choose a persistent path and use it as GitHub secret `DEPLOY_PATH`, for example:

```text
/Users/name/apps/my-app
```

Create it on the server:

```bash
mkdir -p /Users/name/apps/my-app
```

If the project uses the common env-file pattern, place production runtime variables at the path expected by its deploy script, for example:

```text
/Users/name/apps/my-app/.env.prod
```

For other projects, inspect the remote deploy script before assuming the env filename or location.

## SSH Key Setup

Create or choose a deployment-only SSH key pair. The private key goes into GitHub Actions Secrets as `SERVER_SSH_KEY` or the name used by the workflow; the public key goes into the server user's `~/.ssh/authorized_keys`.

Recommended properties:

- Dedicated to this deployment.
- No passphrase, unless the workflow is changed to handle passphrases.
- Limited to the deployment server account where practical.

Server-side setup:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Append the public key to `~/.ssh/authorized_keys`.

## PM2 Runtime

The app is managed by:

```bash
pm2 startOrRestart ecosystem.config.js --only <app-name> --update-env
pm2 save
```

Useful checks:

```bash
pm2 list
pm2 describe <app-name>
pm2 logs <app-name>
```

Logs:

- Deploy log: `${DEPLOY_PATH}_shared/logs/deploy.log`
- PM2 app logs: `${DEPLOY_PATH}_shared/logs/pm2/pm2.out.log` and `${DEPLOY_PATH}_shared/logs/pm2/pm2.error.log`
- `scripts/deploy.sh` derives the persistent log path from `DEPLOY_PATH`, so a separate `PM2_LOG_DIR` secret is not required.
- The deployed release gets a `logs` symlink pointing to the persistent log directory.

Why logs are outside `DEPLOY_PATH`:

- This deployment pattern swaps `${DEPLOY_PATH}` on every successful release.
- Anything stored directly inside `${DEPLOY_PATH}` can disappear when the old release is removed.
- Persistent logs should live next to the release directory, not inside it.

PM2 log rotation is part of the default setup:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 save
```

The deploy script also applies these settings automatically. Override with `PM2_LOGROTATE_MAX_SIZE`, `PM2_LOGROTATE_RETAIN`, or `PM2_LOGROTATE_COMPRESS` only if needed.
