FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with solver support (yt-dlp-ejs handles JS challenges)
RUN pip3 install --no-cache-dir -U --break-system-packages \
    "yt-dlp[default]" yt-dlp-ejs

# Create app directory
WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy app files
COPY . .

ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
