#!/usr/bin/env bash
set -euo pipefail

# Show status for worker-service deployment (and legacy compose fallback).

APP_DIR="${APP_DIR:-/opt/smartdeploy}"
ENV_FILE="${ENV_FILE:-/opt/smart-deploy/.env}"

echo "=== SmartDeploy Status ==="
echo

if systemctl list-unit-files | grep -q '^smart-deploy-worker\.service'; then
	echo "[service] smart-deploy-worker"
	sudo systemctl status smart-deploy-worker --no-pager || true
	echo

	echo "[container]"
	docker ps --filter name=smart-deploy-worker
	echo

	echo "[health]"
	curl -fsS http://127.0.0.1:4001/health || echo "Worker health endpoint unavailable"
	echo

	echo "[unit execstart]"
	sudo systemctl cat smart-deploy-worker | sed -n '/ExecStart/p'
	echo

	echo "[env file] ${ENV_FILE}"
	if [[ -f "${ENV_FILE}" ]]; then
		echo "present"
	else
		echo "missing"
	fi

	echo
	echo "[running image]"
	docker inspect smart-deploy-worker --format '{{.Config.Image}}' 2>/dev/null || echo "container not running"
	exit 0
fi

if [[ -d "${APP_DIR}" ]] && [[ -f "${APP_DIR}/docker-compose.yml" ]]; then
	echo "[legacy compose mode]"
	cd "${APP_DIR}"
	docker compose ps
	exit 0
fi

echo "No smart-deploy-worker service and no docker compose app detected."
exit 1
