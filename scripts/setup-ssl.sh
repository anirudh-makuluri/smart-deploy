#!/bin/bash
set -e

# SmartDeploy - SSL Setup Script with Let's Encrypt
# Run this after initial deployment to set up SSL certificates

echo "=== SmartDeploy SSL Setup ==="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run with sudo${NC}"
    exit 1
fi

# Get domain name
read -p "Enter your domain name (e.g., example.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Domain name is required${NC}"
    exit 1
fi

# Get email for Let's Encrypt
read -p "Enter your email for Let's Encrypt notifications: " EMAIL

if [ -z "$EMAIL" ]; then
    echo -e "${RED}Email is required${NC}"
    exit 1
fi

echo "Setting up SSL for domain: $DOMAIN"

# Step 1: Install Certbot
echo "Installing Certbot..."
apt-get update
apt-get install -y certbot python3-certbot-nginx

# Step 2: Create temporary Nginx config for domain verification
echo "Creating temporary Nginx configuration..."
cat > /etc/nginx/sites-available/smartdeploy << NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # Allow Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Temporary: proxy to app (will be updated after SSL)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://127.0.0.1:4001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
    }
}
NGINX

# Enable the site
ln -sf /etc/nginx/sites-available/smartdeploy /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
nginx -t && systemctl reload nginx

# Step 3: Obtain SSL certificate
echo ""
echo -e "${YELLOW}IMPORTANT: Make sure your domain $DOMAIN points to this server's IP!${NC}"
echo "Current server IP: $(curl -s ifconfig.me)"
read -p "Press Enter to continue with certificate generation..."

certbot --nginx -d $DOMAIN -d www.$DOMAIN \
    --non-interactive \
    --agree-tos \
    --email $EMAIL \
    --redirect \
    --expand

if [ $? -eq 0 ]; then
    echo -e "${GREEN}SSL certificate obtained successfully!${NC}"
    
    # Certbot automatically updates Nginx config, but let's verify
    nginx -t && systemctl reload nginx
    
    echo ""
    echo -e "${GREEN}=== SSL Setup Complete ===${NC}"
    echo "Your site is now available at: https://$DOMAIN"
    echo ""
    echo "Certificate will auto-renew. To test renewal:"
    echo "  sudo certbot renew --dry-run"
    echo ""
    echo "To check certificate status:"
    echo "  sudo certbot certificates"
else
    echo -e "${RED}Failed to obtain SSL certificate${NC}"
    echo ""
    echo "Common issues:"
    echo "  1. Domain DNS not pointing to this server ($(curl -s ifconfig.me))"
    echo "  2. Port 80 not accessible from internet (check security group)"
    echo "  3. Firewall blocking port 80"
    echo "  4. Domain already has a certificate (use --force-renewal if needed)"
    exit 1
fi
