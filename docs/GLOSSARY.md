# Glossary

| Term | Definition |
|------|------------|
| **Blueprint** | Visual preview of the deploy pipeline before anything runs |
| **Build verification** | SD Artifacts step that test-builds the Railpack plan during scan |
| **CodeBuild** | AWS service that runs the Docker/static build during deploy |
| **Deploy briefing** | Markdown summary produced at end of Smart Analysis |
| **Deploy shape** | Scan classification: `static`, `static_build`, `server`, `multi`, `existing_docker` |
| **Deploy unit** | One buildable unit in a scan (name, root path, Railpack plan, port) |
| **Deployment Agent** | Read-only AI that inspects deployments via tools (list, details, history, health) |
| **Deployment event bridge** | HTTP path from the ECS deployment runner back to the WebSocket worker for live `deploy:log` / `deploy:steps` events |
| **Deployment launcher** | Lambda function triggered by SQS that starts the ECS deployment runner task |
| **Deployment queue** | SQS FIFO queue that buffers deploy runs before execution |
| **Deployment runner** | Short-lived ECS Fargate task (`deployment-runner.js`) that executes the deploy pipeline for one run |
| **Deployment target** | `ecs` (Fargate container) or `static_s3` (static hosting) |
| **ECS Fargate** | AWS serverless containers used for Railpack and Dockerfile deploys |
| **Failure code** | Structured deploy failure identifier (for example `DEPLOYMENT_VERIFICATION_FAILED`) |
| **Failure classification** | Summary, likely cause, evidence, and retryable flag for a failed run |
| **Hosted subdomain** | User-chosen hostname label on the platform domain |
| **Improve scan** | Feedback flow to SD Artifacts to fix scan/build plan after failures |
| **Mise** | Runtime/toolchain manager used inside Railpack builds |
| **Package path** | Repo-relative directory scoped for a service scan (for example `apps/web`) |
| **Railpack** | Build system generating plans and container images from repo analysis |
| **Railpack plan** | JSON build spec (`steps`, `deploy.startCommand`) used as CodeBuild input |
| **Release artifact** | Stored ECR image or S3 path metadata for a successful deploy |
| **Runtime health** | Ongoing probes of app HTTP, ECS, and ALB after deploy succeeds |
| **SD Artifacts** | Backend service for scan, Railpack, build verification, and improve-scan |
| **Service catalog** | List of detected deployable services on a repo page |
| **Smart Analysis** | User-facing name for the repo scan / analyze stream |
| **Verify step** | Post-deploy HTTP probes until app responds or timeout |
| **WebSocket worker** | Long-lived process for real-time UI, Deployment Agent, runtime health, and relaying live deploy logs from ECS tasks |