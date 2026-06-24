# Smart Deploy platform (Terraform)

Provisions AWS resources required by Smart Deploy v2 deploy routing:

| Resource | Smart Deploy `.env` |
|----------|---------------------|
| Private S3 bucket + OAC + CloudFront | `STATIC_SITE_BUCKET`, `STATIC_SITE_PUBLIC_BASE_URL`, `STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID` |
| ECS cluster | `ECS_CLUSTER_NAME` |
| Fargate task execution role | `ECS_EXECUTION_ROLE_ARN` |
| Fargate security group + subnets | `ECS_SECURITY_GROUP_IDS`, `ECS_SUBNET_IDS` |
| CloudWatch log group | `ECS_LOG_GROUP` (optional; defaults match app) |

**Not created here** (Smart Deploy creates at deploy time):

- Shared Application Load Balancer and listener rules
- CodeBuild project / ECR repositories
- Per-app ECS services and task definitions

## Prerequisites

- Terraform ≥ 1.6
- AWS credentials with permission to create S3, CloudFront, ECS, IAM, EC2 (security groups), and CloudWatch Logs
- Default VPC (or set `vpc_id` + `ecs_subnet_ids`)

Fargate subnets should be **public** (map public IP) unless you use private subnets with NAT and set `ECS_ASSIGN_PUBLIC_IP=DISABLED` in `.env`.

## Quick start

```bash
cd infra/smart-deploy-platform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars (bucket name must be globally unique if creating new)

terraform init
terraform plan
terraform apply
```

Copy outputs into your Smart Deploy `.env`:

```bash
terraform output -raw smart_deploy_env_snippet
```

Also set (if not already):

```env
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Optional for HTTPS on container deploys (shared ALB):

```env
DEPLOYMENT_ACM_CERTIFICATE_ARN=arn:aws:acm:us-west-2:ACCOUNT:certificate/...
```

## Already created resources

If you created the S3 bucket or ECS cluster manually:

```hcl
# terraform.tfvars
create_s3_bucket   = false
s3_bucket_name     = "smart-deploy-static-site"
create_ecs_cluster = false
ecs_cluster_name   = "smart-deploy-cluster"
```

Terraform will attach CloudFront OAC bucket policy and create the remaining pieces (distribution, execution role, Fargate SG, log group).

To import an existing bucket into state instead:

```bash
terraform import 'aws_s3_bucket.static[0]' smart-deploy-static-site
```

## Architecture notes

- **S3** has block public access enabled. Only CloudFront (via OAC) can read objects.
- **CodeBuild** writes to S3 using the IAM policy Smart Deploy attaches to its CodeBuild role at runtime (`STATIC_SITE_BUCKET` must match).
- **CloudFront** uses the default `*.cloudfront.net` certificate. Add a custom domain later with ACM in `us-east-1` and a second Terraform change.
- **SPA fallback**: 403/404 → `index.html` (disable with `cloudfront_spa_fallback = false`).

## Related

- [docs/AWS_SETUP.md](../../docs/AWS_SETUP.md) — IAM policy for the Smart Deploy service user
- [infra/aws-worker-new](../aws-worker-new) — optional WebSocket/deploy worker EC2

