#!/usr/bin/env bash
set -euo pipefail

# Build and ship the websocket worker image, then apply Terraform to update infra/aws-worker.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
STACK_DIR="${STACK_DIR:-${REPO_ROOT}/infra/aws-worker}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-${REPO_ROOT}/Dockerfile.websocket}"

AWS_REGION="${AWS_REGION:-us-west-2}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-328342419078}"
ECR_REPO="${ECR_REPO:-smart-deploy-worker}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)-$(git -C "${REPO_ROOT}" rev-parse --short HEAD)}"
WORKER_IMAGE="${WORKER_IMAGE:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}}"
WORKER_PORT="${WORKER_PORT:-4001}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"
ROLLOUT_MODE="${ROLLOUT_MODE:-ssm}"

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1"
		exit 1
	fi
}

log() {
	echo "[deploy] $*"
}

require_cmd aws
require_cmd docker
require_cmd terraform
require_cmd git
require_cmd base64

check_docker_daemon() {
	if docker info >/dev/null 2>&1; then
		return 0
	fi

	echo "Docker daemon is not reachable."
	echo
	echo "If you are on Windows:"
	echo "  1) Start Docker Desktop"
	echo "  2) Wait until the engine is running"
	echo "  3) Ensure Docker is set to Linux containers"
	echo "  4) Re-run: bash ./scripts/update.sh"
	echo
	echo "If Docker is already open, restart it and run: docker info"
	exit 1
}

check_docker_daemon

if [[ ! -f "${DOCKERFILE_PATH}" ]]; then
	echo "Dockerfile not found at ${DOCKERFILE_PATH}"
	exit 1
fi

if [[ ! -d "${STACK_DIR}" ]]; then
	echo "Terraform stack directory not found at ${STACK_DIR}"
	exit 1
fi

log "Using worker image: ${WORKER_IMAGE}"
log "Ensuring ECR repo exists: ${ECR_REPO}"
if ! aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1; then
	aws ecr create-repository --repository-name "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null
fi

log "Logging into ECR"
aws ecr get-login-password --region "${AWS_REGION}" | \
	docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

log "Building worker image"
docker build -f "${DOCKERFILE_PATH}" -t "${WORKER_IMAGE}" "${REPO_ROOT}"

log "Pushing worker image"
docker push "${WORKER_IMAGE}"

log "Running terraform init"
terraform -chdir="${STACK_DIR}" init

log "Running terraform plan"
terraform -chdir="${STACK_DIR}" plan -var "worker_image=${WORKER_IMAGE}"

if [[ "${AUTO_APPROVE}" == "true" ]]; then
	log "Applying terraform (auto-approve)"
	terraform -chdir="${STACK_DIR}" apply -auto-approve -var "worker_image=${WORKER_IMAGE}"
else
	log "Applying terraform"
	terraform -chdir="${STACK_DIR}" apply -var "worker_image=${WORKER_IMAGE}"
fi

rollout_existing_instance() {
	if [[ "${ROLLOUT_MODE}" == "none" ]]; then
		log "Skipping rollout on existing instance (ROLLOUT_MODE=none)"
		return 0
	fi

	if [[ "${ROLLOUT_MODE}" != "ssm" ]]; then
		echo "Unsupported ROLLOUT_MODE: ${ROLLOUT_MODE}"
		exit 1
	fi

	local instance_id
	instance_id="$(terraform -chdir="${STACK_DIR}" output -raw instance_id 2>/dev/null || true)"
	if [[ -z "${instance_id}" ]]; then
		log "No instance_id output available; skipping in-place rollout"
		return 0
	fi

	log "Rolling out image on existing instance via SSM: ${instance_id}"

	local rollout_script
	rollout_script="$(cat <<EOF
set -euo pipefail

if [[ ! -f /opt/smart-deploy/.env ]]; then
	echo "Missing /opt/smart-deploy/.env"
	exit 1
fi

aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

cat >/etc/systemd/system/smart-deploy-worker.service <<'UNIT'
[Unit]
Description=Smart Deploy Worker Container
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f smart-deploy-worker
ExecStart=/usr/bin/docker run --name smart-deploy-worker -p ${WORKER_PORT}:${WORKER_PORT} --env-file /opt/smart-deploy/.env ${WORKER_IMAGE}
ExecStop=/usr/bin/docker stop smart-deploy-worker

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
docker pull ${WORKER_IMAGE}
systemctl restart smart-deploy-worker
systemctl --no-pager --full status smart-deploy-worker || true
docker inspect smart-deploy-worker --format '{{.Config.Image}}' || true
EOF
)"

	local rollout_b64
	rollout_b64="$(printf '%s' "${rollout_script}" | base64 | tr -d '\n')"

	local ssm_command
	ssm_command="sudo bash -lc 'echo ${rollout_b64} | base64 -d > /tmp/smartdeploy-rollout.sh; chmod +x /tmp/smartdeploy-rollout.sh; /tmp/smartdeploy-rollout.sh'"
	local escaped_command
	escaped_command="${ssm_command//\\/\\\\}"
	escaped_command="${escaped_command//\"/\\\"}"
	local parameters_json
	parameters_json="{\"commands\":[\"${escaped_command}\"]}"

	local command_id
	command_id="$(aws ssm send-command \
		--region "${AWS_REGION}" \
		--instance-ids "${instance_id}" \
		--document-name "AWS-RunShellScript" \
		--comment "SmartDeploy rollout" \
		--parameters "${parameters_json}" \
		--query "Command.CommandId" \
		--output text)"

	log "Waiting for SSM command completion: ${command_id}"
	if ! aws ssm wait command-executed --region "${AWS_REGION}" --command-id "${command_id}" --instance-id "${instance_id}"; then
		log "SSM command reported a failure state"
	fi

	log "SSM rollout status"
	aws ssm get-command-invocation \
		--region "${AWS_REGION}" \
		--command-id "${command_id}" \
		--instance-id "${instance_id}" \
		--query '{Status:Status,ResponseCode:ResponseCode,ExecutionElapsedTime:ExecutionElapsedTime}' \
		--output json
	log "If you need full logs, run: aws ssm get-command-invocation --command-id ${command_id} --instance-id ${instance_id} --region ${AWS_REGION}"
}

rollout_existing_instance

cat <<EOF

Deployment finished.
Next checks on worker host:
  sudo systemctl cat smart-deploy-worker
  sudo systemctl restart smart-deploy-worker
  sudo systemctl status smart-deploy-worker --no-pager
  sudo docker logs smart-deploy-worker --tail 100

EOF
