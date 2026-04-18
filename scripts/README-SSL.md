# SSL Setup For Worker Host

This guide covers TLS for the worker host endpoint, typically a websocket domain such as ws.smart-deploy.xyz.

Use this only when TLS terminates on the worker instance itself.
If TLS already terminates at ALB, Cloudflare, or another edge proxy, you do not need to run setup-ssl.sh on the instance.

## Scope

- Target service: smart-deploy-worker on port 4001
- Nginx role: reverse proxy and websocket upgrade handling
- Cert manager: Certbot with nginx integration

## Prerequisites

1. DNS A record for your worker domain points to the instance public IP.
2. Security group allows inbound 80 and 443.
3. Worker service is already running and healthy on localhost:4001.
4. You can run commands as root with sudo.

## Initial Setup

Run on the worker host:

```bash
cd /opt/smartdeploy
sudo ./scripts/setup-ssl.sh
```

You can also pass values non-interactively:

```bash
sudo DOMAIN=ws.smart-deploy.xyz EMAIL=you@example.com ./scripts/setup-ssl.sh
```

The script does the following:

1. Installs certbot and nginx tools.
2. Writes nginx config for your worker domain.
3. Proxies traffic to http://127.0.0.1:4001.
4. Obtains certificate and enables HTTPS redirect.
5. Reloads nginx.

## Renewal

Manual renewal:

```bash
sudo ./scripts/renew-ssl.sh
```

Recommended validation command:

```bash
sudo certbot renew --dry-run
```

## Verification

After setup, verify all three layers:

```bash
sudo systemctl status nginx --no-pager
sudo certbot certificates
curl -i https://ws.smart-deploy.xyz/health
```

Expected result for health call: HTTP 200 JSON from worker.

## App Config

When worker TLS is active, app env should use:

```env
NEXT_PUBLIC_WS_URL=wss://ws.smart-deploy.xyz
```

Auth base URL in app should use Better Auth naming, not NextAuth naming:

```env
BETTER_AUTH_URL=https://your-app-domain
```

## Troubleshooting

### Certificate request fails

Check DNS and port reachability:

```bash
dig +short ws.smart-deploy.xyz
sudo ss -tlnp | grep -E ':80|:443'
```

### Worker reachable on HTTP but not HTTPS

Check nginx and certificate wiring:

```bash
sudo nginx -t
sudo journalctl -u nginx -n 200 --no-pager
sudo certbot certificates
```

### Websocket still fails after TLS

Check app and worker env alignment:

1. NEXT_PUBLIC_WS_URL points to wss worker domain.
2. BETTER_AUTH_SECRET matches between app and worker.
3. WS_ALLOWED_ORIGINS includes the frontend origin.
