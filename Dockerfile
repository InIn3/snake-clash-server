FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production=false
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production image ──────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache wget dumb-init
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 10000

# Use dumb-init for proper signal forwarding
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
