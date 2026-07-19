#!/usr/bin/env bash

if [[ -n "${SMART_DEPLOY_WORKER_RELEASE_SH:-}" ]]; then
	return 0
fi
SMART_DEPLOY_WORKER_RELEASE_SH=1

WORKER_RELEASE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${WORKER_RELEASE_LIB_DIR}/../.." && pwd)}"
STACK_DIR="${STACK_DIR:-${REPO_ROOT}/infra/aws-worker}"
PLATFORM_STACK_DIR="${PLATFORM_STACK_DIR:-${REPO_ROOT}/infra/smart-deploy-platform}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-${REPO_ROOT}/Dockerfile.websocket}"
DEPLOYMENT_QUEUE_LAMBDA_DOCKERFILE_PATH="${DEPLOYMENT_QUEUE_LAMBDA_DOCKERFILE_PATH:-${REPO_ROOT}/Dockerfile.deployment-queue-lambda}"

AWS_REGION="${AWS_REGION:-us-west-2}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-328342419078}"
ECR_REPO="${ECR_REPO:-smart-deploy-worker}"
DEPLOYMENT_QUEUE_LAMBDA_ECR_REPO="${DEPLOYMENT_QUEUE_LAMBDA_ECR_REPO:-smart-deploy-deployment-queue}"
ECR_REGISTRY="${ECR_REGISTRY:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
ECR_PERMISSION_CHECK_DIGEST="${ECR_PERMISSION_CHECK_DIGEST:-sha256:0000000000000000000000000000000000000000000000000000000000000000}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)-$(git -C "${REPO_ROOT}" rev-parse --short HEAD)}"
WORKER_IMAGE="${WORKER_IMAGE:-${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG}}"
DEPLOYMENT_QUEUE_LAMBDA_IMAGE="${DEPLOYMENT_QUEUE_LAMBDA_IMAGE:-${ECR_REGISTRY}/${DEPLOYMENT_QUEUE_LAMBDA_ECR_REPO}:${IMAGE_TAG}}"
WORKER_PORT="${WORKER_PORT:-4001}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"
ROLLOUT_MODE="${ROLLOUT_MODE:-ssm}"
UPDATE_DEPLOYMENT_QUEUE="${UPDATE_DEPLOYMENT_QUEUE:-true}"
DEPLOYMENT_QUEUE_UPDATE_MODE="${DEPLOYMENT_QUEUE_UPDATE_MODE:-awscli}"
DEPLOYMENT_WORKER_TASK_DEFINITION="${DEPLOYMENT_WORKER_TASK_DEFINITION:-smart-deploy-deployment-worker}"
DEPLOYMENT_WORKER_CONTAINER_NAME="${DEPLOYMENT_WORKER_CONTAINER_NAME:-smart-deploy-worker}"
DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME="${DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME:-smart-deploy-deployment-queue-handler}"

require_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1"
		exit 1
	fi
}

worker_release_log() {
	echo "[worker-release] $*"
}

worker_release_get_caller_account_id() {
	aws sts get-caller-identity --query Account --output text 2>/dev/null || true
}

worker_release_init_docker_config() {
	if [[ -n "${WORKER_RELEASE_DOCKER_CONFIG_DIR:-}" ]]; then
		export DOCKER_CONFIG="${WORKER_RELEASE_DOCKER_CONFIG_DIR}"
		return 0
	fi

	WORKER_RELEASE_DOCKER_CONFIG_DIR="$(mktemp -d)"
	export DOCKER_CONFIG="${WORKER_RELEASE_DOCKER_CONFIG_DIR}"
}

worker_release_cleanup_docker_config() {
	if [[ -z "${WORKER_RELEASE_DOCKER_CONFIG_DIR:-}" ]]; then
		return 0
	fi

	rm -rf "${WORKER_RELEASE_DOCKER_CONFIG_DIR}"
	unset WORKER_RELEASE_DOCKER_CONFIG_DIR
	unset DOCKER_CONFIG
}

worker_release_require_prereqs() {
	require_cmd aws
	require_cmd docker
	require_cmd terraform
	require_cmd git
	require_cmd base64
	if [[ "${UPDATE_DEPLOYMENT_QUEUE}" == "true" ]]; then
		require_cmd python3
	fi
}

worker_release_check_docker_daemon() {
	if docker info >/dev/null 2>&1; then
		return 0
	fi

	echo "Docker daemon is not reachable."
	echo
	echo "If you are on Windows:"
	echo "  1) Start Docker Desktop"
	echo "  2) Wait until the engine is running"
	echo "  3) Ensure Docker is set to Linux containers"
	echo "  4) Re-run the release command"
	echo
	echo "If Docker is already open, restart it and run: docker info"
	exit 1
}

