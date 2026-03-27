# AWS IAM Setup

SmartDeploy deploys Docker containers to **EC2** instances. It also uses CodeBuild + ECR for remote image builds, an Application Load Balancer (ALB) for HTTPS/custom-domain routing, SSM for remote commands, and STS for identity checks.

This guide walks through creating an IAM user (or role) with the permissions the app actually needs.

---

## 1. Create an IAM user

1. Open **IAM -> Users -> Create user**.
2. Username: `smartdeploy-service` (or any name you like).
3. Select **Provide user access to the AWS Management Console** only if you also want console access; it is not required.
4. Click **Next**.

---

## 2. Attach a custom policy

Create a new **Customer managed policy** with the JSON below, then attach it to the user.

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

> **Why wildcards on some services?** The app creates/describes resources dynamically (security groups, ALB listeners, target groups, CodeBuild projects) so scoping to specific ARNs is impractical. You can tighten `Resource` to your account/region if desired.

---

## 3. Create access keys

1. Open the user -> **Security credentials** tab -> **Create access key**.
2. Select **Application running outside AWS** (works from localhost, EC2, Docker, anywhere).
3. Copy the **Access key ID** and **Secret access key** (shown only once).

Add them to your `.env`:

```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=wJal...
AWS_REGION=us-west-2
```

### Alternative: IAM instance role (if self-hosting on EC2)

If SmartDeploy itself runs on an EC2 instance, you can attach a role with the same policy instead of using access keys. Leave `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` blank; the AWS SDK picks up the instance role automatically.

1. **IAM -> Roles -> Create role** -> AWS service -> EC2.
2. Attach the same custom policy.
3. **EC2 -> your instance -> Actions -> Security -> Modify IAM role** -> select the role.

---

## 4. (Optional) ACM certificate for HTTPS

If you want the shared ALB to serve HTTPS with a custom domain:

1. Open **ACM** (AWS Certificate Manager) **in the same region** as your deployments.
2. **Request a public certificate** for `*.yourdomain.com` (or the specific subdomain).
3. Complete DNS validation (add the CNAME ACM gives you to your domain's DNS).
4. Once issued, copy the certificate ARN and add it to `.env`:

```
EC2_ACM_CERTIFICATE_ARN=arn:aws:acm:us-west-2:123456789012:certificate/abc-123...
```

When this is set, SmartDeploy creates an HTTPS (443) listener on the ALB and redirects HTTP to HTTPS.

---

## 5. (Optional) Bedrock LLM credentials

If you want to use **AWS Bedrock** for AI analysis instead of (or alongside) Gemini:

```
AWS_BEDROCK_ACCESS_KEY_ID=AKIA...
AWS_BEDROCK_SECRET_ACCESS_KEY=...
BEDROCK_MODEL_ID=anthropic.claude-opus-4-5-v1:0
```

These can be the same keys as above if the policy also includes `bedrock:InvokeModel`, or a separate user scoped to Bedrock only.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `UnauthorizedOperation: ec2:RunInstances` | Verify the EC2 statement is attached. |
| `ec2:CreateTags` denied | Ensure `ec2:CreateTags` is in the policy (it is above). |
| ALB listener fails / `EC2_ACM_CERTIFICATE_ARN` error | Certificate must be **issued** (not pending) and in the **same region**. |
| SSM `SendCommand` timeout | The EC2 instance needs the **SSM agent** running and an instance profile with `AmazonSSMManagedInstanceCore`. SmartDeploy creates this automatically. |
| CodeBuild "role does not exist" | On first deploy the app creates the CodeBuild service role. If IAM creation fails, check the IAM statement. |

---

## Security tips

- Never use root account credentials.
- Rotate access keys periodically.
- If running on EC2, prefer an instance role over static keys.
- Enable CloudTrail for audit logging.
