# Stage 1: Build dependencies and generate Prisma Client
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# Stage 2: Install production runtime dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 3: Runtime image
FROM node:22-alpine AS runner
WORKDIR /app

# Install postgresql-client for dbBackup / dbRestore utilities
RUN apk add --no-cache postgresql-client

# Set environment defaults
ENV NODE_ENV=production
ENV SERVER_PORT=5000
ENV PORT=5000

# Copy runtime dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy application source
COPY . .

# Set up backup folder and grant permissions
RUN mkdir -p /app/backups && chown -R node:node /app

# Run as non-root user
USER node

# Expose server port
EXPOSE 5000

# Healthcheck targeting the native /health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
