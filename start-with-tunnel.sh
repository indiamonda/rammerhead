#!/bin/bash
# Start Rammerhead server with tunnel for remote access

echo "🚀 Starting Rammerhead with Tunnel..."
echo ""

# Check if server is already running
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Server is already running on port 8080"
    echo "   Using existing server..."
else
    echo "📦 Starting server..."
    cd "$(dirname "$0")"
    npm run start > server.log 2>&1 &
    SERVER_PID=$!
    echo "   Server started (PID: $SERVER_PID)"
    echo "   Logs: server.log"
    sleep 3
fi

echo ""
echo "🌐 Starting tunnel..."
echo "   This will give you a public URL to access from any network"
echo ""
echo "   Press Ctrl+C to stop both server and tunnel"
echo ""

# Start tunnel
npx --yes localtunnel --port 8080 2>&1 | tee tunnel.log | while IFS= read -r line; do
    echo "$line"
    # Extract tunnel URL
    if [[ "$line" == *"your url is"* ]] || [[ "$line" == *"https://"* ]]; then
        TUNNEL_URL=$(echo "$line" | grep -oE 'https://[^[:space:]]+')
        if [ ! -z "$TUNNEL_URL" ]; then
            echo ""
            echo "=========================================="
            echo "✅ TUNNEL READY!"
            echo "=========================================="
            echo ""
            echo "🌍 Access your proxy at:"
            echo "   $TUNNEL_URL"
            echo ""
            echo "📱 This URL works from ANY network!"
            echo ""
            echo "=========================================="
            echo ""
        fi
    fi
done

# Cleanup
if [ ! -z "$SERVER_PID" ]; then
    echo "Stopping server..."
    kill $SERVER_PID 2>/dev/null
fi
