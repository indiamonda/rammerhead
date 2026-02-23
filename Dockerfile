# Dockerfile for Fly.io (and other container deployments)
# Node 18+ required (see package.json engines)
FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.js"]
