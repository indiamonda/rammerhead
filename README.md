# Rammerhead Proxy

> A modern, browser-like web proxy based on testcafe-hammerhead with a beautiful Chrome-inspired interface.

![Rammerhead](https://img.shields.io/badge/Node.js-v16+-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## 🌟 Features

- **Browser-like Interface**: Chrome-inspired UI with tabs, navigation, and modern design
- **Session Management**: Persistent sessions with localStorage and cookie sync
- **Tab Support**: Full tab management with `window.open()` and `window.close()` integration
- **Never-Expire Links**: Generate permanent proxy links that work from any IP
- **Cross-Network Access**: Access from any WiFi network using tunnels
- **Device-Specific Sessions**: One unique session per device
- **Customizable**: Change page title and favicon
- **Special Pages**: Internal browser pages (`jq://newtab/`, `jq://sessions/`, `jq://settings/`, `jq://home/`)

## 🚀 Quick Start

### Local Deployment (Same Network)

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm run start
```

Then access at: **http://192.168.1.198:8080/** (or your local IP)

### Remote Access (Any Network)

Use a tunnel to access from anywhere:

```bash
# Option 1: All-in-one script
./start-with-tunnel.sh

# Option 2: Manual
npm run start        # Terminal 1
npm run tunnel       # Terminal 2
```

See [TUNNEL_SETUP.md](TUNNEL_SETUP.md) for more options.

### Cloud Deployment (Recommended)

Deploy to Replit, Render, Railway, or other platforms for always-on access:

- **Replit** (Easiest): [REPLIT_DEPLOY.md](REPLIT_DEPLOY.md)
- **All Platforms**: [DEPLOY.md](DEPLOY.md)

## 📖 Documentation

- **[QUICK_START.md](QUICK_START.md)](QUICK_START.md)** - Quick reference guide
- **[TUNNEL_SETUP.md](TUNNEL_SETUP.md)** - Remote access setup
- **[DEPLOY.md](DEPLOY.md)** - Cloud deployment guide (Render, Railway, Fly.io)

## 🎯 Usage

### Basic Usage

1. Start the server: `npm run start`
2. Open `http://192.168.1.198:8080/` in your browser
3. Type a URL or search query in the address bar
4. Browse the web through the proxy!

### Special Features

- **New Tab**: Click the "+" button or press `Ctrl+T` (or `Cmd+T` on Mac)
- **Sessions**: Visit `jq://sessions/` to manage your proxy session
- **Settings**: Visit `jq://settings/` to customize title and favicon
- **Home**: Visit `jq://home/` to see all internal pages

### Generate Never-Expire Links

1. Navigate to any website
2. Click "Generate never-expire link" button
3. Copy the link - it works from any IP address!

## 🛠️ Configuration

Edit `src/config.js` to customize:

- **Port**: Change `port: 8080` to your preferred port
- **Binding Address**: Set `bindingAddress: '0.0.0.0'` for network access
- **Password**: Set `password: 'your-password'` to require authentication
- **Session Storage**: Configure session cache settings

For cloud deployment, the server automatically uses the `PORT` environment variable.

## 📦 Requirements

- **Node.js**: v16 or higher
- **npm**: Latest version
- **Memory**: At least 100MB available

## 🔧 Development

```bash
# Install dependencies
npm install

# Build client files
npm run build

# Run in development mode
DEVELOPMENT=true npm start

# Lint code
npm run lint

# Format code
npm run format
```

## 🌐 Deployment

### Local Network

The server runs on `http://192.168.1.198:8080/` by default. Access from any device on the same network.

### Cloud Deployment

Deploy to Render, Railway, Fly.io, or other platforms. See [DEPLOY.md](DEPLOY.md) for detailed instructions.

### Tunnel for Remote Access

Use localtunnel, Cloudflare Tunnel, or ngrok to access from any network. See [TUNNEL_SETUP.md](TUNNEL_SETUP.md).

## 🎨 Customization

### Change Page Title

1. Visit `jq://settings/`
2. Enter your custom title
3. Click "Save"

### Change Favicon

1. Visit `jq://settings/`
2. Upload an image file
3. Click "Save"

Settings are stored in browser localStorage and persist across sessions.

## 🔒 Security

- **IP Restriction**: Sessions can be restricted to specific IPs (configurable)
- **Password Protection**: Enable password in `src/config.js`
- **Session Isolation**: Each device gets its own unique session

## 🐛 Troubleshooting

**Server won't start?**
- Check if port 8080 is in use: `lsof -i :8080`
- Check Node.js version: `node --version` (needs v16+)
- View logs: `tail -f server.log`

**Can't access from other devices?**
- Ensure `bindingAddress: '0.0.0.0'` in config
- Check firewall settings
- Verify you're on the same network

**Tunnel not working?**
- Keep both server and tunnel running
- Check tunnel URL is correct
- Try a different tunnel service

**Styles not loading?**
- Clear browser cache
- Check browser console for errors
- CSS is embedded in HTML for reliability

## 📝 Scripts

- `npm start` - Start the server
- `npm run build` - Build client files
- `npm run tunnel` - Start localtunnel for remote access
- `npm run lint` - Lint code
- `npm run format` - Format code

## 🤝 Contributing

This is a customized version of Rammerhead. Original project: https://github.com/binary-person/rammerhead

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Credits

- Original Rammerhead by [binary-person](https://github.com/binary-person)
- Based on [testcafe-hammerhead](https://github.com/DevExpress/testcafe-hammerhead)
- Chrome-inspired UI design

## 📞 Support

- **Discord**: [Rammerhead Support Server](https://discord.gg/VNT4E7gN5Y)
- **Original Repo**: https://github.com/binary-person/rammerhead

---

**Made with ❤️ for private and secure web browsing**
