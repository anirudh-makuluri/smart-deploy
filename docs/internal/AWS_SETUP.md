# AWS setup

SmartDeploy uses AWS for **CodeBuild** + **ECR** image builds, **ECS Fargate** runtime deployments, an **Application Load Balancer (ALB)** for HTTPS and custom-domain routing, **SQS + Lambda** to queue and launch deployment runs, **STS** for identity checks, and optionally **ACM** for TLS certificates on the ALB.

Use this guide together with:

- [Custom domains](./CUSTOM_DOMAINS.md) — deployment hostnames and Vercel DNS
- [Self-hosting](./SELF_HOSTING.md) — running SmartDeploy itself on EC2 (swap, SSL, Nginx)

---

## 1. Create an IAM user

1. Open **IAM → Users → Create user**.
2. Username: `smartdeploy-service` (or any name you prefer).
3. Select **Provide user access to the AWS Management Console** only if you want console access; it is not required for API access keys.
4. Click **Next**.

---

## 2. Attach a custom policy

Create a **Customer managed policy** with the JSON below, then attach it to the user.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EC2",
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:Describe*",
        "ec2:CreateTags",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:CreateKeyPair",
        "ec2:CreateLaunchTemplate",
        "ec2:DeleteLaunchTemplate"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ALB",
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancingv2:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SSM",
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation",
        "ssm:DescribeInstanceInformation"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CodeBuildECR",
      "Effect": "Allow",
      "Action": [
        "codebuild:CreateProject",
        "codebuild:UpdateProject",
        "codebuild:StartBuild",
        "codebuild:BatchGetBuilds",
        "codebuild:BatchGetProjects",
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
        "ecr:CreateRepository",
        "ecr:DescribeRepositories",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:GetLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAM",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:CreateRole",
        "iam:PassRole",
        "iam:AttachRolePolicy",
        "iam:CreateInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:GetInstanceProfile",
        "iam:CreateServiceLinkedRole"
      ],
      "Resource": "*"
    },
    {
      "Sid": "STS",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
```

> **Why wildcards?** The app creates and discovers resources dynamically (security groups, listeners, target groups, CodeBuild projects). You can narrow `Resource` to your account or region if your organization requires it.

---

## 3. Access keys and environment variables

### 3.1 Long-lived access keys (local dev, Docker, non-AWS hosts)

1. Open the user → **Security credentials** → **Create access key**.
2. Use case: **Application running outside AWS**.
3. Copy the **Access key ID** and **Secret access key** (shown once).

In `.env` (see also [`.env.example`](../.env.example)):

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | Access key ID |
| `AWS_SECRET_ACCESS_KEY` | Secret access key |
| `AWS_REGION` | Region for EC2, CodeBuild, ECR, ALB (e.g. `us-west-2`) |
| `USE_CODEBUILD` | `true` (default) to build images in CodeBuild and push to ECR |
| `DEPLOYMENT_ACM_CERTIFICATE_ARN` | Optional. ACM certificate ARN in the **same region** as `AWS_REGION` for ALB HTTPS |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Optional. Reduces Docker Hub anonymous rate limits during CodeBuild pulls |
| `STATIC_SITE_BUCKET` | Optional. S3 bucket for **static_build** (no container start command) deploys: CodeBuild syncs build output here. |
| `STATIC_SITE_PUBLIC_BASE_URL` | Required when using static S3 deploys. Public site URL (e.g. `https://d123.cloudfront.net` or your domain). |
| `STATIC_SITE_KEY_PREFIX` | Optional. Key prefix inside the bucket (defaults derived from repo/service). |
| `STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID` | Optional. When set, CodeBuild runs a CloudFront invalidation after sync. |

When `STATIC_SITE_BUCKET` and `STATIC_SITE_PUBLIC_BASE_URL` are set, sd-artifacts scans with `deploy_shape: static` or `static_build` (no start command) use CodeBuild → S3 instead of ECR/ECS.

| Variable | Description |
|----------|-------------|
| `ECS_CLUSTER_NAME` | ECS cluster for Fargate services (e.g. `smart-deploy-cluster`) |
| `ECS_SUBNET_IDS` | Comma-separated subnet IDs (≥2 AZs recommended; used for Fargate and the shared ALB) |
| `ECS_SECURITY_GROUP_IDS` | Comma-separated security group(s) for tasks; Smart Deploy opens ingress from the ALB SG at deploy time |
| `ECS_EXECUTION_ROLE_ARN` | Task execution role (ECR pull + CloudWatch Logs) |
| `ECS_ASSIGN_PUBLIC_IP` | `ENABLED` for public subnets (default from Terraform); `DISABLED` for private subnets with NAT |
| `ECS_LOG_GROUP` | Optional. Defaults to `/ecs/smartdeploy-railpack` |
| `ECS_TASK_CPU` / `ECS_TASK_MEMORY` | Optional Fargate sizing (defaults `512` / `1024`) |

Container deploys (Railpack server, `existing_docker`) require the ECS variables above. Static deploys require the `STATIC_SITE_*` variables.

### 3.2 Platform infrastructure (Terraform)

Instead of creating the S3 bucket, CloudFront distribution, ECS cluster, and Fargate networking by hand, use the Terraform stack:

```bash
cd infra/smart-deploy-platform
cp terraform.tfvars.example terraform.tfvars
terraform init && terraform apply
terraform output -raw smart_deploy_env_snippet
```

Paste the snippet into `.env`. If you already created the bucket or cluster manually, set `create_s3_bucket = false` and/or `create_ecs_cluster = false` in `terraform.tfvars` (see [infra/smart-deploy-platform/README.md](../../infra/smart-deploy-platform/README.md)).

### 3.3 Deployment queue (required for deploys)

Smart Deploy enqueues each deploy to **SQS**; a **Lambda** handler launches a **one-off ECS Fargate task** to run the pipeline. Enable this in `terraform.tfvars`:

```hcl
enable_deployment_queue           = true
deployment_queue_lambda_image_uri = "<account>.dkr.ecr.<region>.amazonaws.com/smart-deploy-deployment-queue:latest"
deployment_worker_image           = "<account>.dkr.ecr.<region>.amazonaws.com/smart-deploy-worker:latest"
deployment_worker_secret_arn      = "arn:aws:secretsmanager:..."
```

Build and push `Dockerfile.websocket` and `Dockerfile.deployment-queue-lambda` before `terraform apply`. Full walkthrough: [infra/smart-deploy-platform/README.md](../../infra/smart-deploy-platform/README.md).

| Variable | Description |
|----------|-------------|
| `DEPLOYMENT_QUEUE_URL` | SQS FIFO queue URL (included in Terraform `smart_deploy_env_snippet`) |
| `DEPLOYMENT_EVENTS_TOKEN` | Shared secret so ECS deployment runners can POST live logs to the WebSocket worker |
| `DEPLOYMENT_EVENTS_URL` | Optional. HTTP base URL for the WebSocket worker (defaults from `NEXT_PUBLIC_WS_URL`) |
| `DEPLOYMENT_WORKER_TASK_DEFINITION_ARN` | Set on the Lambda; Terraform manages this when the queue is enabled |

Roll out updated worker and Lambda images with `./scripts/update.sh` from the repository root.

The Smart Deploy service IAM user (or EC2 instance role) also needs `sqs:SendMessage` on the deployment queue ARN so the app can enqueue runs.

If the Next.js app and worker run on EC2, attach an IAM role with the **same policy** instead of embedding keys. Leave `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` unset; the AWS SDK uses the instance metadata role automatically.

1. **IAM → Roles → Create role** → AWS service → **EC2**.
2. Attach the custom policy from §2.
3. **EC2 → instance → Actions → Security → Modify IAM role** → select the role.

Details: [Self-hosting](./SELF_HOSTING.md).

---

## 4. HTTPS on the ALB (ACM)

1. Open **ACM** in the **same region** as `AWS_REGION`.
2. Request a public certificate (wildcard or hostname you will use).
3. Complete DNS validation.
4. Set `DEPLOYMENT_ACM_CERTIFICATE_ARN` in `.env`.

SmartDeploy creates an HTTPS (443) listener and can redirect HTTP to HTTPS. More context: [Custom domains](./CUSTOM_DOMAINS.md).

---

## 5. Optional: AWS Bedrock (LLM)

To use Bedrock instead of or alongside Gemini, add credentials that include `bedrock:InvokeModel` (same IAM user or a dedicated user):

```
AWS_BEDROCK_ACCESS_KEY_ID=AKIA...
AWS_BEDROCK_SECRET_ACCESS_KEY=...
BEDROCK_MODEL_ID=anthropic.claude-opus-4-5-v1:0
```

Extend the IAM policy with Bedrock invoke permissions if you use a separate key.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| ECS or shared-networking permission denied | Confirm the IAM policy includes the required ECS, ELBv2, EC2 networking, and IAM actions. |
| `ec2:CreateTags` denied | Include `ec2:CreateTags` in the policy (see §2). |
| ALB / `DEPLOYMENT_ACM_CERTIFICATE_ARN` | Certificate must be **issued** (not pending) and in the **same region** as the deployment. |
| ECS rollout or task startup issues | Check ECS service events, task logs, and execution-role permissions. |
| CodeBuild “role does not exist” | First deploy creates the CodeBuild service role; verify the IAM block in §2 allows role creation. |
| Docker Hub 429 in CodeBuild | Set `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (read-only token). |

---

## Security tips

- Do not use the AWS account root user for application keys.
- Rotate access keys on a schedule.
- Prefer an EC2 instance role over static keys when self-hosting.
- Enable CloudTrail for API auditing.