worker_release_validate_paths() {
	if [[ ! -f "${DOCKERFILE_PATH}" ]]; then
		echo "Dockerfile not found at ${DOCKERFILE_PATH}"
		exit 1
	fi

	if [[ "${UPDATE_DEPLOYMENT_QUEUE}" == "true" && ! -f "${DEPLOYMENT_QUEUE_LAMBDA_DOCKERFILE_PATH}" ]]; then
		echo "Deployment queue Lambda Dockerfile not found at ${DEPLOYMENT_QUEUE_LAMBDA_DOCKERFILE_PATH}"
		exit 1
	fi

	if [[ ! -d "${STACK_DIR}" ]]; then
		echo "Terraform stack directory not found at ${STACK_DIR}"
		exit 1
	fi

	if [[ "${UPDATE_DEPLOYMENT_QUEUE}" == "true" && "${DEPLOYMENT_QUEUE_UPDATE_MODE}" == "terraform" && ! -d "${PLATFORM_STACK_DIR}" ]]; then
		echo "Smart Deploy platform Terraform stack directory not found at ${PLATFORM_STACK_DIR}"
		exit 1
	fi
}

worker_release_prepare() {
	worker_release_require_prereqs
	worker_release_check_docker_daemon
	worker_release_validate_paths

	local caller_account_id
	caller_account_id="$(worker_release_get_caller_account_id)"
	if [[ -n "${caller_account_id}" ]]; then
		worker_release_log "AWS caller account: ${caller_account_id}"
	fi
	worker_release_log "Target ECR registry: ${ECR_REGISTRY}"
	if [[ -n "${caller_account_id}" && "${caller_account_id}" != "${AWS_ACCOUNT_ID}" ]]; then
		worker_release_log "Caller account differs from target ECR account (${AWS_ACCOUNT_ID}); cross-account ECR permissions are required"
	fi
}

worker_release_ensure_ecr_repo() {
	worker_release_log "Using worker image: ${WORKER_IMAGE}"
	worker_release_log "Ensuring ECR repo exists in ${AWS_ACCOUNT_ID}: ${ECR_REPO}"
	if ! aws ecr describe-repositories --registry-id "${AWS_ACCOUNT_ID}" --repository-names "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1; then
		aws ecr create-repository --registry-id "${AWS_ACCOUNT_ID}" --repository-name "${ECR_REPO}" --region "${AWS_REGION}" >/dev/null
	fi
}

worker_release_ensure_named_ecr_repo() {
	local repository_name="$1"

	worker_release_log "Ensuring ECR repo exists in ${AWS_ACCOUNT_ID}: ${repository_name}"
	if ! aws ecr describe-repositories --registry-id "${AWS_ACCOUNT_ID}" --repository-names "${repository_name}" --region "${AWS_REGION}" >/dev/null 2>&1; then
		aws ecr create-repository --registry-id "${AWS_ACCOUNT_ID}" --repository-name "${repository_name}" --region "${AWS_REGION}" >/dev/null
	fi
}

worker_release_login_ecr() {
	worker_release_log "Logging into ECR"

	local login_output
	login_output="$(
		aws ecr get-login-password --region "${AWS_REGION}" | \
			docker login --username AWS --password-stdin "${ECR_REGISTRY}" 2>&1
	)"

	printf '%s\n' "${login_output}" | sed \
		-e '/^WARNING! Your credentials are stored unencrypted in /d' \
		-e '/^Configure a credential helper to remove this warning\. See$/d' \
		-e '/^https:\/\/docs\.docker\.com\/go\/credential-store\/$/d'
}

worker_release_preflight_ecr_push_permissions() {
	local repository_name="${1:-${ECR_REPO}}"

	worker_release_log "Preflighting ECR push permissions for ${repository_name} with BatchCheckLayerAvailability"
	aws ecr batch-check-layer-availability \
		--registry-id "${AWS_ACCOUNT_ID}" \
		--repository-name "${repository_name}" \
		--region "${AWS_REGION}" \
		--layer-digests "${ECR_PERMISSION_CHECK_DIGEST}" >/dev/null

	worker_release_log "Preflighting ECR push permissions for ${repository_name} with InitiateLayerUpload"
	aws ecr initiate-layer-upload \
		--registry-id "${AWS_ACCOUNT_ID}" \
		--repository-name "${repository_name}" \
		--region "${AWS_REGION}" >/dev/null
}

