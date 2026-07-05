# Smart Deploy platform (Terraform)

Provisions AWS resources required by Smart Deploy v2 deploy routing:

| Resource | Smart Deploy `.env` |
|----------|---------------------|
| Private S3 bucket + OAC + CloudFront | `STATIC_SITE_BUCKET`, `STATIC_SITE_PUBLIC_BASE_URL`, `STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID` |
| ECS cluster | `ECS_CLUSTER_NAME` |
| Fargate task execution role | `ECS_EXECUTION_ROLE_ARN` |
| Fargate security group + subnets | `ECS_SECURITY_GROUP_IDS`, `ECS_SUBNET_IDS` |
| CloudWatch log group | `ECS_LOG_GROUP` (optional; defaults match app) |
| DynamoDB runtime table | `RUNTIME_DYNAMODB_TABLE_NAME` |
| Optional FIFO queue + Lambda trigger | `DEPLOYMENT_QUEUE_URL` |

**Not created here** (Smart Deploy creates at deploy time):

- Shared Application Load Balancer and listener rules
- CodeBuild project / ECR repositories
- Per-app ECS services and task definitions

## Prerequisites

- Terraform ≥ 1.6
- AWS credentials with permission to create S3, CloudFront, ECS, IAM, EC2 (security groups), CloudWatch Logs, and DynamoDB
- Default VPC (or set `vpc_id` + `ecs_subnet_ids`)
- For the optional deployment queue launcher: a pushed Lambda container image plus Supabase/Postgres server credentials

Fargate subnets should be **public** (map public IP) unless you use private subnets with NAT and set `ECS_ASSIGN_PUBLIC_IP=DISABLED` in `.env`.

The runtime DynamoDB table is a shared worker-state table keyed by `pk` + `sk`. Runtime health and runtime logs are intended to live as separate item types under the same deployment key, for example `runtime#health` and `runtime#logs`.

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

## Deployment queue trigger

This stack can also create the first-pass deployment launcher path:

`SQS FIFO queue -> Lambda -> ECS RunTask`

Build and push the images first:

```bash
# from the repository root
docker build -f Dockerfile.websocket -t smart-deploy-worker .
# tag + push to your ECR repo

docker build -f Dockerfile.deployment-queue-lambda -t smart-deploy-deployment-queue .
# tag + push to your ECR repo
```

Then enable it in `terraform.tfvars`:

```hcl
enable_deployment_queue          = true
deployment_queue_lambda_image_uri = "123456789012.dkr.ecr.us-west-2.amazonaws.com/smart-deploy-deployment-queue:latest"

supabase_url              = "https://your-project.supabase.co"
supabase_service_role_key = "your-service-role-key"
database_url              = "postgresql://..."

deployment_worker_image = "123456789012.dkr.ecr.us-west-2.amazonaws.com/smart-deploy-worker:latest"
deployment_worker_secret_arn = "arn:aws:secretsmanager:us-west-2:123456789012:secret:smartdeploy/worker/prod-AbCdEf"
```

Notes:

- The Lambda image must already exist in ECR before `terraform apply`.
- The deployment worker image must already exist in ECR before `terraform apply`.
- Image build and push stay outside Terraform on purpose.
- Terraform creates the one-off ECS deployment worker task definition and task role for you.
- The Lambda launches ECS tasks and does not run the deployment itself.
- The generated env snippet includes `DEPLOYMENT_QUEUE_URL` plus the default worker networking values.

## Updating the deployment queue images

Preferred path from the repository root:

```bash
./scripts/update.sh
```

That builds and pushes:

- `Dockerfile.websocket` to the `smart-deploy-worker` ECR repo.
- `Dockerfile.deployment-queue-lambda` to the `smart-deploy-deployment-queue` ECR repo.

It then updates:

- The existing websocket EC2 worker container via SSM.
- The one-off ECS deployment worker task definition in this stack.
- The deployment queue Lambda function so its image and `DEPLOYMENT_WORKER_TASK_DEFINITION_ARN` point at the latest worker task definition revision.

Useful overrides:

```bash
IMAGE_TAG=20260705-live-log-bridge ./scripts/update.sh
AUTO_APPROVE=true ./scripts/update.sh
UPDATE_DEPLOYMENT_QUEUE=false ./scripts/update.sh
ROLLOUT_MODE=none ./scripts/update.sh
```

Manual deployment queue update:

```bash
cd /path/to/smart-deploy

TAG=20260705-live-log-bridge
AWS_ACCOUNT_ID=1234567890
AWS_REGION=us-west-2
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

docker buildx build --platform linux/amd64 --provenance=false \
  -f Dockerfile.websocket \
  -t "${ECR_REGISTRY}/smart-deploy-worker:${TAG}" \
  --push .

docker buildx build --platform linux/amd64 --provenance=false \
  -f Dockerfile.deployment-queue-lambda \
  -t "${ECR_REGISTRY}/smart-deploy-deployment-queue:${TAG}" \
  --push .

terraform -chdir=infra/smart-deploy-platform apply \
  -var="deployment_worker_image=${ECR_REGISTRY}/smart-deploy-worker:${TAG}" \
  -var="deployment_queue_lambda_image_uri=${ECR_REGISTRY}/smart-deploy-deployment-queue:${TAG}" \
  -target='aws_ecs_task_definition.deployment_worker[0]' \
  -target='aws_lambda_function.deployment_queue[0]'
```

Use immutable tags for both images. If you only update the ECS task definition, Lambda may keep launching an older task definition ARN. If you only update Lambda, the task definition may still reference an older worker image.

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

