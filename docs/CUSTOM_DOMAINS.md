# Custom Domains

SmartDeploy generates "Visit" URLs for each deployment using subdomains of a base domain you configure. Optionally, it can manage DNS records automatically via the Vercel API.

---

## How it works

When you deploy a service called `myapp`, SmartDeploy builds URLs like:

```
https://myapp.yourdomain.com
```

The actual routing target depends on the cloud provider:
- **AWS EC2 (ALB)**: The ALB uses **host-based routing**: each service gets a listener rule that matches `myapp.yourdomain.com` and forwards to the correct target group.
- **GCP Cloud Run**: Each Cloud Run service gets its own URL; the CNAME points to that URL.

---

## 1. Configure the base domain

Set in `.env`:

```
NEXT_PUBLIC_DEPLOYMENT_DOMAIN=yourdomain.com
```

This is the domain suffix used in all "Visit" links. For example, if set to `example.com`, deployments are shown as `https://servicename.example.com`.

---

## 2. (Optional) Automatic DNS via Vercel

If your domain's DNS is managed by Vercel, SmartDeploy can create/update **CNAME records** automatically after each deploy.

### Setup

1. Add your domain to Vercel (Vercel dashboard -> your project or account -> Domains).
2. Create an API token at [vercel.com/account/tokens](https://vercel.com/account/tokens).
3. Add to `.env`:

```
VERCEL_TOKEN=your_vercel_api_token
VERCEL_DOMAIN=yourdomain.com
```

If you're on a Vercel team, also set:

```
VERCEL_TEAM_ID=team_xxx
```

### What it does

After a successful deploy, SmartDeploy calls the Vercel DNS API to:
- **Create** a CNAME record (`servicename.yourdomain.com -> <deploy-target>`).
- **Update** the record if it already exists and the target has changed.

---

## 3. Manual DNS (no Vercel)

If you don't use Vercel DNS, create CNAME records manually at your DNS provider after each deploy:

| Type | Name | Value |
|------|------|-------|
| CNAME | `myapp` | `smartdeploy-xxx-alb-yyy.us-west-2.elb.amazonaws.com` (ALB DNS name) |

For wildcard setups, a single wildcard record works:

| Type | Name | Value |
|------|------|-------|
| CNAME | `*` | `your-alb-dns-name.elb.amazonaws.com` |

---

## 4. HTTPS with ACM (AWS)

For the ALB to serve HTTPS, you need an ACM certificate:

1. Request a certificate in **ACM** (same region as your deployments) for `*.yourdomain.com`.
2. Complete DNS validation.
3. Add to `.env`:

```
EC2_ACM_CERTIFICATE_ARN=arn:aws:acm:us-west-2:123456789012:certificate/abc-123...
```

SmartDeploy will create an HTTPS listener on the ALB and redirect HTTP to HTTPS. See [AWS IAM Setup](./AWS_IAM_SETUP.md) for more details.

---

## Environment variable summary

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_DEPLOYMENT_DOMAIN` | Yes | Base domain for deployment URLs (e.g. `yourdomain.com`) |
| `VERCEL_TOKEN` | No | Vercel API token for automatic DNS |
| `VERCEL_DOMAIN` | No | Domain registered in Vercel (usually same as deployment domain) |
| `VERCEL_TEAM_ID` | No | Vercel team ID (only if using a team account) |
| `EC2_ACM_CERTIFICATE_ARN` | No | ACM certificate ARN for ALB HTTPS |
