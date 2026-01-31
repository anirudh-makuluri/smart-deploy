#!/bin/bash
set -e

# SmartDeploy - Update Deployment Script
# Run this on EC2 to update to latest version

echo "=== SmartDeploy Update ==="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

APP_DIR="/opt/smartdeploy"
BRANCH="main"

cd "$APP_DIR"

# Step 1: Pull latest code
echo "Pulling latest changes from $BRANCH..."
git fetch origin
git reset --hard origin/$BRANCH


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
echo "=== Update Status ==="
docker compose ps
echo ""
echo "=== Recent Logs ==="
docker compose logs --tail=30
echo ""
echo -e "${GREEN}=== Update Complete ===${NC}"
echo "Current commit: $(git rev-parse --short HEAD)"
echo "Commit message: $(git log -1 --pretty=%B)"
