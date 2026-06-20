#!/usr/bin/env bash
set -euo pipefail

# Build and ship the websocket worker image, then apply Terraform to update infra/aws-worker.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/worker-release.sh"

worker_release_prepare
worker_release_build_and_push
worker_release_terraform_init
worker_release_terraform_plan
worker_release_terraform_apply
worker_release_rollout_existing_instance false
worker_release_postflight_message
