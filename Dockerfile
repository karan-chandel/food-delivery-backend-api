# -------------------------------------------------------------
# Production Dockerfile for FoodBE (Hungry-Hub Backend API)
# Node.js 20 on lightweight Alpine Linux
# -------------------------------------------------------------

FROM node:20-alpine AS dependencies

WORKDIR /usr/src/app

# Copy package descriptors
COPY package*.json ./

# Install only production dependencies for smaller image and faster startup
RUN npm ci --omit=dev

# -------------------------------------------------------------
# Runner stage
# -------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=5050

# Copy node_modules from dependencies stage
COPY --from=dependencies /usr/src/app/node_modules ./node_modules

# Copy application source code
COPY . .

# Create uploads directories if needed by multer fallback
RUN mkdir -p uploads/menu-items uploads/riders uploads/admin

# Expose backend port
EXPOSE 5050

# Healthcheck for Azure / Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/ || exit 1

# Start production server
CMD ["node", "server.js"]
