#!/usr/bin/env bash
set -euo pipefail

# Renew Let's Encrypt certs and reload nginx if renewal succeeds.

if [[ "${EUID}" -ne 0 ]]; then
	echo "Run as root (sudo)."
	exit 1
fi

certbot renew --dry-run
certbot renew
nginx -t
systemctl reload nginx

echo "Certificate renewal check complete."
certbot certificates || true
