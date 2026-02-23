#!/bin/bash
# Run this on the machine that should serve the app (same machine where you run npm start).
# It checks why http://YOUR_IP:8080/ might not be reachable.

echo "=== Unlinewize local access check ==="
echo ""

# 1. Your actual IP(s)
echo "1. Your IP address(es) on this machine:"
if command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | grep "inet " | grep -v "127.0.0.1" | awk '{print "   " $2}' || true
elif command -v ip >/dev/null 2>&1; then
    ip -4 addr show 2>/dev/null | grep inet | grep -v "127.0.0.1" | awk '{print "   " $2}' | cut -d/ -f1 || true
fi
echo "   → Use one of these in the browser, e.g. http://<IP>:8080/"
echo ""

# 2. Is anything listening on 8080?
echo "2. Is anything listening on port 8080?"
if command -v lsof >/dev/null 2>&1; then
    LISTEN=$(lsof -i :8080 -sTCP:LISTEN 2>/dev/null)
    if [ -n "$LISTEN" ]; then
        echo "$LISTEN" | head -5
        echo "   → Something is listening. If it's node, the server is running."
    else
        echo "   → Nothing is listening on 8080. Start the server: npm run build && npm start"
    fi
elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -E "8080|LISTEN" || true
else
    echo "   → (lsof/netstat not found) Start the server: npm run build && npm start"
fi
echo ""

# 3. Quick localhost test
echo "3. Testing localhost:8080..."
if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://127.0.0.1:8080/ 2>/dev/null | grep -q "200\|301\|302"; then
    echo "   → OK: Server responds on 127.0.0.1:8080 (same machine)"
    echo "   → If you can't open http://192.168.1.198:8080 from this or another device:"
    echo "     - Use the IP from step 1 instead of 192.168.1.198 if it's different"
    echo "     - On macOS: allow Node in Firewall or temporarily turn it off to test"
    echo "     - From another device: same Wi‑Fi and use http://<IP-from-step-1>:8080/"
else
    echo "   → Server not responding on 127.0.0.1:8080"
    echo "   → Start the server in this folder: npm run build && npm start"
fi
echo ""

echo "Done. Use the IP from step 1 (or localhost) to open the app in your browser."
