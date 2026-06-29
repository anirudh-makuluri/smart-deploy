# Google Cloud Platform setup

SmartDeploy can deploy applications to **Google Cloud Run** and provision **Cloud SQL** when a database is detected. This guide covers billing, APIs, service accounts, environment variables, and the `gcloud` CLI.

**Related:** [AWS setup](./AWS_SETUP.md) (if you use EC2 instead of or in addition to GCP).

---

## 1. Billing and project

1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Ensure a **billing account** is linked to your project (required for Cloud Run, Cloud Build, and Cloud SQL).
3. **Create a project** (project dropdown → **New Project**), note the **Project ID**.

---

## 2. Enable required APIs

In **APIs & Services → Library**, enable at least:

| API | Purpose |
|-----|---------|
| **Cloud Run Admin API** | Deploy and manage services |
| **Cloud Build API** | Build container images |
| **Artifact Registry API** | Registry used with builds (if applicable to your flow) |
| **Cloud Logging API** | Logs in the console and for `gcloud` log tail |

If deployments provision **Cloud SQL**, also enable:

| API | Purpose |
|-----|---------|
| **Cloud SQL Admin API** (`sqladmin.googleapis.com`) | Create and manage instances |

Or enable everything needed in one `gcloud` command:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  logging.googleapis.com \
  sqladmin.googleapis.com
```

---

## 3. Region note

Cloud Run deploy and Cloud SQL creation in this codebase use **`us-central1`**. Keep keys, APIs, and any regional resources consistent with that region unless you change the code.

---

## 4. Create a service account

1. Go to **IAM & Admin → Service Accounts → Create Service Account**.
2. Name: e.g. `smartdeploy-bot`.
3. Grant roles (minimum for deploy + logs):

   - **Cloud Run Admin** (`roles/run.admin`)
   - **Cloud Build Editor** (`roles/cloudbuild.builds.editor`)
   - **Storage Admin** (`roles/storage.admin`) — Cloud Build may need this for build artifacts / staging
   - **Service Account User** (`roles/iam.serviceAccountUser`) — deploy Cloud Run as the runtime service account
   - **Logs Viewer** (`roles/logging.viewer`)

4. If you use **Cloud SQL** provisioning from SmartDeploy, add:

   - **Cloud SQL Admin** (`roles/cloudsql.admin`) (or a narrower custom role that allows `sql.instances.create` and related operations your flows need)

5. Click **Done**.

---

## 5. Create a JSON key

1. Open the service account → **Keys** → **Add key → Create new key → JSON**.
2. Download the file and store it securely.

---

## 6. Add to `.env`

Paste the **entire JSON** as a single line (escape quotes if your shell requires it), or use a secrets manager and inject at runtime:

```
GCP_PROJECT_ID=your-project-id
GCP_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...",...}
```

The application parses `GCP_SERVICE_ACCOUNT_KEY` as JSON. See [`.env.example`](../.env.example).

---

## 7. Install the `gcloud` CLI (recommended)

The worker runs `gcloud` for Cloud Run auth, builds, deploy, and Cloud SQL. Install the SDK: [Install the Google Cloud CLI](https://cloud.google.com/sdk/docs/install).

Authenticate for local or VM workers:

```bash
gcloud auth activate-service-account --key-file=path/to/key.json
gcloud config set project YOUR_PROJECT_ID
```

**Docker:** The default WebSocket worker image may not include `gcloud`. Extend `Dockerfile.websocket` (or your image) to install the CLI if deploys run fully inside Docker.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Permission denied on Cloud Run | **Cloud Run Admin** + **Service Account User** on the deployer SA. |
| Cloud Build API not enabled | Run `gcloud services enable cloudbuild.googleapis.com`. |
| Cloud SQL creation fails with API error | Run `gcloud services enable sqladmin.googleapis.com` and ensure **Cloud SQL Admin** (or equivalent) is on the service account. |
| Logs missing | Add **Logs Viewer** to the service account. |
| `gcloud: command not found` | Install the CLI on the host running the worker, or bake it into the worker image. |
| Billing errors | Link an active billing account to the project. |
