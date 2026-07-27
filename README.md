# YT-Audio 

Extract high-quality audio (MP3, M4A, FLAC, WAV, OGG) from YouTube videos, multi-link batches, and full playlists with real-time progress, audio trimming, and embedded album cover art.

---

##  Features

* **Multi-Format Export**: MP3, M4A (AAC), FLAC (Lossless), WAV, OGG.
* **Audio Bitrate Control**: 320 kbps (Studio), 256 kbps, 192 kbps (Standard), 128 kbps.
* **Embedded Cover Art**: Automatically embeds YouTube thumbnails as ID3 album art (visible in macOS Finder, QuickLook, Apple Music, and mobile players).
* **Audio Trimming**: Trim audio clips by specifying Start and End timestamps (`00:00:15` to `02:30`).
* **Volume Normalization**: Built-in `loudnorm` filter for consistent loudness.

---

##  macOS Setup (Start to End)

### 1. Install Prerequisites
Open **Terminal** and install Node.js, yt-dlp, and FFmpeg via Homebrew:
```bash
brew install node yt-dlp ffmpeg
```
*(If you don't have Homebrew installed, get it first from [brew.sh](https://brew.sh))*

### 2. Clone & Run
```bash
git clone https://github.com/royysoans/YT-Audio.git
cd YT-Audio

npm install

npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser!

---

##  Windows Setup (Start to End)

### 1. Install Prerequisites
Open **Command Prompt** (or **PowerShell**) as Administrator and run:
```cmd
winget install OpenJS.NodeJS
winget install Gyan.FFmpeg
winget install yt-dlp.yt-dlp
```
*(Close and reopen your Command Prompt window after installation to update your PATH environment)*

### 2. Clone & Run
```cmd
# Clone repository
git clone https://github.com/royysoans/YT-Audio.git
cd YT-Audio

# Install dependencies
npm install

# Start server
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser!

---

##  Project Structure

```text
YT-Audio/
├── server.js          # Express server with yt-dlp stream & ffmpeg pipeline
├── package.json       # Project dependencies
├── public/
│   ├── index.html     # Zine HTML layout & controls
│   ├── style.css      # Neo-Brutalist Zine CSS theme
│   └── script.js      # Client-side queue & SSE progress listener
└── README.md          # Documentation
```

---


