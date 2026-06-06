# Infra Layout

- [smart-deploy-platform](smart-deploy-platform) — **S3 + CloudFront** (static sites) and **ECS Fargate** prerequisites (cluster, execution role, subnets/SG, log group). Run this before container or static S3 deploys.
- [aws-worker](aws-worker) is the update-existing setup tied to the live worker state.
- [aws-worker-new](aws-worker-new) is the fresh-instance setup for creating a brand-new worker with its own state.

Use **smart-deploy-platform** once per AWS account/region. Use the worker stacks when you need a WebSocket/deploy worker on EC2.
