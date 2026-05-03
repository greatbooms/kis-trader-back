# Tailscale Setup

GitHub Actions uses `tailscale/github-action@v4` with OAuth credentials and `tags: tag:ci`.

## Required Values

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- A reachable server identity for `SERVER_HOST`

## How To Obtain OAuth Values

1. Open the Tailscale Admin Console.
2. Create an OAuth client.
3. Grant permission for auth keys. The project docs require `auth_keys` writable scope.
4. Ensure `tag:ci` is allowed for the OAuth client.
5. Store the generated client ID in GitHub Actions secret `TS_OAUTH_CLIENT_ID`.
6. Store the generated secret in GitHub Actions secret `TS_OAUTH_SECRET`.

## How To Choose SERVER_HOST

Use one of:

- The server's Tailscale machine name, if resolvable from the GitHub Actions tailnet session.
- The server's Tailscale `100.x.x.x` IP.

The workflow checks connectivity with:

```bash
tailscale ping <SERVER_HOST>
nc -zvw3 <SERVER_HOST> 22
```

SSH must be reachable over the tailnet.
