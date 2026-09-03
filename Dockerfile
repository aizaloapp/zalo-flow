# Use lightweight official Node.js Alpine base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install security updates & essentials
RUN apk update && apk add --no-cache tzdata

# Set timezone
ENV TZ=Asia/Ho_Chi_Minh

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Create sessions & data directories and assign permissions to non-root user
RUN mkdir -p /app/sessions /app/data && chown -R node:node /app

# Switch to non-root user
USER node

# Expose Web & Webhook port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application with V8 heap cap
CMD ["node", "--max-old-space-size=128", "src/index.js"]
