#!/usr/bin/env bash
#
# One-shot setup for rammerhead on an Oracle Cloud Always Free Ubuntu VM.
# Run as: sudo bash oracle-setup.sh
#
# What it does:
#   1. Updates the system
#   2. Installs Node.js 18, Git
#   3. Opens ports 80/443 in iptables
#   4. Clones the repo, builds
#   5. Installs Caddy (reverse proxy with auto-HTTPS)
#   6. Creates a systemd service for rammerhead
#
# Prerequisites:
#   - Fresh Ubuntu 22.04/24.04 VM on Oracle Cloud
#   - DNS A record for your domain already pointing to this VM's public IP
#
# Usage:
#   export RH_DOMAIN="unlinewize.jimmyqrg.com"   # your domain
#   export RH_REPO="https://github.com/jimmyqrg/rammerhead.git"
#   sudo -E bash oracle-setup.sh

set -euo pipefail

DOMAIN="${RH_DOMAIN:?Set RH_DOMAIN to your domain (e.g. unlinewize.jimmyqrg.com)}"
REPO="${RH_REPO:-https://github.com/jimmyqrg/rammerhead.git}"
APP_USER="ubuntu"
APP_DIR="/home/${APP_USER}/rammerhead"

echo "==> Domain: ${DOMAIN}"
echo "==> Repo:   ${REPO}"
echo ""

# ── 1. System update ──────────────────────────────────────────────
echo "==> Updating system packages..."
apt-get update -y && apt-get upgrade -y

# ── 2. Install Node.js 18 + Git ──────────────────────────────────
echo "==> Installing Node.js 18..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

apt-get install -y git

# ── 3. Open ports 80/443 in iptables ─────────────────────────────
echo "==> Opening ports 80 and 443 in iptables..."
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save
else
    apt-get install -y iptables-persistent
    netfilter-persistent save
fi

# ── 4. Clone repo + build ────────────────────────────────────────
echo "==> Setting up rammerhead..."
if [ -d "${APP_DIR}" ]; then
    echo "    Directory exists, pulling latest..."
    sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && git pull"
else
    sudo -u "${APP_USER}" git clone "${REPO}" "${APP_DIR}"
fi
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm ci && npm run build"

# ── 5. Install Caddy ─────────────────────────────────────────────
echo "==> Installing Caddy..."
if ! command -v caddy &>/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
fi

echo "==> Writing Caddyfile for ${DOMAIN}..."
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy localhost:8080
}
EOF

systemctl enable caddy
systemctl restart caddy

# ── 6. Create systemd service ────────────────────────────────────
echo "==> Creating rammerhead systemd service..."
cat > /etc/systemd/system/rammerhead.service <<EOF
[Unit]
Description=Rammerhead Proxy
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=8080
ExecStart=/usr/bin/node --max-old-space-size=8192 src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable rammerhead
systemctl start rammerhead

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "==> Setup complete!"
echo "    Rammerhead is running on port 8080"
echo "    Caddy is reverse-proxying https://${DOMAIN} -> localhost:8080"
echo ""
echo "    Useful commands:"
echo "      sudo systemctl status rammerhead   # check app status"
echo "      sudo journalctl -u rammerhead -f   # live logs"
echo "      sudo systemctl restart rammerhead  # restart after code changes"
echo "      sudo systemctl status caddy        # check reverse proxy"
echo ""
echo "    To update the app:"
echo "      cd ${APP_DIR} && git pull && npm ci && npm run build"
echo "      sudo systemctl restart rammerhead"
