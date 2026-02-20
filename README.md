# 🚀 SmartDeploy

**SmartDeploy** is a lightweight DevOps automation platform that lets you connect your GitHub repository, configure deployment settings, and deploy to **AWS (Amplify, Elastic Beanstalk, ECS Fargate, EC2)** or **Google Cloud Run** — all in just a few clicks.

It uses **AI to auto-analyze your codebase**, generate build/run commands, detect frameworks and databases, and provide real-time feedback via WebSockets.

---

## ✨ Features

- 🔗 **GitHub Integration** — Pick any of your repositories
- ⚙️ **Custom Config** — Set build/run commands, env vars, workdir, etc.
- 🤖 **AI-Powered Smart Project Scan** — Analyzes your repo, auto-fills deploy config, and recommends the best platform
- ☁️ **Multi-Cloud Deployment** — Deploy to AWS (Amplify, Elastic Beanstalk, ECS Fargate, EC2) or Google Cloud Run
- 🏗️ **Multi-Service Support** — Automatically detects and deploys complex applications with multiple services (frontend/backend, microservices, etc.)
- 🗄️ **Managed Databases** — Automatically provisions Cloud SQL (GCP) or RDS (AWS) when your app needs a database
- 📡 **Live Logs** — Real-time deployment status via WebSocket
- 🔁 **Redeploy & Edit** — Modify config and redeploy anytime
- 🛑 **Control** — Pause, resume, or stop deployed services
- 🌐 **Deployment domain** — All visit links use `https://{service-name}.{your-domain}` (e.g. `*.anirudh-makuluri.xyz`) via `NEXT_PUBLIC_DEPLOYMENT_DOMAIN`
- 💻 **Self-Hosted Dashboard** — Run SmartDeploy itself on a tiny EC2 `t3.micro` (with swap) in your own AWS account

---

## 🧪 Tech Stack

- **Frontend / API**: Next.js (App Router), TailwindCSS, shadcn/ui
- **Backend Data**: Supabase (PostgreSQL)
- **Cloud**: AWS (Amplify, Elastic Beanstalk, ECS Fargate, EC2), Google Cloud Run, Docker
- **Auth**: NextAuth with GitHub & Google OAuth
- **AI**: Google Gemini API (AI Studio)

---

## 🧰 Running Locally

### 1. Clone the Repository

