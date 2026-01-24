#!/bin/bash

# SmartDeploy - SSL Certificate Renewal Script
# This script can be run manually or via cron for automatic renewal

echo "=== Checking SSL Certificate Renewal ==="

# Run certbot renewal in dry-run mode first to check
certbot renew --dry-run

if [ $? -eq 0 ]; then
    echo ""
    echo "Dry-run successful. Running actual renewal..."
    certbot renew
    
    # Reload Nginx if certificates were renewed
    if [ $? -eq 0 ]; then
        systemctl reload nginx
        echo "✅ Certificates renewed and Nginx reloaded"
    fi
else
    echo "❌ Renewal check failed. Please investigate."
    exit 1
fi
