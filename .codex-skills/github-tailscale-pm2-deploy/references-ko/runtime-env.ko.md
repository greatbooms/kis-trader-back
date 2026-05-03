# Runtime Environment

이 skill은 앱 내부 환경변수 이름을 고정하지 않습니다.

runtime env는 프로젝트마다 다르므로 대상 repository에서 직접 찾아야 합니다.

## 확인할 위치

비밀값이 없는 예시 파일과 소스 코드를 우선 확인합니다.

- `.env.example`
- `.env.sample`
- `client/.env.example`
- 배포 문서
- `process.env` 또는 유사 API를 읽는 config 파일
- framework config 파일
- PM2 ecosystem 파일
- Dockerfile 또는 compose 파일

이 초보자용 배포 패턴에서는 runtime env 파일을 private repository에 commit하고 release archive에 포함해 배포하는 방식을 기본으로 봅니다. 실제 `.env`, `.env.dev`, `.env.prod`는 비밀값이 있을 수 있으므로 사용자가 명시적으로 요청하지 않으면 읽지 않습니다.

## env 파일 역할

기본 규칙은 아래와 같습니다.

- `.env.dev`는 로컬 개발용입니다.
- `.env.prod`는 운영 배포용입니다.
- 초보자용 배포에서는 `.env.prod`를 private repository에 commit합니다.
- `.env.prod`는 release archive에 반드시 포함되어야 합니다.
- deploy script와 PM2 설정은 `.env.prod`를 로드합니다.
- 로컬 개발 스크립트는 `.env.dev`를 로드해야 합니다.

로컬 개발 스크립트가 없다면 `.env.dev`를 명시적으로 로드하는 script를 권장합니다. Node/Nest 계열 예시:

```json
{
  "scripts": {
    "start:dev": "set -a; source .env.dev; set +a; npm run dev",
    "start:prod": "set -a; source .env.prod; set +a; node dist/main"
  }
}
```

실제 명령은 프로젝트 framework와 package manager에 맞게 조정합니다.

## 사용자에게 정리할 내용

- 변수 이름
- 어디에 설정해야 하는지
- 필수인지, 선택인지, 특정 기능에서만 필요한지
- credential이 필요한 경우 발급 위치의 큰 방향
- 절대 secret 값을 채팅에 붙여넣으라고 요구하지 않기

## 기본 패턴: env 파일을 git에 포함

초보자용 배포에서는 runtime env 파일을 private repository에 같이 commit해서, 매번 코드와 환경변수가 함께 배포되도록 합니다.

기본으로 지켜야 할 동작:

- `.env.prod` 같은 runtime env 파일을 git에 commit합니다.
- `.env.dev`는 로컬 개발용이며 배포에서는 사용하지 않습니다.
- `.gitignore`가 배포에 사용할 env 파일을 제외하면 안 됩니다.
- GitHub Actions의 tar/archive 명령이 env 파일을 exclude하면 안 됩니다.
- release archive에 env 파일이 포함되어야 합니다.
- 원격 deploy script가 archive를 풀 때 env 파일도 같이 배포되어야 합니다.

보안 조건:

- repository는 private이어야 합니다.
- repository 접근 권한이 있는 사람은 env 값을 모두 볼 수 있다는 점을 이해해야 합니다.
- repo나 git history가 노출되면 credential을 재발급/회전할 수 있어야 합니다.
- 가능하면 개인 토큰 대신 배포/앱 전용 credential을 사용합니다.

## 배포 시 실제 동작

`.env.prod` 또는 프로젝트의 runtime env 파일이 git에 commit되어 있고 workflow의 archive 단계에서 exclude되지 않으면:

- release archive에 env 파일이 포함됩니다.
- archive가 서버로 업로드됩니다.
- 원격 deploy script가 archive를 압축 해제합니다.
- env 파일도 `DEPLOY_PATH` 안의 release 디렉토리에 같이 배포됩니다.

## 서버 env가 git env를 덮지 않게 하기

많은 deploy script는 서버에 이미 있는 `${DEPLOY_PATH}/.env.prod`를 새 release 디렉토리로 복사해서 보존합니다. 이 방식은 고급 배포에는 유용하지만, 초보자용 env-in-git 기본 방식과 충돌할 수 있습니다.

이 skill의 기본 방식에서는:

- deploy script가 꼭 요구하지 않는 한 서버에 별도 env 파일을 만들지 않습니다.
- deploy script가 서버 env 파일을 추출된 env 위에 덮어쓴다면, git에 포함된 env 파일이 source of truth가 되도록 script를 수정합니다.
- 실제 env 파일을 commit하더라도 `.env.example`은 문서용으로 유지하는 편이 좋습니다.

## 고급 대안: 서버에 env 파일 보존

더 안전하거나 팀 운영에 맞는 방식이 필요하면 production runtime 변수를 서버에만 둘 수 있습니다.

예:

```text
${DEPLOY_PATH}/.env.prod
```

이 대안에서는 deploy script가 기존 서버 env 파일을 새 release로 복사하므로 secret을 git이나 GitHub Actions에 저장하지 않아도 됩니다.

하지만 초보자용 프로젝트에서는 이 방식을 기본으로 안내하지 않습니다.

## 찾을 때 쓰는 명령 예시

```bash
rg --files -g '.env*' -g '!node_modules'
rg 'process\.env|PORT|API_KEY|SECRET|TOKEN|URL' .
```

프로젝트 언어와 framework에 맞게 검색어를 조정합니다.
