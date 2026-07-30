const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const app = express();

// Set up cookies file for yt-dlp if provided via environment variable (useful for cloud deployments like Render)
let cookiesPath = "";
if (process.env.YT_COOKIES) {
    try {
        const tempCookiesPath = path.join(os.tmpdir(), "cookies.txt");
        let cookiesContent = process.env.YT_COOKIES;
        
        // Render or copy-paste sometimes converts tabs to spaces, which breaks Netscape format.
        // Convert any space-separated lines that have at least 7 fields back to tab-separated.
        const lines = cookiesContent.split(/\r?\n/);
        const sanitizedLines = lines.map(line => {
            if (line.startsWith("#") || !line.trim()) return line;
            const parts = line.split(/\s+/);
            if (parts.length >= 7) {
                const firstSix = parts.slice(0, 6);
                const rest = parts.slice(6).join(" ");
                return [...firstSix, rest].join("\t");
            }
            return line;
        });

        fs.writeFileSync(tempCookiesPath, sanitizedLines.join("\n"));
        cookiesPath = tempCookiesPath;
        console.log("Cookies file written and sanitized successfully at:", cookiesPath);
    } catch (e) {
        console.error("Failed to write cookies file:", e);
    }
}


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

function sanitizeFilename(name) {
    return name
        .replace(/[\/\\?%*:|"<>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function extractVideoId(url) {
    const match = url.match(/(?:v=|\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

const clients = new Map();

app.get("/api/progress", (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    if (clients.has(clientId)) {
        try { clients.get(clientId).end(); } catch (e) {}
    }
    clients.set(clientId, res);

    req.on("close", () => {
        clients.delete(clientId);
    });
});

function sendProgress(clientId, progress) {
    const clientRes = clients.get(String(clientId));
    if (clientRes && !clientRes.writableEnded) {
        clientRes.write(`data: ${JSON.stringify({ progress })}\n\n`);
    }
}

function fetchSingleUrlInfo(targetUrl) {
    return new Promise((resolve) => {
        const args = [
            "--flat-playlist",
            "--dump-single-json",
            "--ignore-no-formats-error",
            "--js-runtimes", "node"
        ];
        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }
        args.push(targetUrl);

        const infoProcess = spawn("yt-dlp", args, { windowsHide: true });

        let output = "";
        infoProcess.stdout.on("data", (data) => { output += data.toString(); });
        infoProcess.stderr.on("data", (data) => { console.error("yt-info-err:", data.toString()); });

        infoProcess.on("close", (code) => {
            if (code !== 0) return resolve([]);
            try {
                const data = JSON.parse(output);
                let videos = [];
                if (data._type === "playlist" && data.entries) {
                    videos = data.entries.map(entry => ({
                        title: entry.title || "Unknown Title",
                        thumbnail: `https://img.youtube.com/vi/${entry.id}/hqdefault.jpg`,
                        uploader: entry.uploader || entry.channel || data.uploader || data.channel || "Unknown Artist",
                        id: entry.id,
                        url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`
                    }));
                } else {
                    videos = [{
                        title: data.title || "Unknown Title",
                        thumbnail: `https://img.youtube.com/vi/${data.id}/hqdefault.jpg`,
                        uploader: data.uploader || data.channel || "Unknown Artist",
                        id: data.id,
                        url: data.webpage_url || targetUrl
                    }];
                }
                resolve(videos);
            } catch (e) {
                resolve([]);
            }
        });
    });
}

app.post("/api/info", async (req, res) => {
    const input = req.body.url || req.body.urls;
    if (!input) return res.status(400).json({ error: "No URL provided" });

    let urlList = [];
    if (Array.isArray(input)) {
        urlList = input;
    } else {
        const regex = /https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/[^\s,]+/gi;
        const matches = String(input).match(regex);
        urlList = matches ? Array.from(new Set(matches)) : [input.trim()];
    }

    if (urlList.length === 0) {
        return res.status(400).json({ error: "No valid YouTube URLs found" });
    }

    const results = await Promise.all(urlList.map(url => fetchSingleUrlInfo(url)));
    const allVideos = results.flat();

    if (allVideos.length === 0) {
        return res.status(500).json({ error: "Failed to fetch metadata. Please check your URLs." });
    }

    res.json({ videos: allVideos });
});

async function downloadThumbnail(urlsToTry, dest) {
    for (const imageUrl of urlsToTry) {
        if (!imageUrl) continue;
        try {
            const response = await fetch(imageUrl);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                fs.writeFileSync(dest, Buffer.from(arrayBuffer));
                return true;
            }
        } catch (e) {}
    }
    return false;
}

app.get("/download", async (req, res) => {
    let { url, title, artist, clientId, format = "mp3", quality = "192k", startTime, endTime, normalize, thumbnail } = req.query;
    if (!url) return res.status(400).send("No URL provided");

    const safeTitle = sanitizeFilename(title || "audio");
    const encodedFilename = encodeURIComponent(`${safeTitle}.${format}`)
        .replace(/['()]/g, escape)
        .replace(/\*/g, "%2A");

    let mimeType = "audio/mpeg";
    if (format === "m4a") mimeType = "audio/mp4";
    if (format === "flac") mimeType = "audio/flac";
    if (format === "wav") mimeType = "audio/wav";
    if (format === "ogg") mimeType = "audio/ogg";

    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle.replace(/[^\x20-\x7E]/g, '') || 'audio'}.${format}"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader("Content-Type", mimeType);

    // Cross-platform temporary directory (os.tmpdir() works on Windows & macOS)
    let thumbPath = "";
    let hasThumbnail = false;
    if (format === "mp3" || format === "m4a") {
        const videoId = extractVideoId(url);
        const candidates = [
            thumbnail,
            videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null,
            videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null,
            videoId ? `https://img.youtube.com/vi/${videoId}/0.jpg` : null
        ];

        thumbPath = path.join(os.tmpdir(), `thumb_${clientId || Date.now()}_${Date.now()}.jpg`);
        hasThumbnail = await downloadThumbnail(candidates, thumbPath);
    }

    const ytArgs = [
        "-f", "bestaudio/best",
        "--no-playlist",
        "--force-overwrites",
        "--no-mtime",
        "-N", "4",
        "--js-runtimes", "node",
        "-o", "-"
    ];
    if (cookiesPath) {
        ytArgs.push("--cookies", cookiesPath);
    }
    ytArgs.push(url);

    const yt = spawn("yt-dlp", ytArgs, { windowsHide: true });

    let ffmpegArgs = ["-i", "pipe:0"];

    if (hasThumbnail) {
        ffmpegArgs.push("-i", thumbPath);
        ffmpegArgs.push("-map", "0:a");
        ffmpegArgs.push("-map", "1:v");
    }

    if (startTime) {
        ffmpegArgs.push("-ss", startTime);
    }
    if (endTime) {
        ffmpegArgs.push("-to", endTime);
    }

    // Audio Filters
    let audioFilters = [];
    if (normalize === "true") {
        audioFilters.push("loudnorm");
    }
    if (audioFilters.length > 0) {
        ffmpegArgs.push("-af", audioFilters.join(","));
    }

    // Codec, Quality & Cover Art ID3 Tagging
    if (format === "mp3") {
        ffmpegArgs.push("-c:a", "libmp3lame", "-b:a", quality);
        if (hasThumbnail) {
            ffmpegArgs.push(
                "-c:v", "copy",
                "-id3v2_version", "3",
                "-metadata:s:v", "title=Album cover",
                "-metadata:s:v", "comment=Cover (front)"
            );
        }
    } else if (format === "m4a") {
        ffmpegArgs.push("-c:a", "aac", "-b:a", quality);
        if (hasThumbnail) {
            ffmpegArgs.push("-c:v", "copy", "-disposition:v", "attached_pic");
        }
    } else if (format === "flac") {
        ffmpegArgs.push("-c:a", "flac");
    } else if (format === "wav") {
        ffmpegArgs.push("-c:a", "pcm_s16le");
    } else if (format === "ogg") {
        ffmpegArgs.push("-c:a", "libvorbis", "-q:a", "5");
    }

    ffmpegArgs.push("-metadata", `title=${title || ""}`);
    ffmpegArgs.push("-metadata", `artist=${artist || ""}`);
    ffmpegArgs.push("-f", format === "m4a" ? "mp4" : format);
    if (format === "m4a") {
        ffmpegArgs.push("-movflags", "frag_keyframe+empty_moov");
    }
    ffmpegArgs.push("pipe:1");

    const ff = spawn("ffmpeg", ffmpegArgs, { windowsHide: true });

    yt.stdout.pipe(ff.stdin);
    ff.stdout.pipe(res);

    yt.stdout.on("error", (err) => { if (err.code !== "EPIPE") console.error("yt stdout error:", err); });
    ff.stdin.on("error", (err) => { if (err.code !== "EPIPE") console.error("ff stdin error:", err); });
    ff.stdout.on("error", (err) => { if (err.code !== "EPIPE") console.error("ff stdout error:", err); });

    yt.stderr.on("data", (data) => {
        const line = data.toString();
        const match = line.match(/\[download\]\s+(\d+\.\d+)%/);
        if (match && clientId) {
            sendProgress(clientId, match[1]);
        }
    });

    let finished = false;
    const cleanup = () => {
        if (finished) return;
        finished = true;
        try { yt.kill("SIGTERM"); } catch (e) {}
        try { ff.kill("SIGTERM"); } catch (e) {}
        if (hasThumbnail && fs.existsSync(thumbPath)) {
            try { fs.unlinkSync(thumbPath); } catch (e) {}
        }
    };

    res.on("close", cleanup);
    res.on("finish", cleanup);

    yt.on("close", () => {
        try { ff.stdin.end(); } catch (e) {}
    });

    ff.on("close", () => {
        if (clientId) {
            sendProgress(clientId, 100);
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
