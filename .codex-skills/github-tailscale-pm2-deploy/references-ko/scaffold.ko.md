# 새 프로젝트에 배포 설정 추가하기

사용자가 “내 프로젝트를 이 방식으로 배포하고 싶다”고 요청하면 이 절차를 따릅니다.

## 기본 전제

- GitHub repository는 private입니다.
- 초보자용 배포이므로 runtime env 파일은 git에 commit합니다.
- 로컬 개발은 `.env.dev`, 운영 배포는 `.env.prod`를 사용합니다.
- workflow는 runtime env 파일을 release archive에서 제외하면 안 됩니다.
- GitHub Secrets 권장 이름:
  - `TS_OAUTH_CLIENT_ID`
  - `TS_OAUTH_SECRET`
  - `SERVER_HOST`
  - `SERVER_USER`
  - `SERVER_SSH_KEY`
  - `DEPLOY_PATH`
- 서버에는 Node.js, Yarn, PM2, SSH, Tailscale이 준비되어야 합니다.

## 생성할 파일

`assets/templates/`의 템플릿을 프로젝트에 맞게 복사/수정합니다.

- `deploy.yml` -> `.github/workflows/deploy.yml`
- `deploy.sh` -> `scripts/deploy.sh`
- `ecosystem.config.js` -> `ecosystem.config.js`

`deploy.sh`를 복사한 뒤 실행 권한을 부여합니다.

```bash
chmod +x scripts/deploy.sh
```

## 프로젝트별로 반드시 조정할 것

파일을 쓰기 전에 아래를 확인합니다.

- 패키지 매니저 확인. 템플릿은 Yarn 1.x 기준입니다.
- 빌드 결과 파일 확인. PM2 템플릿은 `dist/main.js` 기준입니다.
- 앱 이름 확인 후 `my-app`을 교체합니다.
- `client/` 앱이 있는지 확인합니다.
- `package.json`에서 build, migration, generation script를 확인합니다.
- health endpoint와 port를 확인합니다. 템플릿은 `/health`, `${PORT:-8888}` 기준입니다.
- runtime env 파일명을 확인합니다. 템플릿은 `.env.prod` 기준입니다.
- 로컬 개발 script가 `.env.dev`를 로드하는지 확인하거나 추가합니다.
- 로그는 스왑되는 release 디렉토리 안에 두지 않습니다. 템플릿은 `DEPLOY_PATH`에서 `${DEPLOY_PATH}_shared/logs`를 파생해 영속 로그 경로로 씁니다.

## env-in-git 기본 요구사항

초보자용 기본 모드에서는:

- 배포에 사용할 runtime env 파일이 `.gitignore`에 막혀 있으면 안 됩니다.
- `.github/workflows/deploy.yml`의 `tar` 명령이 env 파일을 exclude하면 안 됩니다.
- `scripts/deploy.sh`가 서버에 있던 env 파일을 추출된 env 파일 위에 덮어쓰면 안 됩니다.
- 배포는 `.env.dev`가 아니라 `.env.prod`를 사용해야 합니다.
- 로컬 개발은 `.env.prod`가 아니라 `.env.dev`를 사용해야 합니다.
- 기존 프로젝트에 서버 env 보존 로직이 있다면, git에 포함된 env 파일이 source of truth가 되도록 제거하거나 수정합니다.

## 설정 후 사용자에게 알려줄 것

GitHub repository secrets에 아래 값을 넣어야 합니다.

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `DEPLOY_PATH`

서버에는 아래를 준비해야 합니다.

- Node.js 20 이상 또는 프로젝트가 요구하는 runtime
- Yarn 1.x 또는 프로젝트가 쓰는 패키지 매니저
- PM2
- PM2가 `pm2-logrotate`를 설치할 수 있게 하거나 미리 설치
- SSH 활성화
- Tailscale 설치 및 접속
- `DEPLOY_PATH` 디렉토리 생성

secret 값은 채팅에 붙여넣으라고 요구하지 않습니다.

로그 동작:

- 배포 로그: `${DEPLOY_PATH}_shared/logs/deploy.log`
- PM2 로그: `${DEPLOY_PATH}_shared/logs/pm2/`
- 사용자가 별도 경로를 원하지 않으면 `PM2_LOG_DIR` GitHub Secret은 필요 없습니다.
- `pm2-logrotate`는 `scripts/deploy.sh`가 기본으로 설치/설정합니다. 기본값은 max size `10M`, retain `14`, compress `true`입니다.
