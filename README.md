# 🚀 SmartDeploy

**SmartDeploy** is a lightweight DevOps automation platform that lets you connect your GitHub repository, configure deployment settings, and deploy to **Google Cloud Run** — all in just a few clicks.

It uses **AI to auto-analyze your codebase**, generate build/run commands, detect frameworks and databases, and provide real-time feedback via WebSockets.

---

## ✨ Features

- 🔗 **GitHub Integration** — Pick any of your repositories
- ⚙️ **Custom Config** — Set build/run commands, env vars, workdir, etc.
- 🤖 **AI-Powered Analysis** — Auto-fills deploy config from code
- 📦 **Cloud Run Deployment** — Docker builds + GCP push
- 📡 **Live Logs** — Real-time deployment status via WebSocket
- 🔁 **Redeploy & Edit** — Modify config and redeploy anytime
- 🛑 **Control** — Pause, resume, or stop deployed services

---

## 🧪 Tech Stack

- **Frontend**: Next.js, TailwindCSS, shadcn/ui
- **Backend**: Node.js, Express, Firebase Firestore
- **Cloud**: Google Cloud Run, Docker, GitHub OAuth
- **AI**: Local LLM via [Ollama](https://ollama.com) (`mistral`)

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

### 5. Run Local LLM (optional for AI features)
```bash
ollama serve &
```

```bash
ollama run mistral
```

📦 Docker Desktop must be running to build and push images.

---

## 🧠 AI Capabilities

- Detects language, framework, database, environment files, and more
- Auto-generates install/build/run commands
- Flags issues like missing server or mobile-only code
- Summarizes project structure and deployability
- Generates a structured JSON deployment profile
