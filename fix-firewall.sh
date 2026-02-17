#!/bin/bash

# Script to help fix firewall issues on macOS

echo "=== Rammerhead Firewall Fix ==="
echo ""

# Check if server is running
if ! curl -s --connect-timeout 2 http://localhost:8080/ > /dev/null 2>&1; then
    echo "❌ Server is not running on localhost:8080"
    echo "   Please start the server first: npm run start"
    exit 1
fi

echo "✓ Server is running on localhost:8080"
echo ""

# Get Node.js path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    NODE_PATH="/usr/local/bin/node"
fi

echo "Node.js path: $NODE_PATH"
echo ""

# Check firewall status
echo "=== Checking Firewall Status ==="
FW_STATUS=$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | grep -i "enabled" || echo "unknown")

if echo "$FW_STATUS" | grep -qi "enabled"; then
    echo "⚠️  Firewall is ENABLED - this may be blocking connections"
    echo ""
    echo "To fix this, run one of the following:"
    echo ""
    echo "Option 1: Allow Node.js through firewall (recommended)"
    echo "  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $NODE_PATH"
    echo "  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $NODE_PATH"
    echo ""
    echo "Option 2: Temporarily disable firewall (for testing)"
    echo "  System Settings → Network → Firewall → Turn Off Firewall"
    echo ""
    echo "Option 3: Use a tunnel instead (works from any network)"
    echo "  npm run tunnel"
    echo ""
else
    echo "✓ Firewall appears to be disabled or not blocking"
    echo ""
    echo "If you still can't access from other devices:"
    echo "  1. Verify your IP address: ifconfig | grep 'inet '"
    echo "  2. Make sure devices are on the same WiFi network"
    echo "  3. Try using a tunnel: npm run tunnel"
fi

echo ""
echo "=== Current Network Configuration ==="
echo "Server binding: 0.0.0.0:8080 (should allow all connections)"
echo ""

# Try to get actual IP
ACTUAL_IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}' || echo "unknown")
if [ "$ACTUAL_IP" != "unknown" ]; then
    echo "Your IP address: $ACTUAL_IP"
    echo "Try accessing: http://$ACTUAL_IP:8080/"
    echo ""
    if [ "$ACTUAL_IP" != "192.168.1.198" ]; then
        echo "⚠️  Your IP ($ACTUAL_IP) is different from 192.168.1.198"
        echo "   Use the IP shown above instead!"
    fi
else
    echo "Could not determine IP address"
    echo "Check System Settings → Network for your IP"
fi

echo ""
echo "=== Quick Test ==="
echo "Test from another device on the same network:"
if [ "$ACTUAL_IP" != "unknown" ]; then
    echo "  http://$ACTUAL_IP:8080/"
else
    echo "  http://192.168.1.198:8080/"
fi
echo ""
echo "If that doesn't work, use a tunnel:"
echo "  npm run tunnel"
