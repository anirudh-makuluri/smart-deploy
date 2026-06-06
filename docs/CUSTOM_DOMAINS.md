# Custom Domains

SmartDeploy generates "Visit" URLs for each deployment using subdomains of a base domain you configure. DNS is managed via **Route 53** (wildcard `*.yourdomain.com` → shared ALB, plus ALB host-based routing per service).

---

## How it works

When you deploy a service called `myapp`, SmartDeploy builds URLs like:

```
https://myapp.yourdomain.com
```

The actual routing target depends on the cloud provider:
- **AWS ECS / EC2 (ALB)**: A wildcard Route 53 record sends `*.yourdomain.com` to the shared ALB. Each service gets an ALB listener rule that matches `myapp.yourdomain.com` and forwards to the correct target group.
- **Static sites (S3 + CloudFront)**: Per-subdomain Route 53 alias/CNAME records can point at CloudFront when wildcard mode is disabled.

---

## 1. Configure the base domain

Set in `.env`:

```
NEXT_PUBLIC_DEPLOYMENT_DOMAIN=yourdomain.com
```

This is the domain suffix used in all "Visit" links.

---

## 2. Route 53 setup

### Prerequisites

1. Host `yourdomain.com` in a **Route 53 public hosted zone** (or delegate a subdomain to Route 53).
2. Ensure your AWS credentials used by SmartDeploy can `route53:ChangeResourceRecordSets` and `route53:ListResourceRecordSets` on that zone.
3. ACM certificate for `*.yourdomain.com` on the shared ALB (`EC2_ACM_CERTIFICATE_ARN`).

### Environment variables

```
ROUTE53_HOSTED_ZONE_ID=Z0123456789ABC
NEXT_PUBLIC_DEPLOYMENT_DOMAIN=yourdomain.com
ROUTE53_USE_WILDCARD=true
ROUTE53_ENSURE_WILDCARD=true
```

| Variable | Required | Description |
|----------|----------|-------------|
| `ROUTE53_HOSTED_ZONE_ID` | Yes | Route 53 hosted zone ID |
| `NEXT_PUBLIC_DEPLOYMENT_DOMAIN` | Yes | Base domain for deploy URLs |
| `ROUTE53_DOMAIN` | No | Override base domain (defaults to deployment domain) |
| `ROUTE53_USE_WILDCARD` | No | Default `true` for shared-ALB deploys |
| `ROUTE53_ENSURE_WILDCARD` | No | Upsert `*.domain` → ALB on each deploy (default `true`) |

### Terraform (optional)

In `infra/smart-deploy-platform`, set:

```hcl
deployment_domain      = "yourdomain.com"
route53_hosted_zone_id = "Z0123456789ABC"
shared_alb_dns_name    = "smartdeploy-xxx-alb-yyy.us-west-2.elb.amazonaws.com"
```

Run `terraform apply` to create the wildcard ALIAS record. SmartDeploy can also create/update it at deploy time when `ROUTE53_ENSURE_WILDCARD=true`.

---

## 3. Manual DNS (no automation)

If Route 53 env vars are not set, create DNS manually:

| Type | Name | Value |
|------|------|-------|
| ALIAS (A) | `*` | Shared ALB DNS name |

ALB host rules must still be created per service (SmartDeploy does this on deploy).

---

## 4. HTTPS with ACM (AWS)

For the ALB to serve HTTPS, you need an ACM certificate:

1. Request a certificate in ACM for `*.yourdomain.com` (and optionally the apex).
2. Validate via DNS in Route 53.
3. Set `EC2_ACM_CERTIFICATE_ARN` in `.env`.

---

## Hybrid DNS: Vercel (app) + Route 53 (deploy URLs)

When nameservers point to Route 53, you need **both**:

| Record | Type | Target | Purpose |
|--------|------|--------|---------|
| `smart-deploy.xyz` (apex) | A | Project-specific IP from Vercel Domains UI (e.g. `216.198.79.1`) | Smart Deploy app on Vercel |
| `www` | CNAME | `cname.vercel-dns.com` | www → Vercel |
| `*` | ALIAS | Shared ALB | User deploy subdomains (`myapp.smart-deploy.xyz`) |

Wildcard `*` does **not** cover the apex — you must add the apex A record separately.

In the [Vercel project](https://vercel.com) → **Settings → Domains**, add `smart-deploy.xyz` and `www.smart-deploy.xyz` (and `app.smart-deploy.xyz` if you use it). Vercel must list the domain before HTTPS works.

Optional explicit records override the wildcard (e.g. `app` CNAME → `your-project.vercel.app`).

## Migrating from Vercel DNS

1. Add the Route 53 variables above and remove `VERCEL_TOKEN` / `VERCEL_DOMAIN`.
2. Create the wildcard ALIAS (Terraform or first deploy with `ROUTE53_ENSURE_WILDCARD=true`).
3. Add apex A + www CNAME for Vercel (table above).
4. Remove old incorrect per-subdomain CNAMEs from the old Vercel DNS zone.
5. Redeploy services so ALB host rules match the intended hostnames.
