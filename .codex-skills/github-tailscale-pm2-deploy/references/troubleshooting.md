# Troubleshooting

Use this file when a deployment check fails.

## GitHub Actions Cannot Reach Server

Check:

- `TS_OAUTH_CLIENT_ID` exists.
- `TS_OAUTH_SECRET` exists.
- OAuth client has the required auth key permissions.
- `tag:ci` is allowed.
- `SERVER_HOST` is the server's Tailscale hostname or `100.x.x.x` IP. If the workflow uses another secret name, check that name instead.
- SSH port 22 is reachable over Tailscale.

Useful workflow-side checks:

```bash
tailscale status
tailscale ping <SERVER_HOST>
nc -zvw3 <SERVER_HOST> 22
```

## SSH Auth Fails

Check:

- `SERVER_USER` is the correct server username. If the workflow uses another secret name, check that name instead.
- `SERVER_SSH_KEY` is the private key, not the public key.
- The public key is in the server user's `~/.ssh/authorized_keys`.
- `~/.ssh` permissions are not too open.

## Migration Fails

Check:

- The project's database connection variable exists in the runtime env file used by the deploy script.
- The database is reachable from the server.
- The database user can create/alter the project schema.

Command:

```bash
cd ${DEPLOY_PATH}
yarn prisma:migrate:prod
```

## Build Fails

Check:

- Node.js is 20+.
- Yarn 1.x is installed.
- `yarn install --frozen-lockfile` works in both root and `client/`.
- Generated Prisma client is current.

## PM2 Starts But App Is Unhealthy

Check:

```bash
pm2 list
pm2 describe <app-name>
pm2 logs <app-name> --lines 200
pm2 module:list
pm2 conf pm2-logrotate
tail -n 200 ${DEPLOY_PATH}_shared/logs/deploy.log
ls -la ${DEPLOY_PATH}_shared/logs/pm2
curl http://localhost:${PORT:-8888}/health
```

Common causes:

- Missing required runtime env variables.
- Bad database connection env.
- App listening on a different `PORT`.
- Runtime env file was not present where the deploy script expects it.