```bash
git clone https://github.com/anirudh-makuluri/smartdeploy.git
cd smartdeploy
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
Create a **.env** with the help of **.env.example** in the root directory.

**Database (Supabase):** Create a project at [supabase.com](https://supabase.com), then run the SQL in `supabase/schema.sql` in the SQL Editor. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API) to `.env`.

### 4. Run the Development Server
```bash
npm run start-all
```

### 5. Enable AI features (Gemini)
Add `GEMINI_API_KEY` to your `.env` (from Google AI Studio).

📦 Docker Desktop must be running to build and push images.

---

## 🧠 AI Capabilities

- Detects language, framework, database, environment files, and more
- Auto-generates install/build/run commands
- Flags issues like missing server or mobile-only code
- Summarizes project structure and deployability
- Generates a structured JSON deployment profile
- Suggests the best deployment target (Amplify, Elastic Beanstalk, ECS Fargate, EC2, Cloud Run) based on your app

## 🏗️ Multi-Service Deployment

SmartDeploy can automatically detect and deploy complex applications with multiple services:

### Detection Methods

1. **Docker Compose Detection**: If your repository contains a `docker-compose.yml` file, SmartDeploy will:
   - Parse the compose file to identify all services
   - Extract build contexts, Dockerfiles, ports, and environment variables
   - Deploy each service separately to Cloud Run
   - Set up inter-service communication via environment variables

2. **Algorithmic Detection**: For repositories without docker-compose, SmartDeploy uses pattern matching to detect:
   - Multiple service directories (e.g., `ui/`, `api/`, `frontend/`, `backend/`)
   - Multiple Dockerfiles in different directories
   - Different programming languages in different directories

### Supported Patterns

- **Frontend/Backend**: Detects `ui/` + `api/` or `frontend/` + `backend/` patterns
- **Microservices**: Detects multiple service directories
- **Full-Stack Apps**: Automatically identifies and deploys separate frontend and backend services

### Example: Code-Craft Application

For a repository like [code-craft](https://github.com/anirudh-makuluri/code-craft) with:
- `ui/` directory (Next.js frontend)
- `api/` directory (.NET backend)

SmartDeploy will:
1. Detect both services automatically
2. Generate appropriate Dockerfiles for each service
3. Deploy the frontend and backend as separate Cloud Run services
4. Configure environment variables for inter-service communication
5. Provide URLs for each deployed service

### Supported Languages

- Node.js (Next.js, Express, etc.)
- Python (Django, FastAPI, etc.)
- Go
- Java (Spring Boot, etc.)
- Rust
- .NET (C#)
- PHP

Each service is deployed independently with its own Dockerfile, build process, and Cloud Run service.

### Database Support (Cloud SQL & RDS)

SmartDeploy automatically detects and provisions databases for your applications:

#### Automatic Database Detection

The system detects database requirements from:
- **.NET Applications**: `appsettings.json`, `appsettings.Development.json` connection strings
- **Environment Files**: `.env` files with database configuration
- **Docker Compose**: Database services in `docker-compose.yml`

#### Supported Databases

- **MSSQL/SQL Server**: Automatically creates a managed SQL Server instance (Cloud SQL on GCP, RDS on AWS)
- **PostgreSQL**: Creates managed PostgreSQL instances (Cloud SQL on GCP, RDS on AWS)
- **MySQL**: Creates managed MySQL instances (Cloud SQL on GCP, RDS on AWS)

#### How It Works

1. **Detection**: Scans your codebase for database connection strings and configurations
2. **Provisioning**: Creates a managed database instance in your cloud account (Cloud SQL on GCP, RDS on AWS)
3. **Connection**: Configures your services (Cloud Run, ECS/EC2, etc.) to connect securely
4. **Environment Variables**: Automatically injects connection strings into your services

#### Example: Code-Craft with MSSQL

For code-craft with a local MSSQL database:

1. SmartDeploy detects the MSSQL connection string from `appsettings.json`
2. Creates a Cloud SQL for SQL Server instance
3. Creates the database specified in your connection string
4. Updates your .NET API service with the Cloud SQL connection string
5. Connects the Cloud Run service to Cloud SQL via Unix socket

**Connection String Format:**
```
Server=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME;Database=YOUR_DB;User Id=USER;Password=PASSWORD;
```

#### Important Notes

- **Managed DB Costs**: Cloud SQL and RDS instances incur charges. On GCP, the system creates a `db-f1-micro` instance by default; on AWS, it uses `db.t3.micro` for RDS (both can be upgraded)
- **Database Migration**: You may need to run migrations after deployment to set up your database schema
- **Credentials**: Database passwords are auto-generated and provided via environment variables
- **Region**: GCP databases are created in `us-central1` to match Cloud Run services; AWS RDS uses your selected region (defaults to `AWS_REGION` in config)

---

## 🌐 Deployment domain (*.anirudh-makuluri.xyz)

All **Visit** / **Open link** URLs use your domain: `https://{service-name}.{NEXT_PUBLIC_DEPLOYMENT_DOMAIN}` (e.g. `myapp.anirudh-makuluri.xyz`). The subdomain is derived from the deployment’s **service name** (sanitized for DNS). There is no per-deployment domain option.

### Automatic Vercel DNS

If you manage your domain in **Vercel**, you can have SmartDeploy **automatically add the CNAME** for each deployment so the subdomain points to the deployment URL (Amplify, Cloud Run, EC2, etc.):

1. **Set the domain** in `.env`: `NEXT_PUBLIC_DEPLOYMENT_DOMAIN=anirudh-makuluri.xyz` and `VERCEL_DOMAIN=anirudh-makuluri.xyz` (or omit `VERCEL_DOMAIN` to use the same value).
2. **Add `VERCEL_TOKEN`** in `.env`: create a token at [Vercel Account → Tokens](https://vercel.com/account/tokens). The domain must already be added to your Vercel project/account.
3. **(Optional)** For team accounts, set `VERCEL_TEAM_ID=team_xxx`.

After a successful deploy, the app calls the Vercel API to create (or update) a CNAME record: subdomain → deployment URL hostname. The UI shows “Added to Vercel DNS. Your site will be at https://myapp.anirudh-makuluri.xyz once DNS propagates.” If the API call fails (e.g. token missing or domain not on Vercel), the manual “In Vercel DNS: CNAME this subdomain → {target}” hint is shown so you can add the record yourself.

### Manual DNS

If you don’t use the Vercel API, point **each subdomain** at your DNS provider: add a **CNAME** record (e.g. `myapp`) → the **target** shown in the UI (e.g. `xxx.amplifyapp.com`). Then in your cloud provider (Amplify, Cloud Run, etc.), add the custom domain for that deployment for HTTPS.

---

## Self-hosting on EC2 (t3.micro)

To run SmartDeploy on a t3.micro (1 GB RAM), add swap so the Docker build can complete. See **[docs/T3_MICRO.md](docs/T3_MICRO.md)** for setup: run `sudo ./scripts/setup-swap.sh` once, then deploy or update as usual.
