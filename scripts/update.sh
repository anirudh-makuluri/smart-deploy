#!/usr/bin/env bash
set -euo pipefail

# Replace the running worker image on the existing instance and restart it in place.
#
# You can still override anything with environment variables, for example:
#   IMAGE_TAG=2026-04-17-2 ./scripts/update.sh
#   WORKER_IMAGE=328342419078.dkr.ecr.us-west-2.amazonaws.com/smart-deploy-worker:existing-tag ./scripts/update.sh
#   DEPLOYMENT_QUEUE_LAMBDA_IMAGE=328342419078.dkr.ecr.us-west-2.amazonaws.com/smart-deploy-deployment-queue:existing-tag ./scripts/update.sh
#   UPDATE_DEPLOYMENT_QUEUE=false ./scripts/update.sh
#   DEPLOYMENT_QUEUE_UPDATE_MODE=terraform ./scripts/update.sh
#   ROLLOUT_MODE=none ./scripts/update.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/worker-release.sh"

worker_release_prepare
worker_release_build_and_push
worker_release_build_and_push_deployment_queue_lambda
worker_release_terraform_init
worker_release_rollout_existing_instance true
worker_release_platform_terraform_init
worker_release_update_deployment_queue_infra
worker_release_postflight_message
