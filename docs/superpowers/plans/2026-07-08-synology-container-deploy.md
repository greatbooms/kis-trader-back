# Synology Container Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production deployment from Mac Studio PM2 to Synology NAS Container Manager using GHCR images and Docker Compose.

**Architecture:** GitHub Actions builds a production Docker image, pushes it to GHCR, connects to the NAS through Tailscale SSH, uploads the Compose/deploy files, and runs `docker compose pull` plus `docker compose up -d`. Runtime secrets stay on the NAS in `.env.prod`, and the container uses host networking so the app binds NAS port `20000` directly and can reach the NAS-hosted PostgreSQL port.

**Tech Stack:** GitHub Actions, GHCR, Tailscale, SSH, Docker Compose v2, Synology Container Manager, NestJS, Prisma.

## Global Constraints

- Real trading is production-sensitive; runtime `.env.prod` must stay off chat and out of committed artifacts.
- NAS application port is `20000`.
- Deployment account is `eric`; Docker must run through `sudo -n /usr/local/bin/docker`.
- Container must use the already cloned database `kis_trader_back`.
- Keep legacy PM2 files for reference until the NAS deployment proves stable.

---

### Task 1: Container Runtime

**Files:**
- Create: `.dockerignore`
- Modify: `Dockerfile`
- Create: `deploy/compose.yml`

**Interfaces:**
- Consumes: NAS runtime `.env.prod` with `DATABASE_URL`, KIS, Slack, auth, and trading env vars.
- Produces: GHCR image runnable by `docker compose` as container `kis-trader-back`.

- [x] Add `.dockerignore` so secrets, local builds, and dependencies are not copied into Docker build context.
- [x] Align Docker runtime with Node 24 and Yarn 1.
- [x] Provide a dummy build-time `DATABASE_URL` for Prisma client generation.
- [x] Expose and run the app on port `20000`.
- [x] Add `deploy/compose.yml` with `restart: unless-stopped`, `.env.prod`, host networking, `PORT=20000`, and a `/health` healthcheck.

### Task 2: NAS Deploy Script

**Files:**
- Create: `scripts/deploy-synology.sh`
- Create: `scripts/deploy-synology.spec.ts`

**Interfaces:**
- Consumes: `DEPLOY_PATH`, `IMAGE`, optional `APP_NAME`, and `/usr/local/bin/docker`.
- Produces: Updated NAS Compose project and a healthy `kis-trader-back` container.

- [x] Validate that `.env.prod` and `compose.yml` exist on the NAS before deploying.
- [x] Write `.deploy.env` containing the immutable image tag.
- [x] Run `sudo -n /usr/local/bin/docker compose pull`.
- [x] Run `sudo -n /usr/local/bin/docker compose up -d --remove-orphans`.
- [x] Poll Docker health status and print logs on failure.
- [x] Add Jest assertions covering GHCR, Synology secrets, port `20000`, and sudo Docker usage.

### Task 3: GitHub Actions Workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: GitHub secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `SYNOLOGY_HOST`, `SYNOLOGY_PORT`, `SYNOLOGY_USER`, `SYNOLOGY_SSH_KEY`, `SYNOLOGY_DEPLOY_PATH`.
- Produces: GHCR image tags `latest` and `${github.sha}`, then deploys the SHA tag to NAS.

- [x] Add `packages: write` permission.
- [x] Build and push `linux/amd64` Docker image to GHCR.
- [x] Keep Tailscale OAuth connection.
- [x] Configure SSH with the Synology host, port, user, and private key.
- [x] Upload `compose.yml` and `deploy-synology.sh` to the NAS deploy path.
- [x] Run the deploy script with the commit SHA image tag.

### Task 4: Documentation And Verification

**Files:**
- Modify: `README.md`
- Replace: `docs/deployment-guide.md`

**Interfaces:**
- Consumes: The implementation from Tasks 1-3.
- Produces: Operator instructions for NAS setup, secrets, logs, and troubleshooting.

- [x] Document port `20000` as the production port.
- [x] Document NAS `.env.prod` and GHCR login requirements.
- [x] Document Synology GitHub secrets.
- [x] Mark Mac Studio PM2 deployment as legacy.
- [ ] Run focused tests for deployment scripts.
- [ ] Run Docker build verification.
- [ ] Review `git diff` for accidental secret exposure.
