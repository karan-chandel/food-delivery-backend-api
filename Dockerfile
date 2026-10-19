# ── Stage 1: Dependencies Builder ──────────────────────────────
FROM node:20-alpine AS dependencies
WORKDIR /app

# Install build dependencies if needed
RUN apk add --no-cache libc6-compat

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Stage 2: Production Runner ─────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5050

# Install curl for container healthcheck
RUN apk add --no-cache curl

# Create and set permissions for non-root node user
RUN mkdir -p /app && chown -R node:node /app

# Copy production node_modules from builder
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

# Copy application source code
COPY --chown=node:node . .

# Run as non-root user for security hardening
USER node

EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5050/ || exit 1

CMD ["node", "server.js"]
