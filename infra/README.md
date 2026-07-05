# Infra Layout

- [smart-deploy-platform](smart-deploy-platform) — **S3 + CloudFront** (static sites), **ECS Fargate** prerequisites (cluster, execution role, subnets/SG, log group), and optionally the **deployment queue** (SQS FIFO → Lambda → ECS deployment runner task). Run this before container or static S3 deploys.
- [aws-worker](aws-worker) is the update-existing setup tied to the live worker state.
- [aws-worker-new](aws-worker-new) is the fresh-instance setup for creating a brand-new worker with its own state.

Use **smart-deploy-platform** once per AWS account/region. Enable `enable_deployment_queue = true` in Terraform to provision the SQS/Lambda path that executes deploys on ECS. Use the worker stacks when you need the long-lived WebSocket worker on EC2 (UI, agent, health, log relay).
