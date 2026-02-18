# Replit npm Not Found - Quick Fix

If you're getting `exec: "npm": executable file not found in $PATH`, try these solutions:

## Solution 1: Use Node Directly (Quick Fix)

Change the run command in `.replit` to use `node` directly:

```toml
[run]
command = "node src/server.js"
```

Or if you need to install dependencies first:

```toml
[run]
command = "npm install && node src/server.js"
```

## Solution 2: Remove replit.nix (Let Replit Auto-Detect)

1. Delete or rename `replit.nix`
2. Replit will auto-detect Node.js from `package.json`
3. npm will be available automatically

## Solution 3: Manual Install in Shell

1. Open the Replit Shell (not the console)
2. Run:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 18
   nvm use 18
   ```
3. Then run `npm install` and `npm start`

## Solution 4: Use Replit's Node.js Template

1. Create a new Repl using "Node.js" template
2. Copy your files into it
3. Replit will have npm pre-installed

## Recommended: Use Solution 1

The simplest fix is to change the run command to use `node` directly instead of `npm start`. This bypasses the npm PATH issue.

Update `.replit`:
```toml
language = "nodejs"

[run]
command = "npm install && node src/server.js"

[env]
NODE_ENV = "production"
PORT = "8080"
```

This will:
1. Install dependencies with npm (which Replit provides)
2. Run the server directly with node (which is always available)
