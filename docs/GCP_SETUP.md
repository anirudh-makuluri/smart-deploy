# Google Cloud Platform Setup

SmartDeploy can deploy applications to **Google Cloud Run**. This guide covers creating a GCP project, a service account, and the environment variables the app needs.

---

## 1. Create a GCP project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click the project dropdown (top bar) -> **New Project**.
3. Name it (e.g. `smart-deploy`) and click **Create**.
4. Note the **Project ID** (shown under the project name).

---

## 2. Enable required APIs

In the GCP console, go to **APIs & Services -> Library** and enable:

- **Cloud Run Admin API**
- **Cloud Build API**
- **Artifact Registry API**
- **Cloud Logging API**

Or from the `gcloud` CLI:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  logging.googleapis.com
```

---

## 3. Create a service account

1. Go to **IAM & Admin -> Service Accounts -> Create Service Account**.
2. Name: `smartdeploy-bot`.
3. Grant these roles:
   - **Cloud Run Admin** (`roles/run.admin`)
   - **Cloud Build Editor** (`roles/cloudbuild.builds.editor`)
   - **Storage Admin** (`roles/storage.admin`): needed for Cloud Build to push images
   - **Service Account User** (`roles/iam.serviceAccountUser`): needed to deploy to Cloud Run
   - **Logs Viewer** (`roles/logging.viewer`)
4. Click **Done**.

---

## 4. Create a JSON key

1. Open the service account you just created.
2. Go to the **Keys** tab -> **Add Key -> Create new key -> JSON**.
3. Download the `.json` file.

---

## 5. Add to `.env`

Paste the **entire JSON content** as a single line:

```
GCP_PROJECT_ID=smart-deploy-123456
GCP_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"smart-deploy-123456",...}
```

> Alternatively you can base64-encode the JSON and decode it in a wrapper, but the app reads it as a raw JSON string by default.

---

## 6. (Optional) Install the `gcloud` CLI

The WebSocket worker shells out to `gcloud` for some Cloud Run operations. If you're running the worker locally or on a VM:

1. Install: [cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install)
2. Authenticate:

```bash
gcloud auth activate-service-account --key-file=path/to/key.json
gcloud config set project YOUR_PROJECT_ID
```

Inside the Docker Compose stack, `gcloud` is only available if you extend the worker image to install the Google Cloud CLI.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Permission denied on Cloud Run" | Ensure the service account has **Cloud Run Admin** and **Service Account User** roles. |
| "Cloud Build API not enabled" | Enable it in the API library or via `gcloud services enable cloudbuild.googleapis.com`. |
| Logs not showing | Add **Logs Viewer** role to the service account. |
| `gcloud` not found | Install the Google Cloud CLI in the worker environment or extend `Dockerfile.websocket` to include it. |
