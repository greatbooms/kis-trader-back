# GitHub Actions Secrets

Configure these in:

```text
GitHub repository -> Settings -> Secrets and variables -> Actions -> Repository secrets
```

Required secrets:

| Secret | Required | Source | Purpose |
|---|---:|---|---|
| `TS_OAUTH_CLIENT_ID` | Yes | Tailscale Admin Console OAuth client | Lets GitHub Actions join the tailnet. |
| `TS_OAUTH_SECRET` | Yes | Tailscale Admin Console OAuth client | Secret for the Tailscale OAuth client. |
| `SERVER_HOST` | Yes | Tailscale machine name or 100.x IP | SSH destination for the production server. |
| `SERVER_USER` | Yes | Production server account | SSH username on the server. |
| `SERVER_SSH_KEY` | Yes | Deployment SSH private key | Private key used by GitHub Actions to SSH into the server. |
| `DEPLOY_PATH` | Yes | Chosen server path | Directory where the app is deployed, for example `/Users/name/apps/my-app`. |

Notes:

- `SERVER_*` names are recommended for new projects. If an existing workflow uses project-specific names, use the names already referenced by `.github/workflows/deploy.yml`.
- Do not put runtime env file contents in GitHub Actions Secrets for this deployment flow. Runtime env files are stored on the server under `DEPLOY_PATH` or the path defined by the deploy script.
- `SERVER_SSH_KEY` must be the private key. Its matching public key must be registered in the server user's `~/.ssh/authorized_keys`.

Workflow behavior:

- Runs on `main` branch push and manual `workflow_dispatch`.
- Connects to Tailscale with `tailscale/github-action@v4`.
- Creates `release.tar.gz`, excluding `.git`, `node_modules`, `client/node_modules`, `dist`, and `client/dist`.
- Uploads the archive and `scripts/deploy.sh` over SSH/SCP.
- Runs the remote deploy script.
- Performs a remote `/health` check using `${PORT:-8888}` from `.env.prod`.
