FROM node:20-alpine

# Install ffmpeg and ffprobe
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production)
RUN npm install --omit=dev

# Copy application source
COPY . .

# Expose server port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Start dragon eyes sync server
CMD ["node", "server.js"]
