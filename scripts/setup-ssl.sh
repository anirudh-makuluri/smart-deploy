#!/usr/bin/env bash
set -euo pipefail

# Configure HTTPS on a worker host where nginx proxies ws traffic to port 4001.
# This is optional if TLS terminates at ALB/Cloudflare.

if [[ "${EUID}" -ne 0 ]]; then
	echo "Run as root (sudo)."
	exit 1
fi

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

if [[ -z "${DOMAIN}" ]]; then
	read -r -p "Domain (e.g. ws.smart-deploy.xyz): " DOMAIN
fi
if [[ -z "${EMAIL}" ]]; then
	read -r -p "Email for Let's Encrypt: " EMAIL
fi

if [[ -z "${DOMAIN}" || -z "${EMAIL}" ]]; then
	echo "DOMAIN and EMAIL are required."
	exit 1
fi

install_certbot() {
	if command -v apt-get >/dev/null 2>&1; then
		apt-get update
		apt-get install -y certbot python3-certbot-nginx nginx
	elif command -v dnf >/dev/null 2>&1; then
		dnf install -y certbot python3-certbot-nginx nginx
	else
		echo "Unsupported OS package manager. Install certbot + nginx manually."
		exit 1
	fi
}

install_certbot

cat >/etc/nginx/conf.d/smart-deploy-worker.conf <<NGINX
server {
  listen 80;
  server_name ${DOMAIN};

  location / {
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 3600;
    proxy_pass http://127.0.0.1:4001;
  }
}
NGINX

nginx -t
systemctl enable nginx
systemctl restart nginx

certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "${EMAIL}" --redirect

nginx -t
systemctl reload nginx

echo "SSL configured for ${DOMAIN}."
