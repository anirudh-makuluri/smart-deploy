# AWS Worker New Stack (OpenTofu/Terraform)

This stack provisions a new EC2 worker host for Smart Deploy.

What it creates:
- 1 EC2 instance (default `t3.small`)
- Security group (80/443 public, 22 restricted by `ssh_cidr`)
- IAM role and instance profile with SSM + ECR read access
- Optional Elastic IP
- Optional public Route53 A record
- User data bootstrap that runs your worker container behind Nginx websocket proxying

## 1) Fill Variables

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Set at least:
   - `ssh_cidr`
   - `worker_image`
   - `domain_name` and `worker_subdomain` (if using Route53)

3. Ensure `/opt/smart-deploy/.env` exists on the worker host before starting the service.
   - The worker container reads this env file directly via `--env-file`.
   - Include the full runtime env your worker needs (for example `BETTER_AUTH_SECRET`, `WS_ALLOWED_ORIGINS`, cloud credentials, and DB vars).

## 2) Apply

Using OpenTofu:

```bash
tofu init
tofu plan
tofu apply
```

Using Terraform:

```bash
terraform init
terraform plan
terraform apply
```

## 3) Wire App Env

After apply, use output `worker_origin_example` for app env:
- `NEXT_PUBLIC_WS_URL`

## 4) TLS/HTTPS

This stack configures Nginx reverse proxying on port 80 by default.
For production `wss://` you must terminate TLS in front of this instance (for example: Cloudflare, ALB, or your own certificate-managed Nginx setup).
When TLS is enabled at the edge, set `NEXT_PUBLIC_WS_URL` to `wss://...`.
Without TLS, use `ws://...`.

## Notes

- Keep DB managed separately (Supabase/RDS).
- For low traffic (about 5 users), `t3.small` is usually enough when Docker builds happen in CodeBuild.
- Start with deployment concurrency of 1.
