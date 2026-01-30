#!/bin/bash
set -e

# SmartDeploy - Add swap for t3.micro (1GB RAM)
# Run once on EC2: sudo ./scripts/setup-swap.sh
# Required so Docker build (Next.js) doesn't run out of memory

SWAP_FILE="/swapfile"
SWAP_SIZE_GB=2

echo "=== Adding ${SWAP_SIZE_GB}GB swap (for t3.micro build) ==="

if [ -f "$SWAP_FILE" ]; then
    echo "Swap file already exists. Current swap:"
    free -h
    exit 0
fi

echo "Creating ${SWAP_SIZE_GB}GB swap file..."
sudo fallocate -l ${SWAP_SIZE_GB}G "$SWAP_FILE"
sudo chmod 600 "$SWAP_FILE"
sudo mkswap "$SWAP_FILE"
sudo swapon "$SWAP_FILE"

echo "Making swap permanent (survives reboot)..."
if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab
fi

echo ""
echo "Swap enabled. Current memory:"
free -h
echo ""
echo "You can now run deploy.sh or update.sh; the Docker build should succeed."
