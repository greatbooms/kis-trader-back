# Runtime Environment

This skill should not hard-code application-specific environment variables.

Runtime variables are project-specific. Discover them from the target repository instead of relying on a fixed list.

## Where To Look

Prefer non-secret examples and source code:

- `.env.example`
- `.env.sample`
- `client/.env.example`
- deployment docs
- config files that read `process.env`
- framework config files
- PM2 ecosystem files
- Dockerfile or compose files

For this beginner-friendly deployment pattern, runtime env files may be committed to a private repository and deployed inside the release archive. Do not read real env files such as `.env`, `.env.dev`, or `.env.prod` unless the user explicitly asks and understands they may contain secrets.

## Env File Roles

Use this convention by default:

- `.env.dev` is for local development.
- `.env.prod` is for production deployment.
- `.env.prod` is committed to the private repository for beginner-friendly deployment.
- `.env.prod` must be included in the release archive.
- The deploy script and PM2 config load `.env.prod`.
- Local development scripts should load `.env.dev`.

If local development scripts are missing, recommend package scripts that explicitly load `.env.dev`. Example for Node/Nest-style projects:

```json
{
  "scripts": {
    "start:dev": "set -a; source .env.dev; set +a; npm run dev",
    "start:prod": "set -a; source .env.prod; set +a; node dist/main"
  }
}
```

Adapt the command to the project's framework and package manager.

## What To Tell The User

When summarizing runtime env requirements:

- List variable names only.
- Explain where each variable is expected to be set.
- Explain whether it is required, optional, or only needed for a feature.
- Explain how to obtain credentials at a high level.
- Do not ask the user to paste secret values into chat.

## Default Pattern: Env File In Git

For beginner-friendly deployments, keep the runtime env file in the private repository so every deployment ships the required environment together with the code.

Default behavior to enforce:

- The runtime env file, such as `.env.prod`, is committed to git.
- `.env.dev` is kept for local development and is not used by deployment.
- `.gitignore` must not exclude the runtime env file intended for deployment.
- The GitHub Actions tar/archive command must not exclude the runtime env file.
- The release archive includes the runtime env file.
- The remote deploy script extracts the env file together with the rest of the release.

Security conditions:

- The repository must be private.
- Anyone with repository access can read the env values.
- Exposed credentials must be rotated if the repo or git history leaks.
- Avoid personal tokens where possible; use deploy/app-specific credentials.

## Deployment Behavior

If `.env.prod` or another runtime env file is committed to git and not excluded by the archive step:

- It is included in the release archive.
- The archive is uploaded to the server.
- The remote deploy script extracts it.
- The env file arrives under the release directory inside `DEPLOY_PATH`.

## Prevent Server Env From Overriding Git Env

Many deploy scripts preserve a server-side env file by copying `${DEPLOY_PATH}/.env.prod` into the new release after extraction. That is useful for advanced deployments, but it can break the beginner-friendly env-in-git mode.

For this skill's default mode:

- Do not create a separate server-side env file unless the deploy script requires it.
- If the deploy script copies a server-side env over the extracted env, modify the script so the committed env file is the source of truth.
- Keep `.env.example` as documentation even when the real runtime env file is committed.

## Advanced Alternative: Server-Side Env

For more secure or team-managed deployments, production runtime variables can be stored only on the server, usually:

```text
${DEPLOY_PATH}/.env.prod
```

In that alternative mode, the deploy script copies the existing server env file into each new release, so secrets are not committed and are not stored in GitHub Actions.

Do not use this alternative as the default for beginner-friendly projects.

## Useful Discovery Commands

Use commands like these inside the target repo:

```bash
rg --files -g '.env*' -g '!node_modules'
rg 'process\.env|PORT|API_KEY|SECRET|TOKEN|URL' .
```

Adjust the search patterns to the project's language and framework.