worker_release_build_and_push() {
	worker_release_ensure_ecr_repo
	worker_release_init_docker_config
	worker_release_login_ecr
	worker_release_preflight_ecr_push_permissions "${ECR_REPO}"

	worker_release_log "Building worker image"
	docker build \
		--build-arg "WORKER_VERSION=${IMAGE_TAG}" \
		-f "${DOCKERFILE_PATH}" \
		-t "${WORKER_IMAGE}" \
		"${REPO_ROOT}"

	worker_release_log "Pushing worker image"
	local push_status=0
	docker push "${WORKER_IMAGE}" || push_status=$?
	worker_release_cleanup_docker_config
	if [[ "${push_status}" -ne 0 ]]; then
		return "${push_status}"
	fi
}

worker_release_build_and_push_deployment_queue_lambda() {
	if [[ "${UPDATE_DEPLOYMENT_QUEUE}" != "true" ]]; then
		worker_release_log "Skipping deployment queue Lambda image build (UPDATE_DEPLOYMENT_QUEUE=${UPDATE_DEPLOYMENT_QUEUE})"
		return 0
	fi

	require_cmd docker
	worker_release_ensure_named_ecr_repo "${DEPLOYMENT_QUEUE_LAMBDA_ECR_REPO}"
	worker_release_init_docker_config
	worker_release_login_ecr
	worker_release_preflight_ecr_push_permissions "${DEPLOYMENT_QUEUE_LAMBDA_ECR_REPO}"

	worker_release_log "Building and pushing deployment queue Lambda image: ${DEPLOYMENT_QUEUE_LAMBDA_IMAGE}"
	docker buildx build \
		--platform linux/amd64 \
		--provenance=false \
		-f "${DEPLOYMENT_QUEUE_LAMBDA_DOCKERFILE_PATH}" \
		-t "${DEPLOYMENT_QUEUE_LAMBDA_IMAGE}" \
		--push \
		"${REPO_ROOT}"

	worker_release_cleanup_docker_config
}

worker_release_terraform_init() {
	if [[ -n "${WORKER_INSTANCE_ID:-}" ]]; then
		worker_release_log "Skipping terraform init (WORKER_INSTANCE_ID is set)"
		return 0
	fi

	worker_release_log "Running terraform init"
	terraform -chdir="${STACK_DIR}" init
}

worker_release_platform_terraform_init() {
	if [[ "${UPDATE_DEPLOYMENT_QUEUE}" != "true" ]]; then
		worker_release_log "Skipping platform terraform init (UPDATE_DEPLOYMENT_QUEUE=${UPDATE_DEPLOYMENT_QUEUE})"
		return 0
	fi
	if [[ "${DEPLOYMENT_QUEUE_UPDATE_MODE}" != "terraform" ]]; then
		worker_release_log "Skipping platform terraform init (DEPLOYMENT_QUEUE_UPDATE_MODE=${DEPLOYMENT_QUEUE_UPDATE_MODE})"
		return 0
	fi

	worker_release_log "Running platform terraform init"
	terraform -chdir="${PLATFORM_STACK_DIR}" init
}

worker_release_read_output() {
	local output_name="$1"
	local env_override_name="$2"
	local env_override_value="${!env_override_name:-}"

	if [[ -n "${env_override_value}" ]]; then
		printf '%s' "${env_override_value}"
		return 0
	fi

	terraform -chdir="${STACK_DIR}" output -raw "${output_name}" 2>/dev/null || true
}

worker_release_terraform_plan() {
	worker_release_log "Running terraform plan"
	terraform -chdir="${STACK_DIR}" plan -var "worker_image=${WORKER_IMAGE}"
}

worker_release_terraform_apply() {
	if [[ "${AUTO_APPROVE}" == "true" ]]; then
		worker_release_log "Applying terraform (auto-approve)"
		terraform -chdir="${STACK_DIR}" apply -auto-approve -var "worker_image=${WORKER_IMAGE}"
	else
		worker_release_log "Applying terraform"
		terraform -chdir="${STACK_DIR}" apply -var "worker_image=${WORKER_IMAGE}"
	fi
}

