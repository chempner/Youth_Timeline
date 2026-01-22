FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app files
COPY server.js ./
COPY public ./public

# Create data directory
RUN mkdir -p /data/calendars

# Environment variables (can be overridden)
ENV PORT=80
ENV DATA_DIR=/data
ENV ADMIN_USER=admin
ENV ADMIN_PASS=changeme

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/api/status || exit 1

CMD ["node", "server.js"]
