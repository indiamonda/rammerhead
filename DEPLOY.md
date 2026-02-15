# Deployment Guide

## Option 1: Render (Recommended - Free Tier)

### Steps:

1. **Push to GitHub** (if not already):
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push
   ```

2. **Deploy on Render**:
   - Go to https://render.com
   - Sign up/login (free)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the rammerhead repository
   - Render will auto-detect the settings:
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm start`
     - **Environment**: Node
   - Click "Create Web Service"
   - Wait for deployment (5-10 minutes)

3. **Access your proxy**:
   - Render will give you a URL like: `https://rammerhead-proxy.onrender.com`
   - Use this URL from anywhere!

### Notes:
- Free tier spins down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- Upgrade to paid for always-on service

---

## Option 2: Railway

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway auto-detects Node.js
6. Deploy! (Free tier with $5 credit/month)

---

## Option 3: Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Sign up: `fly auth signup`
3. In project directory:
   ```bash
   fly launch
   ```
4. Follow prompts
5. Deploy: `fly deploy`

---

## Option 4: Vercel (May have limitations)

1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel`
3. Follow prompts
4. Note: May need adjustments for WebSocket support

---

## Environment Variables

If needed, set these in your platform's dashboard:

- `NODE_ENV=production`
- `PORT=8080` (usually auto-set by platform)

---

## After Deployment

1. Update the redirect logic in `public/index.html` to use your new domain
2. Or disable redirects entirely for production
3. Test the proxy functionality

---

## Troubleshooting

**Build fails?**
- Check Node.js version (needs v16+)
- Check build logs in platform dashboard

**App crashes?**
- Check logs for errors
- Verify PORT environment variable is set
- Check memory limits (free tiers have limits)

**WebSocket issues?**
- Some platforms require special WebSocket configuration
- Check platform documentation for WebSocket support