worker_release_update_deployment_queue_infra() {
	if [[ "${UPDATE_DEPLOYMENT_QUEUE}" != "true" ]]; then
		worker_release_log "Skipping deployment queue infra update (UPDATE_DEPLOYMENT_QUEUE=${UPDATE_DEPLOYMENT_QUEUE})"
		return 0
	fi
	if [[ "${DEPLOYMENT_QUEUE_UPDATE_MODE}" == "awscli" ]]; then
		worker_release_update_deployment_queue_infra_awscli
		return 0
	fi
	if [[ "${DEPLOYMENT_QUEUE_UPDATE_MODE}" != "terraform" ]]; then
		echo "Unsupported DEPLOYMENT_QUEUE_UPDATE_MODE: ${DEPLOYMENT_QUEUE_UPDATE_MODE}"
		exit 1
	fi

	local apply_args=(
		-chdir="${PLATFORM_STACK_DIR}"
		apply
		-var "deployment_worker_image=${WORKER_IMAGE}"
		-var "deployment_queue_lambda_image_uri=${DEPLOYMENT_QUEUE_LAMBDA_IMAGE}"
		-target "aws_ecs_task_definition.deployment_worker[0]"
		-target "aws_lambda_function.deployment_queue[0]"
	)

	if [[ "${AUTO_APPROVE}" == "true" ]]; then
		apply_args+=( -auto-approve )
	fi

	worker_release_log "Updating deployment queue ECS task definition and Lambda"
	terraform "${apply_args[@]}"
}

worker_release_update_deployment_queue_infra_awscli() {
	worker_release_log "Updating deployment queue via AWS CLI (no platform Terraform state required)"
	worker_release_log "Source task definition: ${DEPLOYMENT_WORKER_TASK_DEFINITION}"
	worker_release_log "New worker image: ${WORKER_IMAGE}"
	worker_release_log "Lambda function: ${DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME}"
	worker_release_log "New Lambda image: ${DEPLOYMENT_QUEUE_LAMBDA_IMAGE}"

	local tmp_dir
	tmp_dir="$(mktemp -d)"
	local current_task_json="${tmp_dir}/current-task-definition.json"
	local register_task_json="${tmp_dir}/register-task-definition.json"
	local lambda_env_json="${tmp_dir}/lambda-env.json"

	aws ecs describe-task-definition \
		--task-definition "${DEPLOYMENT_WORKER_TASK_DEFINITION}" \
		--region "${AWS_REGION}" \
		--query taskDefinition \
		--output json >"${current_task_json}"

	WORKER_IMAGE="${WORKER_IMAGE}" \
	DEPLOYMENT_WORKER_CONTAINER_NAME="${DEPLOYMENT_WORKER_CONTAINER_NAME}" \
	python3 - "${current_task_json}" >"${register_task_json}" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    current = json.load(handle)
worker_image = os.environ["WORKER_IMAGE"]
container_name = os.environ["DEPLOYMENT_WORKER_CONTAINER_NAME"]
allowed = {
    "family",
    "taskRoleArn",
    "executionRoleArn",
    "networkMode",
    "containerDefinitions",
    "volumes",
    "placementConstraints",
    "requiresCompatibilities",
    "cpu",
    "memory",
    "tags",
    "pidMode",
    "ipcMode",
    "proxyConfiguration",
    "inferenceAccelerators",
    "ephemeralStorage",
    "runtimePlatform",
}
payload = {key: current[key] for key in allowed if key in current and current[key] is not None}
containers = payload.get("containerDefinitions") or []
if not containers:
    raise SystemExit("Task definition has no containerDefinitions")

updated = False
for container in containers:
    if container.get("name") == container_name:
        container["image"] = worker_image
        updated = True
        break

if not updated:
    containers[0]["image"] = worker_image

json.dump(payload, sys.stdout)
PY

	local new_task_definition_arn
	new_task_definition_arn="$(aws ecs register-task-definition \
		--cli-input-json "file://${register_task_json}" \
		--region "${AWS_REGION}" \
		--query 'taskDefinition.taskDefinitionArn' \
		--output text)"
	worker_release_log "Registered worker task definition: ${new_task_definition_arn}"

	worker_release_log "Updating Lambda image"
	aws lambda update-function-code \
		--function-name "${DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME}" \
		--image-uri "${DEPLOYMENT_QUEUE_LAMBDA_IMAGE}" \
		--region "${AWS_REGION}" >/dev/null
	aws lambda wait function-updated \
		--function-name "${DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME}" \
		--region "${AWS_REGION}"

	aws lambda get-function-configuration \
		--function-name "${DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME}" \
		--region "${AWS_REGION}" \
		--query 'Environment.Variables' \
		--output json >"${lambda_env_json}.raw"

	NEW_TASK_DEFINITION_ARN="${new_task_definition_arn}" \
	python3 - "${lambda_env_json}.raw" >"${lambda_env_json}" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    variables = json.load(handle)
