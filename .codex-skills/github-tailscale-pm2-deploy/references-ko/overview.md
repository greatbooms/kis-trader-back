# GitHub + Tailscale + PM2 배포 스킬 개요

이 skill은 특정 프로젝트 전용이 아니라, 아래 배포 방식을 쓰는 프로젝트에 공통으로 적용하기 위한 문서입니다.

```text
main push 또는 workflow_dispatch
-> GitHub Actions 실행
-> Tailscale OAuth로 tailnet 접속
-> SSH로 운영 서버 접속
-> 소스 아카이브와 deploy script 업로드
-> 의존성 설치
-> 프로젝트별 generate / migration / build 실행
-> PM2로 앱 재시작
-> /health 헬스체크
```

## 핵심 원칙

- GitHub Actions Secret 이름은 새 프로젝트에서는 `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`를 권장합니다.
- 기존 프로젝트가 프로젝트별 secret 이름을 쓰고 있다면, 실제 `.github/workflows/*.yml`에 적힌 이름을 따릅니다.
- 앱 내부 환경변수는 범용 skill에 고정하지 않습니다.
- 앱 환경변수 목록은 대상 프로젝트의 `.env.example`, config, deploy script에서 찾아야 합니다.
- 실제 `.env`, `.env.dev`, `.env.prod`는 비밀값이 있을 수 있으므로 사용자가 명시적으로 요청하지 않으면 읽지 않습니다.

## 문서 구성

- `github-actions-secrets.md`: GitHub Actions Secrets 설명
- `tailscale.md`: Tailscale OAuth와 서버 host 선택 기준
- `ssh-and-server.md`: SSH key, 서버 준비, PM2 실행 기준
- `runtime-env.md`: 프로젝트별 runtime env를 찾는 방법
- `scaffold.md`: 새 프로젝트에 workflow, deploy script, PM2 설정을 추가하는 방법
- `troubleshooting.md`: 배포 실패 시 점검 순서

한글 번역:

- `github-actions-secrets.ko.md`
- `tailscale.ko.md`
- `ssh-and-server.ko.md`
- `runtime-env.ko.md`
- `scaffold.ko.md`
- `troubleshooting.ko.md`
