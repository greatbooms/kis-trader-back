# Scaffolding A New Project

Use this when a user asks to set up this deployment pattern in a project.

## Default Assumptions

- The project is in a private GitHub repository.
- Runtime env is committed to git for beginner-friendly deployment.
- Local development uses `.env.dev`; production deployment uses `.env.prod`.
- The workflow must not exclude the runtime env file from the release archive.
- GitHub Secrets use the generic names:
  - `TS_OAUTH_CLIENT_ID`
  - `TS_OAUTH_SECRET`
  - `SERVER_HOST`
  - `SERVER_USER`
  - `SERVER_SSH_KEY`
  - `DEPLOY_PATH`
- The server runs Node.js, Yarn, PM2, SSH, and Tailscale.

## Files To Create

Copy and adapt these templates from `assets/templates/`:

- `deploy.yml` -> `.github/workflows/deploy.yml`
- `deploy.sh` -> `scripts/deploy.sh`
- `ecosystem.config.js` -> `ecosystem.config.js`

After copying `deploy.sh`, ensure it is executable:

```bash
chmod +x scripts/deploy.sh
```

## Required Adaptation

Before writing files into the project:

- Detect the package manager. The template assumes Yarn 1.x.
- Detect the app build output. The PM2 template assumes `dist/main.js`.
- Detect the app name and replace `my-app`.
- Detect whether a `client/` app exists.
- Detect build, migration, and generation scripts from `package.json`.
- Confirm the health endpoint and port. The template assumes `/health` and `${PORT:-8888}`.
- Confirm the runtime env filename. The template assumes `.env.prod`.
- Confirm or add local development scripts that load `.env.dev`.
- Keep logs outside the swapped release directory. The template derives persistent logs from `DEPLOY_PATH` as `${DEPLOY_PATH}_shared/logs`.

## Env-In-Git Requirements

For the default beginner mode:

- Ensure the intended runtime env file is not ignored by `.gitignore`.
- Ensure `.github/workflows/deploy.yml` does not exclude it in the `tar` command.
- Ensure `scripts/deploy.sh` does not copy a server-side env file over the extracted env file.
- Ensure deployment uses `.env.prod`, not `.env.dev`.
- Ensure local development uses `.env.dev`, not `.env.prod`.
- If a project currently has server-side env preservation logic, remove or change it so the committed env file is the source of truth.

## User Instructions After Scaffolding

Tell the user to set these GitHub Actions repository secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `DEPLOY_PATH`

Tell the user to prepare the server:

- Install Node.js 20+ or the project-required runtime.
- Install Yarn 1.x if the project uses Yarn.
- Install PM2.
- Allow PM2 to install `pm2-logrotate`, or preinstall it.
- Enable SSH.
- Install and connect Tailscale.
- Create the `DEPLOY_PATH` directory.

Logging behavior:

- Deploy log: `${DEPLOY_PATH}_shared/logs/deploy.log`
- PM2 logs: `${DEPLOY_PATH}_shared/logs/pm2/`
- No `PM2_LOG_DIR` GitHub Secret is needed unless the user wants a custom path.
- `pm2-logrotate` is installed/configured by `scripts/deploy.sh` with defaults: max size `10M`, retain `14`, compress `true`.

Do not ask the user to paste secret values into chat.
