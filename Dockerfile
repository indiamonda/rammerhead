FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--max-old-space-size=768", "src/server.js"]
