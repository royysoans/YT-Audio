FROM node:18-slim

# Install system dependencies (ffmpeg, python3, pip)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with full solver dependencies (bgutil-ytdlp-pot-provider is a pip package)
RUN pip3 install --no-cache-dir -U --break-system-packages \
    "yt-dlp[default]" \
    yt-dlp-ejs \
    yt-dlp-get-pot \
    bgutil-ytdlp-pot-provider \
    || pip3 install --no-cache-dir -U \
    "yt-dlp[default]" \
    yt-dlp-ejs \
    yt-dlp-get-pot \
    bgutil-ytdlp-pot-provider

# Verify Node.js is in PATH for yt-dlp JS runtime solver
RUN node --version && which node

# Create app directory
WORKDIR /app

# Copy package files and install app dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Create yt-dlp config pointing to the bgutil POT provider
RUN mkdir -p /root/.config/yt-dlp && \
    echo '--extractor-args "youtube:getpot_bgutil_baseurl=http://127.0.0.1:4416"' > /root/.config/yt-dlp/config

# Expose port
ENV PORT=7860
EXPOSE 7860

# Use startup script to launch bgutil provider first, then the app server
COPY start.sh /start.sh
RUN chmod +x /start.sh
CMD ["/start.sh"]
