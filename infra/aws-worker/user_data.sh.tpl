#!/bin/bash
set -euxo pipefail

dnf update -y

dnf install -y awscli docker nginx python3
systemctl enable docker
systemctl start docker

if [[ "${worker_image}" == *.dkr.ecr.*.amazonaws.com/* ]]; then
  ecr_registry="$(echo "${worker_image}" | cut -d'/' -f1)"
  aws ecr get-login-password --region "${aws_region}" | docker login --username AWS --password-stdin "$${ecr_registry}"
fi

mkdir -p /opt/smart-deploy
ENV_FILE="/opt/smart-deploy/.env"

cat >/usr/local/bin/smart-deploy-worker-write-env <<'SCRIPT'
#!/bin/bash
set -euo pipefail

SECRET_ARN="$${1:-}"
TARGET_FILE="$${2:-}"
FALLBACK_FILE="$${3:-}"
AWS_REGION="${aws_region}"

if [[ -z "$${TARGET_FILE}" ]]; then
  echo "Target env file path is required"
  exit 1
fi

if [[ -n "$${SECRET_ARN}" ]]; then
  secret_json="$(aws secretsmanager get-secret-value \
    --region "$${AWS_REGION}" \
    --secret-id "$${SECRET_ARN}" \
    --query SecretString \
    --output text)"

  if [[ -z "$${secret_json}" || "$${secret_json}" == "None" ]]; then
    echo "Secret $${SECRET_ARN} returned an empty SecretString"
    exit 1
  fi

  SECRET_JSON="$${secret_json}" TARGET_FILE="$${TARGET_FILE}" python3 <<'PY'
import json
import os
from pathlib import Path

raw_secret = os.environ["SECRET_JSON"]

def parse_env_text(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        out[key] = value
    return out

try:
    parsed = json.loads(raw_secret)
except json.JSONDecodeError:
    secret = parse_env_text(raw_secret)
else:
    if not isinstance(parsed, dict):
        raise SystemExit("SecretString JSON must be an object when using JSON format")
    secret = {}
    for key, value in parsed.items():
        name = str(key).strip()
        if not name:
            continue
        secret[name] = "" if value is None else str(value)

lines = []
for key, value in secret.items():
    lines.append(f"{key}={value}")

output = "\n".join(lines)
Path(os.environ["TARGET_FILE"]).write_text(output + ("\n" if output else ""), encoding="utf-8")
PY

  chmod 600 "$${TARGET_FILE}"
  exit 0
fi

if [[ -n "$${FALLBACK_FILE}" && -f "$${FALLBACK_FILE}" ]]; then
  cp "$${FALLBACK_FILE}" "$${TARGET_FILE}"
  chmod 600 "$${TARGET_FILE}"
  exit 0
fi

echo "Missing worker env configuration. Set worker_secret_arn or create $${FALLBACK_FILE}."
exit 1
SCRIPT
chmod +x /usr/local/bin/smart-deploy-worker-write-env

cat >/etc/systemd/system/smart-deploy-worker.service <<'UNIT'
[Unit]
Description=Smart Deploy Worker Container
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f smart-deploy-worker
ExecStartPre=/usr/local/bin/smart-deploy-worker-write-env "${worker_secret_arn}" "/run/smart-deploy-worker.env" "/opt/smart-deploy/.env"
ExecStart=/usr/bin/docker run --name smart-deploy-worker \
  -p ${worker_port}:${worker_port} \
  --env-file /run/smart-deploy-worker.env \
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
  server_name ${worker_server_name};

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