if not isinstance(variables, dict):
    variables = {}
variables["DEPLOYMENT_WORKER_TASK_DEFINITION_ARN"] = os.environ["NEW_TASK_DEFINITION_ARN"]
json.dump({"Variables": variables}, sys.stdout)
PY

	worker_release_log "Updating Lambda DEPLOYMENT_WORKER_TASK_DEFINITION_ARN"
	aws lambda update-function-configuration \
		--function-name "${DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME}" \
		--environment "file://${lambda_env_json}" \
		--region "${AWS_REGION}" >/dev/null
	aws lambda wait function-updated \
		--function-name "${DEPLOYMENT_QUEUE_LAMBDA_FUNCTION_NAME}" \
		--region "${AWS_REGION}"

	worker_release_log "Deployment queue update complete"
	worker_release_log "Lambda now launches: ${new_task_definition_arn}"
	rm -rf "${tmp_dir}"
}

worker_release_rollout_existing_instance() {
	local require_instance_id="${1:-false}"

	if [[ "${ROLLOUT_MODE}" == "none" ]]; then
		worker_release_log "Skipping rollout on existing instance (ROLLOUT_MODE=none)"
		return 0
	fi

	if [[ "${ROLLOUT_MODE}" != "ssm" ]]; then
		echo "Unsupported ROLLOUT_MODE: ${ROLLOUT_MODE}"
		exit 1
	fi

	local instance_id
	instance_id="$(worker_release_read_output instance_id WORKER_INSTANCE_ID)"
	if [[ -z "${instance_id}" ]]; then
		if [[ "${require_instance_id}" == "true" ]]; then
			echo "No instance_id output is available in ${STACK_DIR}; cannot update an existing worker instance."
			exit 1
		fi

		worker_release_log "No instance_id output available; skipping in-place rollout"
		return 0
	fi

	local worker_secret_arn
	worker_secret_arn="$(worker_release_read_output worker_secret_arn WORKER_SECRET_ARN)"
	local worker_dns_record
	worker_dns_record="$(worker_release_read_output worker_dns_record WORKER_DNS_RECORD)"
	worker_dns_record="${worker_dns_record%.}"
	if [[ -z "${worker_dns_record}" ]]; then
		worker_dns_record="_"
	fi

	worker_release_log "Rolling out image on existing instance via SSM: ${instance_id}"

	local rollout_script
	rollout_script="$(cat <<EOF
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
	if command -v dnf >/dev/null 2>&1; then
		dnf install -y python3
	elif command -v yum >/dev/null 2>&1; then
		yum install -y python3
	else
		echo "python3 is required to render worker env files"
		exit 1
	fi
fi

cat >/usr/local/bin/smart-deploy-worker-write-env <<'SCRIPT'
#!/bin/bash
set -euo pipefail

SECRET_ARN="\${1:-}"
TARGET_FILE="\${2:-}"
FALLBACK_FILE="\${3:-}"
AWS_REGION="${AWS_REGION}"

if [[ -z "\${TARGET_FILE}" ]]; then
	echo "Target env file path is required"
	exit 1
fi

if [[ -n "\${SECRET_ARN}" ]]; then
	secret_json="\$(aws secretsmanager get-secret-value \\
		--region "\${AWS_REGION}" \\
		--secret-id "\${SECRET_ARN}" \\
		--query SecretString \\
		--output text)"

	if [[ -z "\${secret_json}" || "\${secret_json}" == "None" ]]; then
		echo "Secret \${SECRET_ARN} returned an empty SecretString"
		exit 1
	fi

	SECRET_JSON="\${secret_json}" TARGET_FILE="\${TARGET_FILE}" python3 <<'PY'
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

output = "\\n".join(lines)
Path(os.environ["TARGET_FILE"]).write_text(output + ("\\n" if output else ""), encoding="utf-8")
PY

	chmod 600 "\${TARGET_FILE}"
	exit 0
fi

if [[ -n "\${FALLBACK_FILE}" && -f "\${FALLBACK_FILE}" ]]; then
	cp "\${FALLBACK_FILE}" "\${TARGET_FILE}"
	chmod 600 "\${TARGET_FILE}"
	exit 0
fi

echo "Missing worker env configuration. Set worker_secret_arn or create \${FALLBACK_FILE}."
exit 1
SCRIPT
chmod +x /usr/local/bin/smart-deploy-worker-write-env

