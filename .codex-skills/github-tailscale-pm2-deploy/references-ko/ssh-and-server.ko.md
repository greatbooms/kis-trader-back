# SSH와 서버 준비

운영 서버는 GitHub Actions runner가 Tailscale에 접속한 뒤 SSH 22번 포트로 접근 가능해야 합니다.

## 서버 필수 구성

- Node.js 20 이상
- Yarn 1.x 또는 프로젝트가 요구하는 패키지 매니저
- PostgreSQL 또는 프로젝트가 요구하는 DB
- PM2
- PM2 logrotate module
- Tailscale
- SSH server 활성화

PM2 설치 예시:

```bash
npm install -g pm2
```

배포 스크립트는 `pm2-logrotate`가 없으면 자동 설치하고 기본 설정을 적용합니다. 서버에서 미리 설치하려면 아래처럼 실행합니다.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 save
```

## 배포 경로

운영 서버에 앱을 배치할 경로를 정하고 GitHub Secret `DEPLOY_PATH`에 넣습니다.

예:

```text
/Users/name/apps/my-app
```

서버에서 생성:

```bash
mkdir -p /Users/name/apps/my-app
```

프로젝트가 runtime env 파일을 서버에 보존하는 패턴이라면, deploy script가 기대하는 위치에 env 파일을 둡니다.

예:

```text
/Users/name/apps/my-app/.env.prod
```

정확한 파일명과 위치는 반드시 해당 프로젝트의 `scripts/deploy.sh` 또는 workflow에서 확인합니다.

## SSH key

배포 전용 SSH key pair를 준비합니다.

- private key: GitHub Actions Secret `SERVER_SSH_KEY` 또는 workflow에서 사용하는 이름으로 저장
- public key: 운영 서버 사용자의 `~/.ssh/authorized_keys`에 등록

서버 권한 설정 예:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

## PM2

앱은 보통 아래 형태로 재시작합니다.

```bash
pm2 startOrRestart ecosystem.config.js --only <app-name> --update-env
pm2 save
```

확인 명령:

```bash
pm2 list
pm2 describe <app-name>
pm2 logs <app-name>
```

## 로그 보존

이 배포 방식은 성공 배포 시 `${DEPLOY_PATH}` 디렉토리를 새 release로 스왑합니다. 그래서 로그를 `${DEPLOY_PATH}/logs` 안에 두면 이전 release 삭제와 함께 로그가 사라질 수 있습니다.

기본 템플릿은 `DEPLOY_PATH`에서 파생한 영속 디렉토리를 사용합니다.

```text
${DEPLOY_PATH}_shared/logs/deploy.log
${DEPLOY_PATH}_shared/logs/pm2/pm2.out.log
${DEPLOY_PATH}_shared/logs/pm2/pm2.error.log
```

`scripts/deploy.sh`가 이 디렉토리를 만들고 `PM2_LOG_DIR`를 export한 뒤 PM2를 재시작합니다. 따라서 별도의 `PM2_LOG_DIR` GitHub Secret은 필요하지 않습니다.

배포된 release 안의 `logs`는 이 영속 로그 디렉토리를 가리키는 symlink로 만들어집니다.

PM2 logrotate는 기본 설정에 포함됩니다.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 save
```

배포 스크립트도 위 설정을 자동 적용합니다. 필요할 때만 `PM2_LOGROTATE_MAX_SIZE`, `PM2_LOGROTATE_RETAIN`, `PM2_LOGROTATE_COMPRESS`로 값을 바꿉니다.
