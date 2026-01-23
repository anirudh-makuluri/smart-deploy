#!/bin/bash
set -e

# SmartDeploy - Initial Deployment Script
# Run this on EC2 for first-time setup

echo "=== SmartDeploy Initial Deployment ==="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/anirudh-makuluri/smart-deploy.git"
APP_DIR="/opt/smartdeploy"
BRANCH="main"

# Check if running as ubuntu user
if [ "$USER" != "ubuntu" ]; then
    echo -e "${YELLOW}Warning: Running as $USER, expected ubuntu${NC}"
fi

# Step 1: Install Docker if not present
install_docker() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}Docker already installed${NC}"
    else
        echo "Installing Docker..."
        sudo apt-get update
        sudo apt-get install -y ca-certificates curl gnupg
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
          sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        sudo usermod -aG docker ubuntu
        echo -e "${GREEN}Docker installed successfully${NC}"
        echo -e "${YELLOW}Please log out and back in for docker group to take effect, then run this script again${NC}"
        exit 0
    fi
}

# Step 2: Clone or update repository
setup_repo() {
    echo "Setting up repository..."
    
    if [ -d "$APP_DIR/.git" ]; then
        echo "Repository exists, pulling latest changes..."
        cd "$APP_DIR"
        git fetch origin
        git reset --hard origin/$BRANCH
        git clean -fd  # Remove untracked files
    else
        echo "Setting up fresh repository..."
        
        # Check if directory has files (including hidden ones)
        if [ "$(ls -A $APP_DIR 2>/dev/null)" ]; then
            echo -e "${YELLOW}Directory is not empty. Backing up .env if it exists...${NC}"
            # Backup .env if it exists
            if [ -f "$APP_DIR/.env" ]; then
                sudo cp "$APP_DIR/.env" /tmp/smartdeploy-env-backup
                echo -e "${GREEN}.env backed up${NC}"
            fi
            
            # Remove all files including hidden ones - more reliable method
            echo "Cleaning directory..."
            cd /tmp
            sudo rm -rf "$APP_DIR"/{*,.[!.]*,..?*} 2>/dev/null || true
            # Alternative: move everything out and delete
            if [ "$(ls -A $APP_DIR 2>/dev/null)" ]; then
                sudo mv "$APP_DIR" "${APP_DIR}.old"
                sudo mkdir -p "$APP_DIR"
                sudo rm -rf "${APP_DIR}.old"
            fi
        fi
        
        # Clone the repository
        echo "Cloning repository..."
        git clone -b $BRANCH "$REPO_URL" "$APP_DIR"
        
        # Restore .env if it was backed up
        if [ -f "/tmp/smartdeploy-env-backup" ]; then
            sudo cp /tmp/smartdeploy-env-backup "$APP_DIR/.env"
            sudo rm /tmp/smartdeploy-env-backup
            echo -e "${GREEN}.env restored${NC}"
        fi
    fi
    
    cd "$APP_DIR"
    echo -e "${GREEN}Repository setup complete${NC}"
}

# Step 3: Setup environment file
setup_env() {
    if [ ! -f "$APP_DIR/.env" ]; then
        echo -e "${YELLOW}No .env file found. Creating from example...${NC}"
        cp "$APP_DIR/.env.example" "$APP_DIR/.env"
        echo -e "${RED}IMPORTANT: Edit $APP_DIR/.env with your actual values before continuing!${NC}"
        echo "Run: nano $APP_DIR/.env"
        exit 1
    else
        echo -e "${GREEN}.env file exists${NC}"
    fi
}

# Step 4: Build and start containers
deploy() {
    echo "Building Docker images..."
    cd "$APP_DIR"
    
    # Build images
    docker compose build --no-cache
    
    # Stop existing containers if any
    docker compose down 2>/dev/null || true
    
    # Start containers
    docker compose up -d
    
    echo -e "${GREEN}Containers started successfully${NC}"
}

# Step 5: Update Nginx config for Docker
update_nginx() {
    echo "Updating Nginx configuration..."
    
    sudo tee /etc/nginx/sites-available/smartdeploy > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;

    # Next.js app (Docker container)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
    }

    # WebSocket endpoint (Docker container)
    location /ws {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
NGINX

    sudo ln -sf /etc/nginx/sites-available/smartdeploy /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t && sudo systemctl reload nginx
    
    echo -e "${GREEN}Nginx updated${NC}"
}

# Step 6: Show status
show_status() {
    echo ""
    echo "=== Deployment Status ==="
    docker compose ps
    echo ""
    echo "=== Container Logs (last 20 lines) ==="
    docker compose logs --tail=20
    echo ""
    echo -e "${GREEN}=== Deployment Complete ===${NC}"
    echo "Access your application at: http://$(curl -s ifconfig.me)"
}

# Main execution
main() {
    install_docker
    setup_repo
    setup_env
    deploy
    update_nginx
    show_status
}

main "$@"
