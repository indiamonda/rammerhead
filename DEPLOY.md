# Cloud Deployment Guide

Deploy Unlinewize to cloud platforms for permanent, always-on access from anywhere.

## 🌟 Why Deploy to Cloud?

- ✅ **Always Available**: No need to keep your computer running
- ✅ **Permanent URL**: URL doesn't change like tunnels
- ✅ **Better Performance**: Cloud infrastructure is faster
- ✅ **Free Tiers Available**: Many platforms offer free hosting

## 🚀 Platform Options

### Option 1: Render (Recommended - Free Tier, No Time Limit)

**Best for:** Free hosting, beginners, permanent deployment

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
   - Select the unlinewize repository
   - Render auto-detects settings from `render.yaml`:
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm start`
     - **Environment**: Node
   - Click "Create Web Service"
   - Wait 5-10 minutes for deployment

3. **Access your proxy**:
   - Render provides: `https://unlinewize-proxy.onrender.com`
   - Use this URL from anywhere!

**Pros:**
- ✅ **Free forever** (no time limit)
- ✅ Automatic HTTPS
- ✅ Auto-deploys from GitHub
- ✅ Easy setup
- ✅ No credit card required

**Cons:**
- ⚠️ Spins down after 15 minutes of inactivity
- ⚠️ First request after spin-down takes ~30 seconds
- ⚠️ Upgrade to paid ($7/month) for always-on service

---

### Option 2: Fly.io (Global Edge - Free Tier)

**Best for:** Always-on free tier, global edge, WebSocket support

**Steps:**

1. **Install Fly CLI**:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```
   Or on Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`

2. **Sign up / log in**:
   ```bash
   fly auth signup
   ```
   Or `fly auth login` if you already have an account.

3. **Deploy from project directory**:
   ```bash
   cd /path/to/rammerhead
   fly launch
   ```
   - Choose an app name (e.g. `unlinewize-proxy`) or leave blank for auto-generated
   - Select a region
   - Do **not** add a Postgres or Redis database when prompted
   - Fly will use the included `Dockerfile` and `fly.toml`

4. **Deploy updates later**:
   ```bash
   fly deploy
   ```

5. **Access your proxy**:
   - Your app will be at `https://rammerhead.fly.dev`

**Pros:**
- ✅ Free tier with always-on option (generous limits)
- ✅ Global edge network
- ✅ WebSockets supported
- ✅ Automatic HTTPS (`*.fly.dev`)

**Cons:**
- ⚠️ Requires CLI and Docker (or use GitHub + Fly’s GitHub integration)
- ⚠️ Free tier has resource limits

**Fly.io and multiple machines:** Proxy sessions are stored per-instance (in-memory/file). The default `fly.toml` uses `min_machines_running = 1` so all requests hit the same instance and sessions work. If you scale to multiple machines, requests for the same session can land on different instances and you'll see 404s or `/api/shuffleDict` errors. To scale out, you would need a shared session store (e.g. Redis) and [Fly Replay](https://fly.io/docs/blueprints/sticky-sessions/) so requests for a session are replayed to the instance that owns it.

---

### Option 3: Replit (Easiest Setup - 30-Day Free Trial)

**Best for:** Quick testing, learning (not for long-term hosting)

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
- ✅ Automatic HTTPS
- ✅ Built-in code editor
- ✅ No configuration needed (`.replit` file included)

**Cons:**
- ⚠️ **30-day hosting limit on free tier** (requires payment after)
- ⚠️ Free tier sleeps after inactivity (~5 min)
- ⚠️ Cold starts can be slow
- ⚠️ Limited resources on free tier

**See detailed guide:** [REPLIT_DEPLOY.md](./REPLIT_DEPLOY.md)

**⚠️ Note:** Not recommended for permanent hosting due to 30-day limit.

---

### Option 5: Vercel

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
- ✅ All deployment files included (`render.yaml`, `Procfile`, `fly.toml`, `Dockerfile`)

## 🔧 After Deployment

### 1. Update Redirect Logic (Optional)

The proxy automatically detects deployed domains (`.onrender.com`, `.fly.dev`, etc.) and won't redirect. No changes needed!

### 2. Test the Proxy

1. Open your deployed URL
2. Try navigating to a website
3. Test session management
4. Verify tabs work correctly

### 3. Custom Domain (Optional)

Most platforms allow custom domains:
- **Render**: Settings → Custom Domains
- **Fly.io**: `fly certs add yourdomain.com` then add DNS CNAME

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
- **Fly.io**: WebSockets supported (use included `fly.toml`)
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
| Fly.io   | ✅ | ✅ | ✅ | ⭐⭐⭐⭐ |
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

**Recommendation:** Start with **Render** for easiest deployment (no CLI), or **Fly.io** for always-on free tier and global edge.
