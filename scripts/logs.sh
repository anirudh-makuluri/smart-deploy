#!/bin/bash

# SmartDeploy - View Logs Script

APP_DIR="/opt/smartdeploy"
cd "$APP_DIR"

case "$1" in
    app)
        echo "=== Next.js App Logs ==="
        docker compose logs -f app
        ;;
    ws|websocket)
        echo "=== WebSocket Server Logs ==="
        docker compose logs -f websocket
        ;;
    all|"")
        echo "=== All Logs ==="
        docker compose logs -f
        ;;
    *)
        echo "Usage: $0 [app|ws|all]"
        echo "  app  - Show Next.js app logs"
        echo "  ws   - Show WebSocket server logs"
        echo "  all  - Show all logs (default)"
        exit 1
        ;;
esac
