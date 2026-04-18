#!/usr/bin/env bash
set -euo pipefail

# Idempotent swap setup for low-memory hosts.
# Usage:
#   sudo ./scripts/setup-swap.sh
#   SWAP_SIZE_GB=4 sudo ./scripts/setup-swap.sh

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"

if [[ "${EUID}" -ne 0 ]]; then
	echo "Run as root (sudo)."
	exit 1
fi

if [[ -f "${SWAP_FILE}" ]]; then
	echo "Swap file already exists at ${SWAP_FILE}."
	free -h
	exit 0
fi

echo "Creating ${SWAP_SIZE_GB}G swap file at ${SWAP_FILE}"
if command -v fallocate >/dev/null 2>&1; then
	fallocate -l "${SWAP_SIZE_GB}G" "${SWAP_FILE}"
else
	dd if=/dev/zero of="${SWAP_FILE}" bs=1M count="$((SWAP_SIZE_GB * 1024))" status=progress
fi

chmod 600 "${SWAP_FILE}"
mkswap "${SWAP_FILE}"
swapon "${SWAP_FILE}"

if ! grep -q "${SWAP_FILE}" /etc/fstab; then
	echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
fi

echo "Swap enabled:"
free -h
