#!/bin/bash

# SmartDeploy - Status Script

APP_DIR="/opt/smartdeploy"
cd "$APP_DIR"

echo "=== SmartDeploy Status ==="
echo ""

echo "📦 Container Status:"
docker compose ps
echo ""

echo "💾 Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
echo ""

echo "🔗 Git Info:"
echo "  Branch: $(git branch --show-current)"
echo "  Commit: $(git rev-parse --short HEAD)"
echo "  Message: $(git log -1 --pretty=%B | head -1)"
echo ""

echo "🌐 Network:"
echo "  Public IP: $(curl -s ifconfig.me)"
echo "  App URL: http://$(curl -s ifconfig.me)"
echo ""

echo "🏥 Health Check:"
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|302"; then
    echo "  App: ✅ Healthy"
else
    echo "  App: ❌ Unhealthy"
fi

if curl -s -o /dev/null -w "%{http_code}" http://localhost:4001 2>/dev/null | grep -q "101\|200"; then
    echo "  WebSocket: ✅ Healthy"
else
    echo "  WebSocket: ⚠️  Check manually"
fi
