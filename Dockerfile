FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps || npm install --omit=dev --force

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--max-old-space-size=768", "src/server.js"]
