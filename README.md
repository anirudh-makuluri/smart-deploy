# 🚀 SmartDeploy

**SmartDeploy** is a lightweight DevOps automation platform that lets you connect your GitHub repository, configure deployment settings, and deploy to **Google Cloud Run** — all in just a few clicks.

It uses **AI to auto-analyze your codebase**, generate build/run commands, detect frameworks and databases, and provide real-time feedback via WebSockets.

---

## ✨ Features

- 🔗 **GitHub Integration** — Pick any of your repositories
- ⚙️ **Custom Config** — Set build/run commands, env vars, workdir, etc.
- 🤖 **AI-Powered Analysis** — Auto-fills deploy config from code
- 📦 **Cloud Run Deployment** — Docker builds + GCP push
- 🏗️ **Multi-Service Support** — Automatically detects and deploys complex applications with multiple services (frontend/backend, microservices, etc.)
- 📡 **Live Logs** — Real-time deployment status via WebSocket
- 🔁 **Redeploy & Edit** — Modify config and redeploy anytime
- 🛑 **Control** — Pause, resume, or stop deployed services

---

## 🧪 Tech Stack

- **Frontend**: Next.js, TailwindCSS, shadcn/ui
- **Backend**: Node.js, Express, Firebase Firestore
- **Cloud**: Google Cloud Run, Docker, GitHub OAuth
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
Create a **.env** with the help of **.env.example** in the root directory

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

### Database Support

SmartDeploy automatically detects and provisions databases for your applications:

#### Automatic Database Detection

The system detects database requirements from:
- **.NET Applications**: `appsettings.json`, `appsettings.Development.json` connection strings
- **Environment Files**: `.env` files with database configuration
- **Docker Compose**: Database services in `docker-compose.yml`

#### Supported Databases

- **MSSQL/SQL Server**: Automatically creates Cloud SQL for SQL Server instances
- **PostgreSQL**: Creates Cloud SQL for PostgreSQL instances
- **MySQL**: Creates Cloud SQL for MySQL instances

#### How It Works

1. **Detection**: Scans your codebase for database connection strings and configurations
2. **Provisioning**: Creates a Cloud SQL instance in the same GCP project
3. **Connection**: Configures Cloud Run services to connect via Unix sockets (secure, no public IP needed)
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

- **Cloud SQL Costs**: Cloud SQL instances incur charges. The system creates a `db-f1-micro` instance by default (can be upgraded)
- **Database Migration**: You may need to run migrations after deployment to set up your database schema
- **Credentials**: Database passwords are auto-generated and provided via environment variables
- **Region**: Databases are created in `us-central1` to match Cloud Run services

---

## Self-hosting on EC2 (t3.micro)

To run SmartDeploy on a t3.micro (1 GB RAM), add swap so the Docker build can complete. See **[docs/T3_MICRO.md](docs/T3_MICRO.md)** for setup: run `sudo ./scripts/setup-swap.sh` once, then deploy or update as usual.
