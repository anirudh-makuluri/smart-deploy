#!/bin/bash
set -e

# SmartDeploy - Update Deployment Script
# This script is used to update the main branch of the repository

echo "=== SmartDeploy Update ==="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color


# Step 2: Rebuild and restart containers
echo "Rebuilding Docker images..."
docker compose build

echo "Restarting containers with zero-downtime..."
# Pull new images and restart with minimal downtime
docker compose up -d --force-recreate

# Step 3: Clean up old images
echo "Cleaning up old Docker images..."
docker image prune -f

# Step 4: Show status
echo ""
echo "=== Update Main Status ==="
docker compose ps
echo ""
echo "=== Recent Logs ==="
docker compose logs --tail=30
echo ""
echo -e "${GREEN}=== Update Main Complete ===${NC}"
echo "Current commit: $(git rev-parse --short HEAD)"
echo "Commit message: $(git log -1 --pretty=%B)"