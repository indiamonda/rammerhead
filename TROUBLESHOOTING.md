# Troubleshooting Guide

## Server Won't Start

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::8080`

**Solution:**
```bash
# Kill existing processes
pkill -9 -f "node.*server"
pkill -9 -f "unlinewize"

# Wait a moment, then restart
npm run start
```

### Node.js Version Issues

**Error:** Compatibility issues with Node.js v24+

**Solution:** Workers are disabled by default in `src/config.js` for Node.js v24+ compatibility. If you still have issues, ensure you're using Node.js v16-v20.

---

## Connection Timeout (ERR_CONNECTION_TIMED_OUT)

### Server Running but Can't Access from Browser

**Symptoms:**
- Server shows "listening on http://0.0.0.0:8080"
- Browser shows "ERR_CONNECTION_TIMED_OUT" on `192.168.1.198:8080`

**Solutions:**

#### 1. Check Firewall Settings

**macOS:**
```bash
# Check firewall status
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Allow Node.js through firewall (if enabled)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/node
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /usr/local/bin/node
```

**Or disable firewall temporarily:**
- System Settings → Network → Firewall → Turn Off Firewall (temporarily for testing)

#### 2. Verify IP Address

The IP `192.168.1.198` might not be correct. Find your actual IP:

**macOS:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Or check System Settings:**
- System Settings → Network → Your connection → Details → IP Address

#### 3. Test Localhost First

```bash
# Test if server works locally
curl http://localhost:8080/

# If this works, the server is fine - it's a network/firewall issue
```

#### 4. Check Server Binding

Verify in `src/config.js`:
```javascript
bindingAddress: '0.0.0.0',  // Should be 0.0.0.0, not 127.0.0.1
```

#### 5. Test from Another Device

- Make sure both devices are on the same WiFi network
- Try accessing from your phone's browser
- Use the correct IP address from step 2

---

## Server Crashes on Startup

### TypeError: Cannot read properties of undefined (reading 'process')

**Cause:** Node.js v24+ compatibility issue with `sticky-session-custom`

**Solution:** Workers are already disabled in `src/config.js`. If you still see this error:

1. Check `src/config.js`:
```javascript
const enableWorkers = false; // Should be false
```

2. Restart the server:
```bash
pkill -f "node.*server"
npm run start
```

---

## Styles Not Loading

**Symptoms:** Page loads but looks unstyled

**Solution:** CSS is embedded in `public/index.html`. If styles aren't loading:

1. Clear browser cache (Ctrl+Shift+Delete or Cmd+Shift+Delete)
2. Hard refresh (Ctrl+F5 or Cmd+Shift+R)
3. Check browser console for errors
4. Verify `public/index.html` has the embedded `<style>` tag

---

## Can't Access from Different Network

**Use a tunnel** - see [TUNNEL_SETUP.md](TUNNEL_SETUP.md)

```bash
# Start tunnel
npm run tunnel

# Use the provided URL (e.g., https://xxxxx.loca.lt)
```

---

## Session Issues

### Sessions Not Persisting

- Sessions are stored per device in localStorage
- Each device gets its own unique session ID
- Sessions persist in browser localStorage, not on server

### Can't Generate Never-Expire Links

- Make sure you're on a valid website (not `jq://` pages)
- Check browser console for errors
- Verify server is running and accessible

---

## Quick Diagnostic Commands

```bash
# Check if server is running
curl http://localhost:8080/

# Check server logs
tail -f server.log

# Check what's using port 8080
lsof -i :8080

# Test server response
curl -I http://localhost:8080/

# Check Node.js version
node --version  # Should be v16-v20 or v24+ (with workers disabled)
```

---

## Still Having Issues?

1. **Check server logs:** `tail -f server.log`
2. **Check browser console:** F12 → Console tab
3. **Verify configuration:** Check `src/config.js` settings
4. **Try localhost first:** `http://localhost:8080/`
5. **Use tunnel:** For remote access, use [TUNNEL_SETUP.md](TUNNEL_SETUP.md)

---

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `ERR_CONNECTION_TIMED_OUT` | Firewall or wrong IP | Check firewall, verify IP |
| `EADDRINUSE` | Port in use | Kill existing process |
| `Cannot read properties of undefined` | Node.js v24+ issue | Workers disabled (already fixed) |
| `404 Not Found` | Route not registered | Check `setupRoutes.js` |
| `ECONNREFUSED` | Server not running | Start server: `npm run start` |

---

For more help, see:
- [README.md](README.md) - Full documentation
- [QUICK_START.md](QUICK_START.md) - Setup guide
- [TUNNEL_SETUP.md](TUNNEL_SETUP.md) - Remote access
