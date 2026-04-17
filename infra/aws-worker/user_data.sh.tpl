#!/bin/bash
set -euxo pipefail

dnf update -y

dnf install -y docker nginx
systemctl enable docker
systemctl start docker

mkdir -p /opt/smart-deploy

cat >/etc/systemd/system/smart-deploy-worker.service <<'UNIT'
[Unit]
Description=Smart Deploy Worker Container
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f smart-deploy-worker
ExecStart=/usr/bin/docker run --name smart-deploy-worker \
  -p ${worker_port}:${worker_port} \
  -e PORT=${worker_port} \
  -e WS_ALLOWED_ORIGINS=${ws_allowed_origins} \
  ${worker_image}
ExecStop=/usr/bin/docker stop smart-deploy-worker

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable smart-deploy-worker
systemctl start smart-deploy-worker

cat >/etc/nginx/conf.d/smart-deploy-worker.conf <<'NGINX'
server {
  listen 80;
  server_name _;

  location / {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600;
    proxy_pass http://127.0.0.1:${worker_port};
  }
}
NGINX

nginx -t
systemctl enable nginx
systemctl restart nginx
