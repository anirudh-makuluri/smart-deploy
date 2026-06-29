# Custom Domains and Deployment URLs

Smart Deploy assigns each deployment a public **Visit** URL on a shared platform domain. Routing uses a hosted subdomain plus AWS DNS and load balancer rules.

## Default URL shape

```text
https://{hosted-subdomain}.{deployment-domain}
```

Example: service `myapp` with subdomain `myapp` → `https://myapp.smart-deploy.xyz`

You choose the **hosted subdomain** in blueprint preview or config. It must be unique across the platform.

## How routing works

| Target | Routing |
|--------|---------|
| **ECS (containers)** | Wildcard DNS `*.domain` → shared ALB; per-service ALB listener rule matches your subdomain |
| **Static S3** | Build output synced to S3; optional CloudFront; DNS points at the static endpoint |

Each ECS service gets its own host rule — multiple services mean multiple subdomains, not path-based routing on one hostname.

## HTTPS

HTTPS terminates at the shared ALB (ECS) or CloudFront (static when configured). Your app receives HTTP behind the load balancer; bind to `PORT` inside the container.

## Subdomain rules

- Use lowercase alphanumeric characters and hyphens
- Subdomain is global — two users cannot claim the same name
- Changing subdomain after deploy updates DNS and ALB rules on the next deploy

## Custom apex or external DNS

Today, user-facing deploy URLs use the **platform deployment domain** with a hosted subdomain. Bringing your own apex domain (for example `app.yourcompany.com`) requires DNS you control pointing at the platform ALB or static endpoint.

For DNS not resolving or TLS issues, see [Domain and TLS Issues](./DOMAIN_AND_TLS_ISSUES.md).

## Multiple services in one repo

Each service needs its own subdomain:

| Service | Subdomain | URL |
|---------|-----------|-----|
| `web` | `acme-web` | `https://acme-web.{domain}` |
| `api` | `acme-api` | `https://acme-api.{domain}` |

## After changing subdomain

1. Save the new subdomain in config
2. Redeploy so Route 53 and ALB rules update
3. Allow DNS propagation (minutes to hours depending on TTL)

## Related

- [Domain and TLS Issues](./DOMAIN_AND_TLS_ISSUES.md)
- [Health Checks](./HEALTH_CHECKS.md)
- [Getting Started](./GETTING_STARTED.md)