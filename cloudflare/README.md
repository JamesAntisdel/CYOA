# Cloudflare Tunnel

Use this to test the Docker app through real HTTPS while still serving from the local Compose stack.

## Quick Tunnel

For a temporary URL:

```sh
cloudflared tunnel --url http://localhost:8081
```

Copy the printed `https://*.trycloudflare.com` URL into `.env`:

```sh
PUBLIC_APP_URL=https://your-random.trycloudflare.com
BETTER_AUTH_URL=https://your-random.trycloudflare.com
SITE_URL=https://your-random.trycloudflare.com
```

Then restart the app container:

```sh
docker compose restart app
```

`EXPO_PUBLIC_CONVEX_URL=http://localhost:3210`, `EXPO_PUBLIC_CONVEX_SITE_URL=http://localhost:3211`,
and `EXPO_PUBLIC_PROVIDER_MOCKS_URL=http://localhost:4010` are only valid when the browser is
running on this same machine. For testing from a phone or another computer, use a hosted Convex
dev deployment or expose those services with separate tunnel hostnames.

When BetterAuth is running inside Convex, store auth values in Vault and sync the Convex deployment:

```sh
vault kv patch secret/cyoa/dev SITE_URL=https://your-random.trycloudflare.com BETTER_AUTH_URL=https://your-random.trycloudflare.com
pnpm secrets:vault:sync-convex -- --deployment dev
```

## Named Tunnel

For a stable hostname:

```sh
cloudflared tunnel login
cloudflared tunnel create cyoa-local
cloudflared tunnel route dns cyoa-local cyoa.example.com
```

Edit `cloudflare/tunnel.yml`:

- `tunnel`: the tunnel name or UUID
- `credentials-file`: the generated credentials JSON path
- `hostname`: your HTTPS hostname

Run:

```sh
cloudflared tunnel --config cloudflare/tunnel.yml run
```

Set `.env`:

```sh
PUBLIC_APP_URL=https://cyoa.example.com
BETTER_AUTH_URL=https://cyoa.example.com
SITE_URL=https://cyoa.example.com
```

Restart:

```sh
docker compose restart app
```

## Smoke Check

After the tunnel URL and Convex site URL are configured, run a non-spending smoke:

```sh
pnpm smoke:live-readiness -- --app-url https://cyoa.example.com --convex-site-url https://your-convex-site.example
```

This verifies that the app serves over HTTPS, BetterAuth and Stripe routes are mounted, and the LLM stream route rejects unauthenticated direct calls before provider work.
