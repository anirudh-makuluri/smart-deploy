# AWS IAM Setup Guide for SmartDeploy

## Overview

SmartDeploy requires AWS credentials with permissions to deploy applications to Elastic Beanstalk, ECS, EC2, and provision RDS databases. This guide shows you how to create an IAM user with the minimum required permissions.

## Step 1: Create IAM User

1. Go to AWS Console → IAM → Users
2. Click "Create user"
3. Enter username: `smartdeploy-service-user`
4. Select "Access key - Programmatic access"
5. Click "Next"

## Step 2: Attach Permissions Policy

### Option A: Use Custom Policy (Recommended)

Create a custom policy with the following JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["elasticbeanstalk:*", "cloudformation:*", "autoscaling:*", "elasticloadbalancing:*"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["ecs:*", "ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:CreateRepository", "ecr:DescribeRepositories"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["ec2:RunInstances", "ec2:CreateTags", "ec2:Describe*", "ec2:TerminateInstances", "ec2:StartInstances", "ec2:StopInstances", "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup", "ec2:AuthorizeSecurityGroup*", "ec2:RevokeSecurityGroup*", "ec2:CreateKeyPair", "ec2:CreateLaunchTemplate*", "ec2:DeleteLaunchTemplate"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["rds:CreateDBInstance", "rds:DescribeDB*", "rds:ModifyDBInstance", "rds:DeleteDBInstance", "rds:CreateDBSubnetGroup", "rds:DeleteDBSubnetGroup", "rds:CreateDBSnapshot"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:CreateBucket", "s3:ListBucket", "s3:*BucketPolicy", "s3:*BucketOwnershipControls"],
      "Resource": ["arn:aws:s3:::smartdeploy-eb-*", "arn:aws:s3:::elasticbeanstalk-*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:*ObjectAcl"],
      "Resource": ["arn:aws:s3:::smartdeploy-eb-*/*", "arn:aws:s3:::elasticbeanstalk-*/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["iam:GetRole", "iam:PassRole"],
      "Resource": ["arn:aws:iam::*:role/ecsTask*Role", "arn:aws:iam::*:role/aws-elasticbeanstalk-*-role"]
    },
    {
      "Effect": "Allow",
      "Action": "iam:CreateServiceLinkedRole",
      "Resource": "arn:aws:iam::*:role/aws-service-role/*"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:*", "cloudwatch:*", "sns:*", "sqs:*", "sts:GetCallerIdentity"],
      "Resource": "*"
    }
  ]
}
```

### Option B: Use AWS Managed Policies (Less Secure)

You can attach these managed policies, but they grant broader permissions than needed:

- `AWSElasticBeanstalkFullAccess`
- `AmazonECS_FullAccess`
- `AmazonEC2FullAccess`
- `AmazonRDSFullAccess`
- `AmazonS3FullAccess`
- `AmazonEC2ContainerRegistryFullAccess`

**Note:** Using managed policies grants more permissions than necessary. The custom policy above is more secure.

**Policy optimization:** The custom policy uses wildcards (e.g., `elasticbeanstalk:*`, `ec2:Describe*`) to stay under AWS's 6144 character limit while covering all required actions. This is slightly broader than listing individual actions but still scoped to the services SmartDeploy needs.

**S3 buckets:** The policy allows two bucket name patterns:
- `smartdeploy-eb-*` — buckets created by SmartDeploy for deployment artifacts
- `elasticbeanstalk-*` — the **default bucket Elastic Beanstalk creates** per region (e.g. `elasticbeanstalk-us-west-2-328342419078`). Without this, `CreateApplication` fails with `s3:CreateBucket` denied.

## Step 3: Choose Authentication Method

**Which option should I choose?**

- **Running SmartDeploy on EC2?** → Use **Option A: IAM Instance Role** (more secure, recommended)
- **Running SmartDeploy locally or on non-AWS infrastructure?** → Use **Option B: Access Keys**
- **Running in Docker on EC2?** → Can use either, but **Option A is recommended**

### Option A: IAM Instance Role (Recommended if running on EC2)

If SmartDeploy is running on an EC2 instance, **use IAM instance roles** instead of access keys. This is more secure and follows AWS best practices.

1. Go to IAM → Roles → Create role
2. Select "AWS service" → "EC2"
3. Click "Next"
4. Attach the same policy from Step 2 (the custom policy)
5. Role name: `smartdeploy-ec2-role`
6. Click "Create role"
7. Go to EC2 → Select your instance → Actions → Security → Modify IAM role
8. Attach the `smartdeploy-ec2-role` to your EC2 instance

**Benefits:**
- No access keys to manage
- Automatic credential rotation
- More secure (keys never stored in code)
- No need to update `.env` file

**Note:** If using IAM roles, you can leave `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` empty in `.env`. The AWS SDK will automatically use the instance role.

### Option B: Access Keys (For flexibility - localhost + EC2)

If you want to run SmartDeploy from **both localhost and EC2** using the same credentials, use access keys:

1. After creating the user, go to the "Security credentials" tab
2. Click "Create access key"
3. Select **"Application running outside AWS"**
   - **Why this option?** This allows the same access keys to work from:
     - Your local development machine
     - EC2 instances
     - Any other environment
   - **Note:** The selection is just for AWS's tracking purposes. The access keys themselves work identically regardless of which option you choose. "Application running outside AWS" is the most flexible choice.
4. Click "Next" and then "Create access key"
5. **IMPORTANT:** Copy both:
   - **Access key ID**
   - **Secret access key** (shown only once!)

## Step 4: Configure SmartDeploy

### If using IAM Instance Role (Option A):
```bash
# Leave these empty - AWS SDK will use instance role automatically
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-west-2
```

### If using Access Keys (Option B):
```bash
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-west-2
```

**Important:** These same credentials will work from:
- Localhost/development machine
- EC2 instances
- Docker containers
- Any environment where you set these environment variables

## Step 5a: Create Elastic Beanstalk EC2 Instance Profile (Required for EB)

Elastic Beanstalk environments need an **instance profile** (IAM role for EC2) so instances can pull the application and write logs. Create it once per account:

1. Go to **IAM → Roles → Create role**
2. Select **AWS service** → **Elastic Beanstalk** → **Elastic Beanstalk - Customizable**
   - Or choose **EC2** and attach the policy in step 4.
3. Click **Next**
4. Attach the managed policy **AWSElasticBeanstalkWebTier** (and **AWSElasticBeanstalkWorkerTier** if you use workers).
5. Click **Next**
6. Role name: **aws-elasticbeanstalk-ec2-role** (SmartDeploy uses this name by default).
7. Click **Create role**

To use a different role name, set `AWS_EB_INSTANCE_PROFILE` in your `.env` to that name and add that role to the IAM policy’s PassRole resources.

## Step 5b: Create Elastic Beanstalk Service Role (Required for EB)

Elastic Beanstalk needs a **service role** so the EB service can manage EC2, Auto Scaling, ELB, etc. Create it once per account and attach **both** of these managed policies (required for instances to launch):

1. Go to **IAM → Roles → Create role**
2. Select **AWS service** → **Elastic Beanstalk** → **Elastic Beanstalk - Customizable**
3. Click **Next**
4. **Attach both** of these policies (both are required for the environment to create instances):
   - **AWSElasticBeanstalkEnhancedHealth** – health monitoring
   - **AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy** – EC2/ASG/ELB and other operations (without this, you get “no instances”)
5. Click **Next**
6. Role name: **aws-elasticbeanstalk-service-role** (SmartDeploy uses this name by default).
7. Click **Create role**

To use a different name, set `AWS_EB_SERVICE_ROLE` in your `.env` and add that role to the IAM policy’s PassRole resources.

## Step 5: Create ECS Task Execution Role (Required for ECS)

ECS deployments require a task execution role. Create it:

1. Go to IAM → Roles → Create role
2. Select "AWS service" → "Elastic Container Service" → "Elastic Container Service Task"
3. Click "Next"
4. Attach policy: `AmazonECSTaskExecutionRolePolicy`
5. Role name: `ecsTaskExecutionRole`
6. Click "Create role"

**Note:** The IAM user needs permission to pass this role to ECS tasks.

## Security Best Practices

1. **Use IAM User (Not Root Account)**: Never use root account credentials
2. **Principle of Least Privilege**: Only grant permissions needed for deployment
3. **Rotate Keys Regularly**: Rotate access keys every 90 days
4. **Use IAM Roles When Possible**: If running on EC2, use instance roles instead of access keys
5. **Enable MFA**: Add MFA to the IAM user for additional security
6. **Monitor Usage**: Enable CloudTrail to monitor API calls

## Troubleshooting

**Note:** The optimized policy in Step 2 uses wildcards (e.g., `elasticbeanstalk:*`, `autoscaling:*`) that cover all common permission errors. If you encounter any "Access Denied" error below, first ensure you're using the **complete, current policy** from Step 2.

### "Access Denied" Errors

- Verify the IAM user has the **complete policy** from Step 2 (not a partial or older version)
- Check that the access keys are correct in `.env`
- Ensure the region matches your AWS resources

### EC2 RunInstances / CreateTags (UnauthorizedOperation)

If you see `User is not authorized to perform: ec2:CreateTags on resource: arn:aws:ec2:...:instance/*`, add **ec2:CreateTags** to the EC2Permissions statement in your IAM policy (see Step 2). EC2 launches use tag-specifications for instance Name and Project; without this permission the launch fails.

### Elastic Beanstalk / CloudFormation – ec2:RevokeSecurityGroupEgress (security group creation failed)

If the EB environment fails with `Creating security group named: sg-... failed` and `User is not authorized to perform: ec2:RevokeSecurityGroupEgress`, add **ec2:RevokeSecurityGroupEgress** and **ec2:AuthorizeSecurityGroupEgress** to the EC2Permissions statement in your IAM policy (see Step 2). Elastic Beanstalk/CloudFormation needs these when creating the load balancer security group.

### Elastic Beanstalk – elasticloadbalancing:CreateLoadBalancer / AWSEBEC2LaunchTemplate (CREATE_FAILED)

If the stack fails with `Creating load balancer failed` and `User is not authorized to perform: elasticloadbalancing:CreateLoadBalancer`, or **AWSEBLoadBalancer** / **AWSEBEC2LaunchTemplate** failed to create, add the **ElasticLoadBalancingPermissions** statement and the EC2 launch template actions (**ec2:CreateLaunchTemplate**, **ec2:DescribeLaunchTemplates**, etc.) from Step 2. Elastic Beanstalk needs these to create the environment’s load balancer and launch template.

### Elastic Beanstalk – iam:CreateServiceLinkedRole (Creating load balancer failed)

If you see `User is not authorized to perform: iam:CreateServiceLinkedRole on resource: .../AWSServiceRoleForElasticLoadBalancing`, add `elasticloadbalancing.amazonaws.com` to the **IAMServiceLinkedRoles** statement from Step 2. It allows creating the ELB service-linked role once per account. Without it, CreateLoadBalancer fails.

### Elastic Beanstalk – ec2:DescribeAccountAttributes (Creating load balancer failed)

If you see `User is not authorized to perform: ec2:DescribeAccountAttributes` during load balancer creation, add **ec2:DescribeAccountAttributes** to the EC2Permissions statement in Step 2. ELB uses it when creating the load balancer.

### Elastic Beanstalk – elasticloadbalancing:SetLoadBalancerPoliciesOfListener (Creating load balancer failed)

If you see `User is not authorized to perform: elasticloadbalancing:SetLoadBalancerPoliciesOfListener`, add **elasticloadbalancing:SetLoadBalancerPoliciesOfListener** and related actions (**CreateLoadBalancerPolicy**, **CreateLoadBalancerListeners**, **DescribeLoadBalancerPolicies**, etc.) to the ElasticLoadBalancingPermissions statement in Step 2.

### Elastic Beanstalk – autoscaling:DescribeAutoScalingGroups / AWSEBAutoScalingGroup (CREATE_FAILED)

If the stack fails with `Creating Auto Scaling group named: ... failed` and `User is not authorized to perform: autoscaling:DescribeAutoScalingGroups` (resource **AWSEBAutoScalingGroup**), add the **AutoScalingPermissions** statement from Step 2. Elastic Beanstalk uses Auto Scaling to manage the environment’s instances; without these permissions the Auto Scaling group cannot be created.

### Elastic Beanstalk – iam:CreateServiceLinkedRole for Auto Scaling (AWSEBAutoScalingGroup CREATE_FAILED)

If creating the Auto Scaling group fails with `The default Service-Linked Role for Auto Scaling could not be created` and `User is not authorized to perform: iam:CreateServiceLinkedRole on resource: .../AWSServiceRoleForAutoScaling`, add `autoscaling.amazonaws.com` to the **IAMServiceLinkedRoles** statement in Step 2. The first time Auto Scaling is used in an account, AWS must create a service-linked role; without this permission, the EB environment cannot create its Auto Scaling group.

### Elastic Beanstalk – SNS / CloudWatch / SQS permissions

If EB fails with permission errors related to **sns:**, **cloudwatch:**, or **sqs:** actions, ensure you have the **SNSPermissions**, **CloudWatchAlarmsPermissions**, and **SQSPermissions** statements from Step 2. Elastic Beanstalk uses:
- **SNS** for environment notifications (health alerts, deployment events)
- **CloudWatch** for alarms and metrics monitoring
- **SQS** for worker-tier environments (background job queues)

### S3 – GetBucketPolicy / PutBucketPolicy

If Elastic Beanstalk or deployment fails with an S3 bucket policy permission error, add **s3:GetBucketPolicy** and **s3:PutBucketPolicy** to the S3BucketPermissions statement (see Step 2).

### Elastic Beanstalk CreateApplication / s3:PutBucketOwnershipControls (InsufficientPrivilegesException)

If you see `User is not authorized to perform: s3:PutBucketOwnershipControls on resource: arn:aws:s3:::elasticbeanstalk-...`, add **s3:PutBucketOwnershipControls** to the S3BucketPermissions statement in your IAM policy (see Step 2). Elastic Beanstalk needs this when creating or configuring its default S3 bucket.

### Elastic Beanstalk "Environment must have instance profile associated with it"

Create the **Elastic Beanstalk EC2 instance profile** and use it when creating the environment (see **Step 5a**). SmartDeploy passes the instance profile via option settings; the default role name is `aws-elasticbeanstalk-ec2-role`. Ensure that role exists and the IAM user has **iam:PassRole** for it (see Step 2 IAMPermissions).

### Elastic Beanstalk "environment needs a service role" / missing service-linked role

Create the **Elastic Beanstalk service role** (see **Step 5b**). SmartDeploy passes it via option settings; the default name is `aws-elasticbeanstalk-service-role`. Create that role, attach **both** **AWSElasticBeanstalkEnhancedHealth** and **AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy**, and ensure the IAM user has **iam:PassRole** for it (Step 2 IAMPermissions).

### Elastic Beanstalk "Initialization in progress" / "There are no instances"

If the environment stays in *Initialization* and shows **no instances** (or Grey / None):

1. **Check Events** – In AWS Console → Elastic Beanstalk → your environment → **Events**. The exact failure (e.g. insufficient capacity, invalid instance profile, launch error) appears there.
2. **Service role has both policies** – The EB **service role** (`aws-elasticbeanstalk-service-role`) must have **both** **AWSElasticBeanstalkEnhancedHealth** and **AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy**. Without the second, EB cannot create EC2/ASG and no instances launch. In IAM → Roles → `aws-elasticbeanstalk-service-role` → Permissions, attach **AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy** if it’s missing.
3. **Instance profile** – Ensure the EC2 instance profile (`aws-elasticbeanstalk-ec2-role`) exists and has **AWSElasticBeanstalkWebTier** (Step 5a).
4. **VPC/subnet** – If the environment uses a custom VPC, ensure the configured subnets have a route to the internet (e.g. via Internet Gateway or NAT) if instances need to pull the app or report health.

### Elastic Beanstalk – "Instance deployment failed" / "Engine execution has encountered an error" / eb-engine.log

If the environment is created but deployment fails on the instance with **Command failed on instance**, **Engine execution has encountered an error**, or **Your source bundle has issues**, the app or bundle is failing on the EC2 instance.

**Get eb-engine.log:** In the AWS Console go to **Elastic Beanstalk → your application → your environment**. Click **Logs** in the left sidebar, then **Request Logs → Full Logs**, and click **Download**. Unzip the downloaded file and open **var/log/eb-engine.log** (and **var/log/web.stdout.log** for app output). The last lines of eb-engine.log usually show the exact error (e.g. missing script, npm failure, wrong Node version). If you use the EB CLI: run `eb logs` in the app directory to download the same logs.

**Zip "backslashes as path separators" / unzip failed:** If eb-engine.log shows `app_source_bundle appears to use backslashes as path separators` and `unzip ... failed`, the deployment bundle was created on Windows with path separators that Linux unzip rejects. SmartDeploy now creates zips with the **archiver** library so entries use forward slashes; redeploy with the latest code.

Then:

1. **Node.js: require `package.json` and start script** – The deployment directory (your **workdir** or repo root) must contain **package.json** at the zip root. Ensure **package.json** has a **"start"** script (e.g. `"start": "node server.js"` or `"start": "npm run serve"`). SmartDeploy runs a pre-deploy check and will error early if "start" is missing.
2. **Listen on PORT** – The app must listen on the port provided in the **PORT** environment variable (default 8080). SmartDeploy adds this via `.ebextensions`; ensure your app uses `process.env.PORT` (Node) or the equivalent in other runtimes.
3. **Monorepos / workdir** – If **workdir** is a subdirectory (e.g. `app`), that directory is zipped. It must contain **package.json** (and for Node, **package-lock.json** or **yarn.lock** is recommended). If **package.json** is only at repo root, set workdir to the repo root or ensure the subdirectory has its own **package.json** with a **start** script.
4. **Build step** – Elastic Beanstalk runs `npm install --production` on the instance; it does not run `npm run build` unless you add a custom hook. If your app needs a build (e.g. Next.js, React), either add an `.ebextensions` hook to run the build, or deploy a pre-built bundle (e.g. run `npm run build` locally and include the output in the zip).

After fixing the app or bundle, deploy a new version (create application version and update environment), or redeploy from SmartDeploy. If you paste the last ~30 lines of **eb-engine.log** here, the exact fix can be identified.

### Elastic Beanstalk – "Job for web.service failed" / "Register application failed" / FlipApplication

If eb-engine.log shows **Job for web.service failed because the control process exited with error code** and **Register application failed because the registration of proc web failed**, the bundle was extracted but the **web** process (your app) failed to start. The real error is in the application logs, not eb-engine.log.

1. **Open var/log/web.stdout.log and var/log/web.stderr.log** (same Full Logs zip). They show the output of `npm start` and any Node.js errors (e.g. "Error: listen EADDRINUSE", "Cannot find module", syntax error, or your app’s stack trace).
2. **Listen on PORT** – The app must bind to `process.env.PORT` (EB sets this to 8080). If your code uses a fixed port (e.g. 3000), change it to `const port = process.env.PORT || 3000` and `app.listen(port)`.
3. **Build step** – If the app needs `npm run build` before `npm start` (e.g. Next.js, TypeScript, or a frontend build), EB only runs `npm install --production` and `npm start`. Add an `.ebextensions` build hook to run your build, or deploy a pre-built artifact.
4. **Node version** – The EB Node.js platform uses a specific Node version (e.g. 20). If your app requires a different version, set **Engines** in package.json or choose a different solution stack that matches.

Paste the last 20–30 lines of **web.stdout.log** or **web.stderr.log** to get a precise fix.

### Elastic Beanstalk – "next: command not found" (Next.js)

If web.stdout.log shows **next: command not found**, the `next` CLI was not installed. The deployment zip excludes **node_modules**; the platform runs **npm install --production** by default. SmartDeploy adds a step that runs **npm install** (no --production) so devDependencies like next are installed.

**Optional (if the deploy step does not run):** In your app’s **package.json**, move **"next"** from **devDependencies** to **dependencies**. Then redeploy. Example:

```json
"dependencies": {
  "next": "^14.0.0",
  "react": "...",
  ...
},
"devDependencies": {
  ...
}
```

SmartDeploy runs **npm install** (no --production) and **npm run build** for Next.js via `.ebextensions`, so devDependencies like next are installed. Redeploy with the latest SmartDeploy if you still see the error.

### Elastic Beanstalk "Failed to launch environment" / CloudFormation (DescribeStacks)

If the environment fails to launch with `User is not authorized to perform: cloudformation:DescribeStacks`, add the **CloudFormationPermissions** statement from Step 2 (CreateStack, UpdateStack, DescribeStacks, DescribeStackEvents, DescribeStackResources, etc.). Elastic Beanstalk uses CloudFormation to create each environment.

### Elastic Beanstalk / S3 GetObjectAcl (Access Denied)

If you see `You do not have permission to perform the 's3:GetObjectAcl' action`, add **s3:GetObjectAcl** and **s3:PutObjectAcl** to the S3ObjectPermissions statement in your IAM policy (see Step 2). Elastic Beanstalk may use these when managing deployment artifacts in S3.

### ECS Deployment Fails

- Verify `ecsTaskExecutionRole` exists in your account
- Ensure the IAM user can pass this role to ECS

### RDS Creation Fails

- Check VPC and subnet permissions
- Verify security group creation permissions
- Ensure DB subnet group creation permissions

## Cost Considerations

The IAM user itself is free. However, the AWS resources created (EC2, ECS, RDS, etc.) will incur charges. Monitor your AWS billing dashboard regularly.
