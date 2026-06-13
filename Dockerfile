# syntax=docker/dockerfile:1

# --- STAGE 1: Build React frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# --- STAGE 2: Install production backend dependencies ---
FROM node:20-alpine AS backend-deps
WORKDIR /app/backend

RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# --- STAGE 3: Runtime ---
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache python3 ffmpeg curl \
    && apk add --no-cache --virtual .pip-deps py3-pip \
    && python3 -m venv /opt/media-tools \
    && /opt/media-tools/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/media-tools/bin/pip install --no-cache-dir yt-dlp gallery-dl curl_cffi \
    && apk del .pip-deps

ENV PATH="/opt/media-tools/bin:${PATH}" \
    PORT=8080 \
    DATA_DIR=/app/data \
    DOWNLOADS_DIR=/app/downloads \
    NODE_ENV=production

COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data /app/downloads

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/status" > /dev/null || exit 1

CMD ["node", "backend/index.js"]
