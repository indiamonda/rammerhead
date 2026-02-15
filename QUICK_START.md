# Quick Start Guide

## Access from Same Network (Local)

```bash
npm run start
```

Then open: `http://192.168.1.198:8080/`

## Access from Any Network (Tunnel)

### Option 1: Use the All-in-One Script (Easiest)

```bash
./start-with-tunnel.sh
```

This starts both the server and tunnel automatically. Copy the URL shown (e.g., `https://xxxxx.loca.lt`).

### Option 2: Manual Setup

**Terminal 1 - Start Server:**
```bash
npm run start
```

**Terminal 2 - Start Tunnel:**
```bash
npm run tunnel
```

Then use the URL provided by localtunnel.

## What Changed

✅ **Fixed redirect logic** - Now allows tunnel URLs (`.loca.lt`, `.ngrok.io`, etc.)
✅ **Added tunnel support** - Access from any WiFi network
✅ **Created helper scripts** - Easy setup and management

## Troubleshooting

**Can't access from different network?**
- Make sure the tunnel is running
- Use the tunnel URL, not the local IP
- Check that both server and tunnel terminals are running

**Tunnel URL not working?**
- The tunnel must stay running
- Try restarting the tunnel
- Check firewall settings

**Server not starting?**
- Make sure port 8080 is not in use
- Check `server.log` for errors
