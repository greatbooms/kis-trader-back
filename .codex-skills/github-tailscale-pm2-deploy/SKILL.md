---
name: github-tailscale-pm2-deploy
description: Use this skill when helping deploy, configure, verify, or troubleshoot projects that deploy through GitHub Actions, Tailscale, SSH, a remote deploy script, PM2, build, optional migration, and health check. It explains the reusable deployment flow, required GitHub Actions secrets, server setup, and how to discover project-specific runtime environment variables without storing secret values in the skill.
---

# GitHub Tailscale PM2 Deployment

Use this skill for deployment questions, setup checks, deployment execution guidance, and deployment troubleshooting for projects that use this GitHub Actions + Tailscale + SSH + PM2 deployment pattern.

The project deploys with this flow:

```text
main push or workflow_dispatch
-> GitHub Actions
-> Tailscale OAuth connection
-> SSH to production server
-> upload release archive and scripts/deploy.sh
-> install dependencies
-> run project-specific generation/migration/build commands
-> pm2 startOrRestart with the app name from ecosystem.config.js
-> /health check
```

## Always Check

When working inside a project, inspect the deployment files first. Common locations:

- `.github/workflows/deploy.yml`
- `scripts/deploy.sh`
- `ecosystem.config.js`
- `docs/deployment-guide.md`
- `.env.example`
- `client/.env.example`
- app config files that read `process.env` or equivalent

For this beginner-friendly deployment pattern, runtime env files may be committed to a private repository and deployed inside the release archive. Do not read real environment files such as `.env`, `.env.dev`, or `.env.prod` unless the user explicitly asks and understands they may contain secrets.

Default env file roles:

- Local development uses `.env.dev`.
- Production deployment uses `.env.prod`.
- `.env.prod` is committed to the private repository and included in the deployment archive.
- The bundled deploy and PM2 templates load `.env.prod` only.

## Scaffolding A Project

When the user asks to set up this deployment pattern in a project, read `references/scaffold.md` and use the bundled templates in `assets/templates/`:

- `assets/templates/deploy.yml`
- `assets/templates/deploy.sh`
- `assets/templates/ecosystem.config.js`

Adapt the templates to the project's package manager, app name, build output, scripts, health endpoint, and env filename before writing them into the project. The templates are a starting point, not immutable files.

## Safety Rules

- Never ask the user to paste secret values into chat.
- Ask only whether a variable is present, not what its value is.
- If a private key is needed, tell the user to store it in GitHub Actions Secrets.
- Treat runtime env files, SSH private keys, API credentials, JWT/session secrets, database URLs, and access tokens as secrets.
- Prefer commands that verify presence or connectivity without printing secret values.

## GitHub Actions Secrets

For GitHub Actions setup, read `references/github-actions-secrets.md`.

Required repository secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `DEPLOY_PATH`

These are recommended generic names. If an existing workflow uses different names, follow the names in `.github/workflows/deploy.yml`. These are configured in GitHub repository settings, not in the runtime env file.

## Runtime Environment

For runtime environment setup, read `references/runtime-env.md`.

For beginner-friendly deployments, the runtime env file is committed to the private repository and deployed inside the release archive. The workflow archive step must not exclude the runtime env file.

When advising this mode, verify:

- `.gitignore` allows the intended runtime env file.
- `.github/workflows/*.yml` tar/archive command does not exclude the runtime env file.
- `scripts/deploy.sh` does not overwrite the committed env file with a server-side env file.
- local development scripts use `.env.dev`.
- deployment scripts and PM2 use `.env.prod`.
- The repository is private and repository collaborators are allowed to read the env values.

## Credential Setup

When the user asks how to issue or obtain missing deployment values, read:

- `references/tailscale.md` for Tailscale OAuth setup.
- `references/ssh-and-server.md` for SSH key, server, Node, Yarn, PM2, and database setup.

## Verification

Useful checks:

```bash
gh workflow list
gh run list --workflow deploy.yml --limit 5
pm2 list
pm2 describe <app-name>
curl http://localhost:8888/health
```

If `PORT` differs in `.env.prod`, use that port for the health check.

## Korean Reference

For human-readable Korean documentation, see `references-ko/overview.md`.