cat >/usr/local/bin/smart-deploy-worker-login <<'SCRIPT'
#!/bin/bash
set -euo pipefail

IMAGE="\${1:-}"
AWS_REGION="${AWS_REGION}"

if [[ -z "\${IMAGE}" ]]; then
	echo "Image is required"
	exit 1
fi

if [[ "\${IMAGE}" != *.dkr.ecr.*.amazonaws.com/* ]]; then
	exit 0
fi

ecr_registry="\$(echo "\${IMAGE}" | cut -d'/' -f1)"
aws ecr get-login-password --region "\${AWS_REGION}" | docker login --username AWS --password-stdin "\${ecr_registry}"
SCRIPT
chmod +x /usr/local/bin/smart-deploy-worker-login

cat >/usr/local/bin/smart-deploy-worker-prune-images <<'SCRIPT'
#!/bin/bash
set -euo pipefail

IMAGE="\${1:-}"

if [[ -z "\${IMAGE}" ]]; then
	echo "Image is required"
	exit 1
fi

image_no_digest="\${IMAGE%@*}"
repo_ref="\${image_no_digest%:*}"
if [[ "\${repo_ref}" == "\${image_no_digest}" ]]; then
	repo_ref="\${image_no_digest}"
fi

docker image ls --format '{{.Repository}}:{{.Tag}}' "\${repo_ref}" | while read -r candidate; do
	if [[ -z "\${candidate}" || "\${candidate}" == "\${IMAGE}" ]]; then
		continue
	fi

	docker image rm -f "\${candidate}" || true
done

docker image prune -f >/dev/null 2>&1 || true
SCRIPT
chmod +x /usr/local/bin/smart-deploy-worker-prune-images

aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

if [[ ! -f /etc/nginx/conf.d/smart-deploy-worker.conf ]]; then
	cat >/etc/nginx/conf.d/smart-deploy-worker.conf <<'NGINX'
server {
  listen 80;
  server_name ${worker_dns_record};

  location / {
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 3600;
    proxy_pass http://127.0.0.1:${WORKER_PORT};
  }
}
NGINX
else
	echo "Preserving existing nginx worker config at /etc/nginx/conf.d/smart-deploy-worker.conf"
fi

nginx -t
systemctl enable nginx
systemctl restart nginx

cat >/etc/systemd/system/smart-deploy-worker.service <<'UNIT'
[Unit]
Description=Smart Deploy Worker Container
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
TimeoutStartSec=0
ExecStartPre=-/usr/bin/docker rm -f smart-deploy-worker
ExecStartPre=/usr/local/bin/smart-deploy-worker-login ${WORKER_IMAGE}
ExecStartPre=/usr/local/bin/smart-deploy-worker-prune-images ${WORKER_IMAGE}
ExecStartPre=/usr/bin/docker pull ${WORKER_IMAGE}
ExecStartPre=/usr/local/bin/smart-deploy-worker-write-env "${worker_secret_arn}" "/run/smart-deploy-worker.env" "/opt/smart-deploy/.env"
ExecStart=/usr/bin/docker run --name smart-deploy-worker -p ${WORKER_PORT}:${WORKER_PORT} --env-file /run/smart-deploy-worker.env ${WORKER_IMAGE}
ExecStop=/usr/bin/docker stop smart-deploy-worker

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable smart-deploy-worker
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

	worker_release_log "Waiting for SSM command completion: ${command_id}"
	if ! aws ssm wait command-executed --region "${AWS_REGION}" --command-id "${command_id}" --instance-id "${instance_id}"; then
		worker_release_log "SSM command reported a failure state"
	fi

	worker_release_log "SSM rollout status"
	aws ssm get-command-invocation \
		--region "${AWS_REGION}" \
		--command-id "${command_id}" \
		--instance-id "${instance_id}" \
		--query '{Status:Status,ResponseCode:ResponseCode,ExecutionElapsedTime:ExecutionElapsedTime}' \
		--output json
	worker_release_log "If you need full logs, run: aws ssm get-command-invocation --command-id ${command_id} --instance-id ${instance_id} --region ${AWS_REGION}"
}

worker_release_postflight_message() {
	cat <<EOF

Deployment finished.
Next checks on worker host:
  sudo systemctl cat smart-deploy-worker
  sudo systemctl restart smart-deploy-worker
  sudo systemctl status smart-deploy-worker --no-pager
  sudo docker logs smart-deploy-worker --tail 100

EOF
}
