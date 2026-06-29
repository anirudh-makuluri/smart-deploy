# Domain and TLS Issues

Use this guide when your Visit URL does not load, shows certificate errors, or DNS does not resolve.

## Expected URL

```text
https://{hosted-subdomain}.{deployment-domain}
```

Confirm the subdomain in config matches what you are visiting. Typos and stale bookmarks are common.

## DNS propagation

After first deploy or subdomain change:

| Factor | Typical wait |
|--------|--------------|
| New ALB host rule | Seconds to minutes |
| DNS TTL | Up to prior TTL (often 300s–3600s) |
| Wildcard record | Must exist for ECS `*.domain` routing |

**Check resolution:**

```bash
dig +short myapp.example.com
nslookup myapp.example.com
```

Expected: ALB DNS name or CloudFront distribution for static endpoints.

## TLS / HTTPS errors

| Error | Common cause |
|-------|--------------|
| Certificate mismatch | Visiting wrong hostname (subdomain not deployed) |
| NET::ERR_CERT_AUTHORITY_INVALID | DNS points to wrong endpoint |
| SSL handshake failed | ALB listener or cert not ready — retry after deploy completes |

HTTPS terminates at the platform ALB or CloudFront — your container serves HTTP internally.

## 502 / 503 with valid DNS

DNS works but edge returns bad gateway:

- Usually **runtime** issue, not DNS — see [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md)
- ALB has no healthy targets behind your host rule

## Subdomain conflicts

Hosted subdomains are globally unique. If deploy DNS steps fail:

- Another deployment may already use that subdomain
- Pick a different subdomain and redeploy

## Multiple services

Each service needs a distinct subdomain and host rule. Visiting the wrong subdomain shows another service or default ALB response.

## After fixing DNS or subdomain

1. Save config
2. Redeploy (updates Route 53 / ALB rules)
3. Wait for propagation
4. Hard-refresh browser or clear local DNS cache

Windows: `ipconfig /flushdns`  
macOS: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`

## Related

- [Custom Domains](./CUSTOM_DOMAINS.md)
- [Health Checks](./HEALTH_CHECKS.md)
- [Error Catalog](./ERROR_CATALOG.md)