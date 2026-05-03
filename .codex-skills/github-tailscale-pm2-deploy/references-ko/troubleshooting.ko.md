# Troubleshooting

배포가 실패하면 실패 위치를 먼저 나눠서 봅니다.

## GitHub Actions가 서버에 연결하지 못함

확인:

- `TS_OAUTH_CLIENT_ID`가 있는지
- `TS_OAUTH_SECRET`이 있는지
- OAuth client에 auth key 관련 권한이 있는지
- workflow가 `tag:ci`를 쓰면 해당 tag 사용이 가능한지
- `SERVER_HOST`가 서버의 Tailscale hostname 또는 `100.x.x.x` IP인지
- SSH 22번 포트가 tailnet에서 접근 가능한지

확인 명령 예:

```bash
tailscale status
tailscale ping <SERVER_HOST>
nc -zvw3 <SERVER_HOST> 22
```

## SSH 인증 실패

확인:

- `SERVER_USER`가 올바른 서버 사용자명인지
- `SERVER_SSH_KEY`가 public key가 아니라 private key인지
- 대응되는 public key가 서버 사용자의 `~/.ssh/authorized_keys`에 등록되어 있는지
- `~/.ssh` 권한이 너무 열려 있지 않은지

## Migration 실패

확인:

- 프로젝트의 DB 접속 env가 runtime env 파일에 있는지
- 운영 서버에서 DB에 접속 가능한지
- DB 사용자가 migration에 필요한 권한을 갖고 있는지
- migration 명령은 프로젝트마다 다르므로 `package.json`, deploy script, framework 문서를 확인합니다.

## Build 실패

확인:

- 서버 Node.js 버전이 프로젝트 요구사항에 맞는지
- 패키지 매니저 버전이 맞는지
- root와 client 등 필요한 모든 workspace에서 install이 되는지
- codegen이나 ORM client 생성이 필요한 프로젝트인지

## PM2는 켜졌지만 health check 실패

확인:

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

흔한 원인:

- 필수 runtime env 누락
- DB 접속 env 오류
- 앱이 다른 포트로 실행됨
- runtime env 파일이 deploy script가 기대하는 위치에 없음
