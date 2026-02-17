# Deploy Rammerhead on Replit

Replit is a cloud IDE that can host your Rammerhead proxy. This guide will help you deploy it.

## Quick Start

1. **Create a Replit Account**
   - Go to [replit.com](https://replit.com) and sign up

2. **Import Your Project**
   - Click "Create Repl"
   - Choose "Import from GitHub"
   - Enter your repository URL: `https://github.com/your-username/rammerhead`
   - Or click "Upload folder" and drag your project folder

3. **Replit Will Auto-Configure**
   - The `.replit` file is already configured
   - Replit will automatically detect Node.js and install dependencies

4. **Start the Server**
   - Click the green "Run" button
   - Or use the command: `npm start`
   - The server will start on the port Replit assigns (usually shown in the console)

5. **Access Your Proxy**
   - Replit will show a URL like: `https://your-app-name.your-username.repl.co`
   - Click the webview button or open the URL in a new tab
   - Your proxy is now live and accessible from anywhere!

## Configuration

### Environment Variables (Optional)

If you need to customize settings, add environment variables in Replit:

1. Click the "Secrets" tab (lock icon) in the sidebar
2. Add variables like:
   - `PORT` - Server port (Replit usually sets this automatically)
   - `DEVELOPMENT` - Set to `true` for debug logging

### Custom Domain (Replit Pro)

If you have Replit Pro, you can:
1. Go to your Repl settings
2. Add a custom domain
3. Update the redirect logic in `public/index.html` if needed

## Features

✅ **Always On** - Replit keeps your app running (on paid plans)
✅ **HTTPS** - Automatic SSL certificate
✅ **Public URL** - Accessible from anywhere
✅ **Auto-Deploy** - Updates when you push to GitHub
✅ **Free Tier Available** - Basic hosting is free

## Important Notes

### Free Tier Limitations

- **Sleeps after inactivity** - Free Repls sleep after ~5 minutes of inactivity
- **Cold starts** - First request after sleep takes 10-30 seconds
- **Resource limits** - Limited CPU and memory

### Upgrading to Replit Pro

For production use, consider Replit Pro:
- Always-on hosting (no sleep)
- More resources
- Custom domains
- Better performance

## Troubleshooting

### Server Not Starting

1. **Check the console** for error messages
2. **Verify Node.js version** - Replit should use Node.js 18+ (configured in `replit.nix`)
3. **Check dependencies** - Run `npm install` manually if needed

### Port Issues

- Replit automatically assigns a port
- The server uses `process.env.PORT` which Replit sets automatically
- Don't hardcode port numbers

### Redirect Issues

- The redirect logic in `public/index.html` already includes `.repl.co` and `.replit.dev` domains
- If you use a custom domain, add it to the `isTunnelUrl` check

### App Goes to Sleep

- **Free tier**: App sleeps after inactivity
- **Solution**: Upgrade to Replit Pro or use a keep-alive service
- **Workaround**: Set up a cron job or external ping service to keep it awake

## Keep-Alive Service (Free Tier)

To prevent your free Repl from sleeping, you can:

1. **Use UptimeRobot** (free):
   - Sign up at [uptimerobot.com](https://uptimerobot.com)
   - Add a monitor for your Replit URL
   - Set it to ping every 5 minutes

2. **Use a Keep-Alive Script**:
   ```javascript
   // Add to your server code or run separately
   setInterval(() => {
       fetch('https://your-app.repl.co/')
           .catch(() => {});
   }, 4 * 60 * 1000); // Every 4 minutes
   ```

## Deployment Checklist

- [ ] Project imported to Replit
- [ ] Dependencies installed (`npm install`)
- [ ] Server starts without errors
- [ ] Can access the web interface
- [ ] Proxy functionality works
- [ ] (Optional) Set up keep-alive for free tier
- [ ] (Optional) Configure custom domain

## Next Steps

Once deployed:

1. **Share your URL** - Anyone can access your proxy
2. **Bookmark it** - Save the Replit URL for easy access
3. **Monitor usage** - Check Replit dashboard for resource usage
4. **Update code** - Push to GitHub and Replit will auto-update (if connected)

## Support

- **Replit Docs**: [docs.replit.com](https://docs.replit.com)
- **Replit Community**: [ask.replit.com](https://ask.replit.com)
- **Rammerhead Issues**: Check the main README for troubleshooting

---

**Your proxy is now live on Replit! 🚀**
