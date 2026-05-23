# --- STAGE 1: Build React Frontend ---
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

# Copy dependencies and install
COPY frontend/package.json ./
RUN npm install

# Copy source and build
COPY frontend/ ./
RUN npm run build

# --- STAGE 2: Build Node Backend & Install Media Tools ---
FROM node:20-slim
WORKDIR /app

# Install system dependencies: python3, pip, and ffmpeg
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install/Update yt-dlp and gallery-dl from pip
# --break-system-packages is required for Debian Bookworm PEP 668 compatibility
RUN python3 -m pip install --break-system-packages -U yt-dlp gallery-dl

# Copy backend dependencies and install
COPY backend/package.json ./backend/
RUN cd backend && npm install

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend dist from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Setup default directories for mounts
RUN mkdir -p /app/data /app/downloads

# Environment variables
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV DOWNLOADS_DIR=/app/downloads
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "backend/index.js"]
