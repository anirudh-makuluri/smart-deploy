# AWS setup

SmartDeploy uses AWS for **EC2** deployments, **CodeBuild** + **ECR** for remote Docker image builds, an **Application Load Balancer (ALB)** for HTTPS and custom-domain routing, **SSM** for remote commands, **STS** for identity checks, and optionally **ACM** for TLS certificates on the ALB.

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
| `EC2_ACM_CERTIFICATE_ARN` | Optional. ACM certificate ARN in the **same region** as `AWS_REGION` for ALB HTTPS |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Optional. Reduces Docker Hub anonymous rate limits during CodeBuild pulls |

### 3.2 IAM instance role (SmartDeploy running on EC2)

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
4. Set `EC2_ACM_CERTIFICATE_ARN` in `.env`.

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
| `UnauthorizedOperation: ec2:RunInstances` | Confirm the EC2 statement is attached to the principal in use. |
| `ec2:CreateTags` denied | Include `ec2:CreateTags` in the policy (see §2). |
| ALB / `EC2_ACM_CERTIFICATE_ARN` | Certificate must be **issued** (not pending) and in the **same region** as the deployment. |
| SSM `SendCommand` issues | EC2 instances need the SSM agent and an instance profile; SmartDeploy wires `AmazonSSMManagedInstanceCore` when it creates roles. |
| CodeBuild “role does not exist” | First deploy creates the CodeBuild service role; verify the IAM block in §2 allows role creation. |
| Docker Hub 429 in CodeBuild | Set `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (read-only token). |

---

## Security tips

- Do not use the AWS account root user for application keys.
- Rotate access keys on a schedule.
- Prefer an EC2 instance role over static keys when self-hosting.
- Enable CloudTrail for API auditing.
