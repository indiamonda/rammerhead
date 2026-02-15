# Accessing Rammerhead from Any Network

When you're on a different WiFi network, you can't access the local IP address `192.168.1.198:8080`. Use a tunnel to make your server accessible from anywhere.

## Quick Start

### Option 1: Using localtunnel (Easiest)

1. Make sure the server is running:
   ```bash
   npm run start
   ```

2. In a new terminal, run:
   ```bash
   npx --yes localtunnel --port 8080
   ```

3. You'll get a URL like `https://xxxxx.loca.lt` - use this URL to access your proxy from any network!

### Option 2: Using the helper script

```bash
./start-tunnel.sh
```

This will start both the server and tunnel automatically.

## Other Tunnel Options

### Cloudflare Tunnel (Free, More Reliable)

1. Install cloudflared:
   ```bash
   brew install cloudflared
   # or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
   ```

2. Run:
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```

### ngrok (Requires Account)

1. Sign up at https://ngrok.com
2. Install: `brew install ngrok`
3. Authenticate: `ngrok config add-authtoken YOUR_TOKEN`
4. Run: `ngrok http 8080`

## Notes

- Tunnel URLs change each time you restart (except with paid plans)
- The tunnel must stay running while you want to access the server
- HTTPS tunnel URLs are automatically supported - no redirect needed
