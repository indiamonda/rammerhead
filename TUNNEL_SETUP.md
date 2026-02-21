# Tunnel Setup Guide

Access your Unlinewize proxy from **any network** using a tunnel service.

## 🎯 Why Use a Tunnel?

When you switch WiFi networks, you can't access `192.168.1.198:8080` because it's a local network IP. A tunnel creates a public URL that works from anywhere!

## 🚀 Quick Start

### Option 1: localtunnel (Easiest - No Signup)

```bash
# Make sure server is running
npm run start

# In a new terminal, start tunnel
npm run tunnel
```

You'll get a URL like `https://xxxxx.loca.lt` - use this from any network!

### Option 2: All-in-One Script

```bash
./start-with-tunnel.sh
```

This starts both server and tunnel automatically.

## 📋 Tunnel Options

### 1. localtunnel (Recommended for Beginners)

**Pros:**
- ✅ Free, no signup required
- ✅ Easy to use
- ✅ Works immediately

**Cons:**
- ❌ URL changes each restart
- ❌ May be slower than other options

**Setup:**
```bash
npm run tunnel
# or
npx --yes localtunnel --port 8080
```

### 2. Cloudflare Tunnel (Most Reliable)

**Pros:**
- ✅ Free and reliable
- ✅ Fast performance
- ✅ Can use custom domain

**Cons:**
- ❌ Requires installation
- ❌ More setup steps

**Setup:**
```bash
# Install cloudflared
brew install cloudflared
# or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

# Run tunnel
cloudflared tunnel --url http://localhost:8080
```

### 3. ngrok (Popular Choice)

**Pros:**
- ✅ Very reliable
- ✅ Can reserve URLs (paid)
- ✅ Good documentation

**Cons:**
- ❌ Requires account signup
- ❌ Free tier has limitations

**Setup:**
```bash
# Install
brew install ngrok
# or download from: https://ngrok.com/download

# Sign up and get token from https://dashboard.ngrok.com/get-started/your-authtoken
ngrok config add-authtoken YOUR_TOKEN

# Run tunnel
ngrok http 8080
```

### 4. serveo.net (SSH-based)

**Pros:**
- ✅ No installation needed
- ✅ Uses SSH

**Cons:**
- ❌ Less reliable
- ❌ Requires SSH

**Setup:**
```bash
ssh -R 80:localhost:8080 serveo.net
```

## 🔧 Advanced Configuration

### Using a Custom Subdomain (localtunnel)

```bash
npx --yes localtunnel --port 8080 --subdomain unlinewize
```

Note: Custom subdomains may require paid plans on some services.

### Persistent URLs

Most free tunnels generate new URLs each time. For persistent URLs:
- **ngrok**: Paid plan allows reserved domains
- **Cloudflare Tunnel**: Can use custom domain
- **localtunnel**: Free tier generates random URLs

## 📝 Important Notes

### Keep Both Running

- The **server** must stay running
- The **tunnel** must stay running
- If either stops, access will be lost

### URL Changes

- Free tunnel URLs change each restart
- Save/bookmark the new URL after restarting
- Paid plans often allow persistent URLs

### HTTPS Support

- All tunnel URLs use HTTPS automatically
- The proxy interface detects tunnel URLs
- No redirect issues with tunnel URLs

### Security

- Tunnel URLs are public (anyone with the URL can access)
- Consider enabling password protection in `src/config.js`
- Don't share tunnel URLs publicly

## 🐛 Troubleshooting

### Tunnel Won't Start

```bash
# Check if server is running
curl http://localhost:8080

# Try a different port
npx --yes localtunnel --port 8080 --subdomain test
```

### Connection Timeout

- Verify server is running on port 8080
- Check firewall isn't blocking connections
- Try a different tunnel service

### URL Not Working

- Ensure tunnel is still running
- Check the URL is correct (copy-paste it)
- Try restarting the tunnel

### Slow Performance

- Tunnels add latency (normal)
- Try a different tunnel service
- Consider paid options for better performance

## 🔄 Switching Between Tunnels

You can use different tunnels at different times:

1. Stop current tunnel (Ctrl+C)
2. Start new tunnel service
3. Use the new URL provided

The proxy automatically detects and works with any tunnel URL.

## 📚 Related Documentation

- [QUICK_START.md](QUICK_START.md) - Basic setup
- [DEPLOY.md](DEPLOY.md) - Cloud deployment (alternative to tunnels)
- [README.md](README.md) - Full documentation

---

**Tip:** For permanent access, consider cloud deployment instead of tunnels. See [DEPLOY.md](DEPLOY.md).
