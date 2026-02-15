# Quick Start Guide

Get up and running with Rammerhead in minutes!

## 🚀 Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd rammerhead

# Install dependencies
npm install

# Build the project
npm run build
```

## 📍 Local Access (Same Network)

### Start the Server

```bash
npm run start
```

### Access the Proxy

Open your browser and navigate to:
- **http://192.168.1.198:8080/** (your local IP)
- **http://localhost:8080/** (same machine)

The server will be accessible from any device on your local network.

## 🌐 Remote Access (Any Network)

When you're on a different WiFi network, use a tunnel to access your proxy.

### Option 1: All-in-One Script (Recommended)

```bash
./start-with-tunnel.sh
```

This automatically starts both the server and tunnel. Copy the URL shown (e.g., `https://xxxxx.loca.lt`).

### Option 2: Manual Setup

**Terminal 1 - Start Server:**
```bash
npm run start
```

**Terminal 2 - Start Tunnel:**
```bash
npm run tunnel
```

Use the URL provided by localtunnel to access from anywhere.

## 🎯 Basic Usage

1. **Open the proxy** in your browser
2. **Type a URL** in the address bar (e.g., `example.com`)
3. **Or search** by typing a search query
4. **Browse** the web through the proxy!

### Keyboard Shortcuts

- **New Tab**: `Ctrl+T` (Windows/Linux) or `Cmd+T` (Mac)
- **Close Tab**: `Ctrl+W` or click the "×" on the tab
- **Refresh**: `F5` or click the refresh button

## 🔧 Key Features

### Tab Management

- Click the **"+"** button to open a new tab
- Click the **"×"** on a tab to close it
- Click a **tab** to switch to it
- Drag tabs to **reorder** them

### Special Pages

- **`jq://newtab/`** - New tab page with search
- **`jq://sessions/`** - Manage your proxy session
- **`jq://settings/`** - Customize title and favicon
- **`jq://home/`** - Home page with all internal links

### Never-Expire Links

1. Navigate to any website
2. Click **"Generate never-expire link"**
3. Copy the link - works from any IP!

## ⚙️ Configuration

Edit `src/config.js` to customize:

- **Port**: Change `port: 8080`
- **Password**: Set `password: 'your-password'`
- **IP Restriction**: Toggle `restrictSessionToIP`

## 🐛 Troubleshooting

### Server Won't Start

```bash
# Check if port is in use
lsof -i :8080

# Kill existing processes
pkill -f "node.*server"

# Try again
npm run start
```

### Can't Access from Other Devices

- Verify `bindingAddress: '0.0.0.0'` in `src/config.js`
- Check firewall isn't blocking port 8080
- Ensure devices are on the same network

### Tunnel Not Working

- Keep both server and tunnel terminals running
- Try restarting the tunnel
- Check the tunnel URL is correct

## 📚 Next Steps

- Read [TUNNEL_SETUP.md](TUNNEL_SETUP.md) for remote access options
- See [DEPLOY.md](DEPLOY.md) for cloud deployment
- Check [README.md](README.md) for full documentation

---

**Need help?** Check the main [README.md](README.md) or visit the [Discord server](https://discord.gg/VNT4E7gN5Y).
