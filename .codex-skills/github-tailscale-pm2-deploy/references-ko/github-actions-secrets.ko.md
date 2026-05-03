# GitHub Actions Secrets

설정 위치:

```text
GitHub repository -> Settings -> Secrets and variables -> Actions -> Repository secrets
```

권장 secret 이름:

| Secret | 필수 | 출처 | 용도 |
|---|---:|---|---|
| `TS_OAUTH_CLIENT_ID` | 예 | Tailscale Admin Console OAuth client | GitHub Actions runner가 tailnet에 접속할 때 사용 |
| `TS_OAUTH_SECRET` | 예 | Tailscale Admin Console OAuth client | Tailscale OAuth client secret |
| `SERVER_HOST` | 예 | Tailscale machine name 또는 100.x IP | 운영 서버 SSH 접속 대상 |
| `SERVER_USER` | 예 | 운영 서버 계정 | SSH 사용자명 |
| `SERVER_SSH_KEY` | 예 | 배포 전용 SSH private key | GitHub Actions가 서버에 SSH 접속할 때 사용 |
| `DEPLOY_PATH` | 예 | 운영 서버의 배포 경로 | 예: `/Users/name/apps/my-app` |

주의:

- `SERVER_*`는 새 프로젝트에 권장하는 범용 이름입니다.
- 기존 workflow가 프로젝트별 secret 이름을 쓰면, `.github/workflows/*.yml`에 실제로 적힌 이름을 따라야 합니다.
- 앱 runtime env 파일 내용은 GitHub Secrets에 넣지 않는 패턴입니다.
- `SERVER_SSH_KEY`에는 private key를 넣고, 대응되는 public key는 서버 사용자의 `~/.ssh/authorized_keys`에 등록합니다.

workflow의 일반 동작:

- `main` push 또는 `workflow_dispatch`로 실행
- `tailscale/github-action@v4`로 Tailscale 접속
- `release.tar.gz` 생성
- SSH/SCP로 아카이브와 deploy script 업로드
- 원격 deploy script 실행
- `${PORT:-8888}` 또는 프로젝트 설정에 맞는 포트로 `/health` 확인
