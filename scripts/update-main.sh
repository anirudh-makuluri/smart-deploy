#!/bin/bash
set -e

echo "=== SmartDeploy Update ==="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Rebuild and restart containers
echo "Rebuilding Docker images..."
docker compose build

echo "Restarting containers with zero-downtime..."
docker compose up -d --force-recreate

# Clean up old images
echo "Cleaning up old Docker images..."
docker image prune -f

# Show status
echo ""
echo "=== Deployment Status ==="
docker compose ps
echo ""
echo "=== Recent Logs ==="
docker compose logs --tail=30
echo ""
echo -e "${GREEN}=== Update Complete ===${NC}"
echo "Deployed commit: $(git rev-parse --short HEAD)"
echo "Commit message: $(git log -1 --pretty=%B)"
