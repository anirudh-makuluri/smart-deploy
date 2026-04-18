#!/usr/bin/env bash
set -euo pipefail

# Stream logs for current deployment model.
# Modes:
#   worker (default): docker logs for smart-deploy-worker container
#   service: journalctl for smart-deploy-worker systemd service
#   compose: docker compose logs (legacy mode)

MODE="${1:-worker}"
APP_DIR="${APP_DIR:-/opt/smartdeploy}"

usage() {
	echo "Usage: $0 [worker|service|compose]"
	exit 1
}

case "${MODE}" in
	worker)
		docker logs -f smart-deploy-worker
		;;
	service)
		sudo journalctl -u smart-deploy-worker -f --no-pager
		;;
	compose)
		cd "${APP_DIR}"
		docker compose logs -f
		;;
	*)
		usage
		;;
esac
