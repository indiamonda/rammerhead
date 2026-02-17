# Cloud Deployment Guide

Deploy Rammerhead to cloud platforms for permanent, always-on access from anywhere.

## 🌟 Why Deploy to Cloud?

- ✅ **Always Available**: No need to keep your computer running
- ✅ **Permanent URL**: URL doesn't change like tunnels
- ✅ **Better Performance**: Cloud infrastructure is faster
- ✅ **Free Tiers Available**: Many platforms offer free hosting

## 🚀 Platform Options

### Option 1: Replit (Easiest - Free Tier)

**Best for:** Quick deployment, beginners, learning

**Steps:**

1. **Create Replit Account**:
   - Go to [replit.com](https://replit.com) and sign up

2. **Import Project**:
   - Click "Create Repl" → "Import from GitHub"
   - Enter your repository URL
   - Or upload your project folder

3. **Run**:
   - Click the green "Run" button
   - Replit will automatically install dependencies and start the server

4. **Access**:
   - Use the URL Replit provides (e.g., `https://your-app.repl.co`)
   - Your proxy is now live!

**Pros:**
- ✅ Easiest setup (just click Run)
- ✅ Free tier available
- ✅ Automatic HTTPS
- ✅ Built-in code editor
- ✅ No configuration needed (`.replit` file included)

**Cons:**
- ⚠️ Free tier sleeps after inactivity (~5 min)
- ⚠️ Cold starts can be slow
- ⚠️ Limited resources on free tier

**See detailed guide:** [REPLIT_DEPLOY.md](./REPLIT_DEPLOY.md)

---

### Option 2: Render (Recommended - Free Tier)

**Best for:** Beginners, free hosting

**Steps:**

1. **Push to GitHub**:
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
   - Render auto-detects settings from `render.yaml`:
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm start`
     - **Environment**: Node
   - Click "Create Web Service"
   - Wait 5-10 minutes for deployment

3. **Access your proxy**:
   - Render provides: `https://rammerhead-proxy.onrender.com`
   - Use this URL from anywhere!

**Notes:**
- Free tier spins down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- Upgrade to paid ($7/month) for always-on service

---

### Option 2: Railway

**Best for:** Quick deployment, $5 free credit/month

**Steps:**

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway auto-detects Node.js
6. Deploy! (takes 2-5 minutes)

**Notes:**
- $5 free credit per month
- Pay-as-you-go after credit
- Very fast deployment

---

### Option 3: Fly.io

**Best for:** Global edge deployment, Docker support

**Steps:**

1. Install Fly CLI:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. Sign up:
   ```bash
   fly auth signup
   ```

3. Deploy:
   ```bash
   cd /path/to/rammerhead
   fly launch
   ```
   Follow the prompts.

4. Deploy updates:
   ```bash
   fly deploy
   ```

**Notes:**
- Free tier available
- Global edge network
- Good for international users

---

### Option 4: Vercel

**Best for:** Frontend-focused, may have WebSocket limitations

**Steps:**

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```
   Follow prompts.

**Notes:**
- May need adjustments for WebSocket support
- Better for static sites
- Free tier available

---

### Option 5: Heroku

**Best for:** Traditional PaaS (now requires paid plan)

**Steps:**

1. Install Heroku CLI
2. Login: `heroku login`
3. Create app: `heroku create`
4. Deploy: `git push heroku main`

**Notes:**
- No longer has free tier
- $5-7/month minimum
- Very reliable

---

## ⚙️ Environment Variables

Set these in your platform's dashboard if needed:

- `NODE_ENV=production`
- `PORT=8080` (usually auto-set by platform)

## 📝 Configuration for Cloud

The project is already configured for cloud deployment:

- ✅ Uses `process.env.PORT` automatically
- ✅ `crossDomainPort` uses same port (cloud requirement)
- ✅ Redirect logic supports deployed domains
- ✅ All deployment files included (`render.yaml`, `Procfile`)

## 🔧 After Deployment

### 1. Update Redirect Logic (Optional)

The proxy automatically detects deployed domains (`.onrender.com`, `.railway.app`, etc.) and won't redirect. No changes needed!

### 2. Test the Proxy

1. Open your deployed URL
2. Try navigating to a website
3. Test session management
4. Verify tabs work correctly

### 3. Custom Domain (Optional)

Most platforms allow custom domains:
- **Render**: Settings → Custom Domains
- **Railway**: Settings → Domains
- **Fly.io**: `fly domains add yourdomain.com`

## 🐛 Troubleshooting

### Build Fails

**Check:**
- Node.js version (needs v16+) - specified in `.nvmrc`
- Build logs in platform dashboard
- Dependencies install correctly

**Fix:**
```bash
# Test build locally first
npm install
npm run build
```

### App Crashes

**Check:**
- Logs in platform dashboard
- Memory limits (free tiers have limits)
- PORT environment variable is set

**Common Issues:**
- Out of memory → Upgrade plan or optimize
- Port not set → Platform should auto-set
- Missing dependencies → Check `package.json`

### WebSocket Issues

**Some platforms require special configuration:**

- **Render**: WebSockets supported automatically
- **Railway**: WebSockets supported automatically
- **Fly.io**: May need `fly.toml` configuration
- **Vercel**: Limited WebSocket support

### Slow Performance

**Free tiers have limitations:**
- Shared resources
- Cold starts after inactivity
- Consider upgrading to paid tier

## 📊 Platform Comparison

| Platform | Free Tier | Always-On | WebSocket | Ease of Use |
|----------|-----------|-----------|-----------|-------------|
| Render   | ✅ (spins down) | ❌ | ✅ | ⭐⭐⭐⭐⭐ |
| Railway  | ✅ ($5 credit) | ✅ | ✅ | ⭐⭐⭐⭐ |
| Fly.io   | ✅ | ✅ | ✅ | ⭐⭐⭐ |
| Vercel   | ✅ | ✅ | ⚠️ | ⭐⭐⭐⭐ |
| Heroku   | ❌ | ✅ | ✅ | ⭐⭐⭐⭐ |

## 🔄 Updating Deployment

After making changes:

```bash
git add .
git commit -m "Update proxy"
git push
```

Most platforms auto-deploy on push to main branch.

## 📚 Related Documentation

- [README.md](README.md) - Full documentation
- [QUICK_START.md](QUICK_START.md) - Local setup
- [TUNNEL_SETUP.md](TUNNEL_SETUP.md) - Alternative to cloud deployment

---

**Recommendation:** Start with **Render** for easiest deployment, or **Railway** for always-on free tier.
