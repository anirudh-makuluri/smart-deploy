# Self-Hosting SmartDeploy on EC2

This guide covers deploying SmartDeploy itself (the dashboard + WebSocket worker) on an AWS EC2 instance using the provided scripts.

---

## Prerequisites

- An **Ubuntu 22.04+** EC2 instance (t3.small recommended; t3.micro works with swap).
- **Security group** allowing inbound ports: 22 (SSH), 80 (HTTP), 443 (HTTPS), 3000 (app, optional for direct access), 4001 (WebSocket, optional).
- A **domain name** pointed at the instance's public IP (if you want SSL).
- Your `.env` file fully configured (see the main [README](../README.md) and [`.env.example`](../.env.example)).

---

## 1. SSH in and run the deploy script

```bash
ssh ubuntu@<your-ec2-ip>

# Clone and deploy in one step
git clone https://github.com/anirudh-makuluri/smart-deploy.git /opt/smartdeploy
cd /opt/smartdeploy

# Copy your env file
nano .env   # paste your values, save

# Run the deploy script
chmod +x scripts/*.sh
./scripts/deploy.sh
```

`deploy.sh` will:
1. Install Docker (if not present).
2. Clone / update the repo to `/opt/smartdeploy`.
3. Check for a `.env` file (exits if missing).
4. Build Docker images and start containers via `docker compose`.
5. Configure Nginx as a reverse proxy (port 80 -> app:3000, `/ws` -> websocket:4001).
6. Print the public URL.

---

## 2. Low-memory instances (t3.micro / 1 GB RAM)

The Next.js Docker build needs ~1.5-2 GB RAM. On 1 GB instances, add swap first:

```bash
sudo ./scripts/setup-swap.sh
```

This creates a 2 GB swap file. After that, `deploy.sh` and `update.sh` will work normally. Builds will be slower due to swap I/O.

You can also tune the Node heap via `.env`:

```
NODE_MAX_OLD_SPACE_SIZE=2048
```

On larger instances (t3.small+), use `4096` for faster builds.

---

## 3. Set up SSL (Let's Encrypt)

After the initial deploy, set up HTTPS:

```bash
sudo ./scripts/setup-ssl.sh
```

The script will prompt for your **domain** and **email**, then:
1. Install Certbot.
2. Obtain a certificate from Let's Encrypt.
3. Configure Nginx for HTTPS with automatic HTTP -> HTTPS redirect.

**Prerequisites:**
- DNS A record pointing your domain to the instance's public IP.
- Ports 80 and 443 open in the security group.

After SSL is set up, update `.env`:

```
NEXTAUTH_URL=https://yourdomain.com
NEXT_PUBLIC_WS_URL=wss://yourdomain.com/ws
```

Then restart:

```bash
docker compose restart
```

### Certificate renewal

Let's Encrypt certificates expire every 90 days. Certbot sets up automatic renewal. You can verify:

```bash
sudo certbot renew --dry-run
```

Or manually renew:

```bash
sudo ./scripts/renew-ssl.sh
```

For more details, see [`scripts/README-SSL.md`](../scripts/README-SSL.md).

---

## 4. Updating to the latest version

```bash
cd /opt/smartdeploy
./scripts/update.sh
```

This pulls the latest code from `main`, rebuilds Docker images, and restarts containers with minimal downtime.

`update-main.sh` is a lighter variant that skips `git pull` and just rebuilds + restarts (useful when you've already pulled or made local changes).

---

## Helper scripts

All scripts assume the app lives at `/opt/smartdeploy`.

| Script | Usage | What it does |
|--------|-------|-------------|
| `scripts/deploy.sh` | First-time setup | Installs Docker, clones repo, builds, starts containers, configures Nginx |
| `scripts/update.sh` | Pull + redeploy | `git pull`, rebuild images, restart containers |
| `scripts/update-main.sh` | Rebuild only | Rebuild + restart without git pull |
| `scripts/setup-swap.sh` | One-time (low RAM) | Creates 2 GB swap file |
| `scripts/setup-ssl.sh` | One-time | Installs Certbot, obtains SSL cert, configures Nginx HTTPS |
| `scripts/renew-ssl.sh` | Manual renewal | Renews Let's Encrypt certificate |
| `scripts/logs.sh [app\|ws\|all]` | Debugging | Tails Docker Compose logs |
| `scripts/status.sh` | Health check | Shows container status, resource usage, git info, health checks |

---

## Docker Compose overview

`docker-compose.yml` defines two services:

| Service | Container | Port | Role |
|---------|-----------|------|------|
| `app` | `smartdeploy-app` | 3000 | Next.js dashboard (UI + API routes) |
| `websocket` | `smartdeploy-websocket` | 4001 | Deploy worker (clones repos, builds Docker images, calls cloud APIs) |

The `websocket` service mounts `/var/run/docker.sock` so it can build Docker images on the host.

Both services read `.env` via `env_file` and also have explicit `environment` entries for every variable the app uses at runtime.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build OOM / killed | Add swap (`setup-swap.sh`) or use a larger instance. |
| Containers exit immediately | Check `docker compose logs` for errors. Usually a missing env var. |
| Port 3000 not reachable | Check security group inbound rules. Or use Nginx (port 80). |
| Nginx 502 Bad Gateway | Containers might still be starting. Wait 30s and retry, or check `docker compose ps`. |
| WebSocket not connecting | Verify `NEXT_PUBLIC_WS_URL` matches your setup (`ws://` for HTTP, `wss://` for HTTPS). |
