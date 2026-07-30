FROM node:18-slim

# Install system dependencies (ffmpeg, python3, pip, curl)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp with default extra dependencies (JS runtime solvers, mutagen, pycryptodomex)
RUN pip3 install --no-cache-dir -U --break-system-packages "yt-dlp[default]" || pip3 install --no-cache-dir -U "yt-dlp[default]"

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Set environment variables (Hugging Face Spaces runs on port 7860 by default)
ENV PORT=7860
EXPOSE 7860

# Start server
CMD ["node", "server.js"]
