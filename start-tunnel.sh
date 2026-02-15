#!/bin/bash
# Script to start Rammerhead with a public tunnel
# This allows access from any network

echo "Starting Rammerhead server..."
cd "$(dirname "$0")"
npm run start > /dev/null 2>&1 &
SERVER_PID=$!
echo "Server started (PID: $SERVER_PID)"
sleep 3

echo ""
echo "Starting tunnel (this may take a moment)..."
echo "Press Ctrl+C to stop both server and tunnel"
echo ""

# Try to use localtunnel
npx --yes localtunnel --port 8080 2>&1 | while IFS= read -r line; do
    echo "$line"
    if [[ "$line" == *"your url is"* ]] || [[ "$line" == *"https://"* ]]; then
        TUNNEL_URL=$(echo "$line" | grep -oE 'https://[^[:space:]]+')
        if [ ! -z "$TUNNEL_URL" ]; then
            echo ""
            echo "=========================================="
            echo "✅ Tunnel is ready!"
            echo "Access your proxy at: $TUNNEL_URL"
            echo "=========================================="
            echo ""
        fi
    fi
done

# Cleanup on exit
trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM
