# Quick Access Fix

## Problem
Server is running but can't be accessed from `192.168.1.198:8080` - connection times out.

## Solution 1: Use Tunnel (Easiest - Works from Anywhere)

A tunnel is already being started. Check the output for a URL like `https://xxxxx.loca.lt`

**To start tunnel manually:**
```bash
npm run tunnel
```

**Or use the all-in-one script:**
```bash
./start-with-tunnel.sh
```

The tunnel URL works from:
- ✅ Same network
- ✅ Different WiFi networks
- ✅ Mobile data
- ✅ Anywhere in the world

## Solution 2: Fix Local Network Access

### Step 1: Find Your Actual IP Address

Open Terminal and run:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Or check:
- **System Settings → Network → Your Connection → Details → IP Address**

### Step 2: Update the IP in Browser

If your IP is different from `192.168.1.198`, use the correct IP:
- Example: `http://192.168.1.199:8080/` (use your actual IP)

### Step 3: Check macOS Firewall

1. Open **System Settings**
2. Go to **Network → Firewall**
3. If firewall is ON:
   - Click **Options**
   - Click **+** to add an application
   - Find and add **Node.js** (or Terminal)
   - Make sure it's set to **Allow incoming connections**

**Or temporarily disable firewall for testing:**
- Turn OFF firewall in System Settings
- Test if you can access the server
- Turn it back ON after testing

### Step 4: Verify Same Network

- Make sure your device and the server are on the **same WiFi network**
- Try accessing from your phone on the same WiFi
- Use the correct IP address from Step 1

## Solution 3: Use localhost (Same Machine Only)

If you're accessing from the same computer:
- Use: `http://localhost:8080/`
- This always works if the server is running

## Quick Diagnostic

Run the diagnostic script:
```bash
./fix-firewall.sh
```

This will:
- Check if server is running
- Check firewall status
- Show your actual IP address
- Provide specific fix instructions

## Why Tunnel is Recommended

✅ Works from anywhere (not just local network)
✅ No firewall configuration needed
✅ No IP address issues
✅ Works on mobile data
✅ HTTPS automatically

**Start tunnel:**
```bash
npm run tunnel
```

Then use the URL provided (e.g., `https://xxxxx.loca.lt`)

## Still Not Working?

1. **Check server is running:**
   ```bash
   curl http://localhost:8080/
   ```
   Should return HTML (not error)

2. **Check server logs:**
   ```bash
   tail -f server.log
   ```

3. **Restart server:**
   ```bash
   pkill -f "node.*server"
   npm run start
   ```

4. **Use tunnel (most reliable):**
   ```bash
   npm run tunnel
   ```

---

**The tunnel is the easiest solution - it works from anywhere without any network configuration!**
