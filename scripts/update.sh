#!/usr/bin/env bash
set -euo pipefail

# Opinionated release command for existing production worker updates.
# Defaults:
# - Terraform auto-approve enabled
# - In-place rollout enabled via SSM
# - Stack defaults to infra/aws-worker
#
# You can still override anything with environment variables, for example:
#   IMAGE_TAG=2026-04-17-2 ./scripts/update.sh
#   AUTO_APPROVE=false ./scripts/update.sh
#   ROLLOUT_MODE=none ./scripts/update.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export AUTO_APPROVE="${AUTO_APPROVE:-true}"
export ROLLOUT_MODE="${ROLLOUT_MODE:-ssm}"

exec "${SCRIPT_DIR}/deploy.sh"
