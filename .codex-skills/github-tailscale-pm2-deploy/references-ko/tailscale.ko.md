# Tailscale 설정

GitHub Actions는 `tailscale/github-action@v4`와 OAuth credential을 사용해 tailnet에 접속합니다.

필요한 값:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `SERVER_HOST`

## OAuth 값 발급 방법

1. Tailscale Admin Console에 접속합니다.
2. OAuth client를 생성합니다.
3. auth key 발급 권한을 부여합니다. 이 배포 패턴은 보통 `auth_keys` writable scope가 필요합니다.
4. workflow에서 `tag:ci`를 쓴다면 OAuth client가 `tag:ci`를 사용할 수 있어야 합니다.
5. 발급된 client ID를 GitHub Actions Secret `TS_OAUTH_CLIENT_ID`에 저장합니다.
6. 발급된 secret을 GitHub Actions Secret `TS_OAUTH_SECRET`에 저장합니다.

## SERVER_HOST 선택 기준

아래 중 하나를 사용합니다.

- GitHub Actions의 tailnet 세션에서 해석 가능한 서버의 Tailscale machine name
- 서버의 Tailscale `100.x.x.x` IP

workflow에서 연결 확인은 보통 아래처럼 합니다.

```bash
tailscale ping <SERVER_HOST>
nc -zvw3 <SERVER_HOST> 22
```

운영 서버의 SSH 22번 포트가 tailnet에서 접근 가능해야 합니다.

