const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ── Cookie Setup ──────────────────────────────────────────────────────────────
// Write YT_COOKIES env var to a temp file on startup (for cloud deployments).
// Render/browser copy-paste often converts cookie file tabs to spaces; we fix that.
let cookiesPath = "";
if (process.env.YT_COOKIES) {
    try {
        const tempCookiesPath = path.join(os.tmpdir(), "yt_cookies.txt");
        const rawLines = process.env.YT_COOKIES.split(/\r?\n/);
        const fixed = rawLines.map(line => {
            if (line.startsWith("#") || !line.trim()) return line;
            const parts = line.split(/\s+/);
            if (parts.length >= 7) {
                return [...parts.slice(0, 6), parts.slice(6).join(" ")].join("\t");
            }
            return line;
        });
        fs.writeFileSync(tempCookiesPath, fixed.join("\n"));
        cookiesPath = tempCookiesPath;
        console.log("Cookies written to:", cookiesPath);
    } catch (e) {
        console.error("Failed to write cookies file:", e);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitizeFilename(name) {
    return name.replace(/[\/\\?%*:|"<>]/g, "").replace(/\s+/g, " ").trim();
}

function extractVideoId(url) {
    const m = url.match(/(?:v=|\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

function buildYtdlpArgs(url) {
    const args = [
        "-f", "bestaudio/best",
        "--no-playlist",
        "--force-overwrites",
        "--no-mtime",
        "--sleep-requests", "1",
        "--retries", "5",
        "--fragment-retries", "5",
        "-o", "-",
    ];
    if (cookiesPath) args.push("--cookies", cookiesPath);
    args.push(url);
    return args;
}

// ── SSE Progress ──────────────────────────────────────────────────────────────
const clients = new Map();

app.get("/api/progress", (req, res) => {
    const { clientId } = req.query;
    if (!clientId) return res.end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    if (clients.has(clientId)) {
        try { clients.get(clientId).end(); } catch (_) {}
    }
    clients.set(clientId, res);
    req.on("close", () => clients.delete(clientId));
});

function sendProgress(clientId, progress) {
    const r = clients.get(String(clientId));
    if (r && !r.writableEnded) r.write(`data: ${JSON.stringify({ progress })}\n\n`);
}

// ── Info Fetch ────────────────────────────────────────────────────────────────
function fetchSingleUrlInfo(targetUrl) {
    return new Promise(resolve => {
        const args = [
            "--flat-playlist",
            "--dump-single-json",
            "--ignore-no-formats-error",
        ];
        if (cookiesPath) args.push("--cookies", cookiesPath);
        args.push(targetUrl);

        const proc = spawn("yt-dlp", args, { windowsHide: true });
        let out = "";
        proc.stdout.on("data", d => { out += d.toString(); });
        proc.stderr.on("data", d => { console.error("yt-info:", d.toString().trim()); });
        proc.on("close", code => {
            if (code !== 0) return resolve([]);
            try {
                const data = JSON.parse(out);
                if (data._type === "playlist" && data.entries) {
                    return resolve(data.entries.map(e => ({
                        title: e.title || "Unknown Title",
                        thumbnail: `https://img.youtube.com/vi/${e.id}/hqdefault.jpg`,
                        uploader: e.uploader || e.channel || data.uploader || data.channel || "Unknown Artist",
                        id: e.id,
                        url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
                    })));
                }
                resolve([{
                    title: data.title || "Unknown Title",
                    thumbnail: `https://img.youtube.com/vi/${data.id}/hqdefault.jpg`,
                    uploader: data.uploader || data.channel || "Unknown Artist",
                    id: data.id,
                    url: data.webpage_url || targetUrl,
                }]);
            } catch (_) { resolve([]); }
        });
    });
}

app.post("/api/info", async (req, res) => {
    const input = req.body.url || req.body.urls;
    if (!input) return res.status(400).json({ error: "No URL provided" });

    let urlList = Array.isArray(input) ? input : (() => {
        const regex = /https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/[^\s,]+/gi;
        const matches = String(input).match(regex);
        return matches ? Array.from(new Set(matches)) : [String(input).trim()];
    })();

    if (!urlList.length) return res.status(400).json({ error: "No valid YouTube URLs found" });

    const allVideos = (await Promise.all(urlList.map(fetchSingleUrlInfo))).flat();
    if (!allVideos.length) return res.status(500).json({ error: "Failed to fetch video info. Check your URL." });
    res.json({ videos: allVideos });
});

// ── Download ──────────────────────────────────────────────────────────────────
app.get("/download", async (req, res) => {
    const { url, title, artist, clientId, format = "mp3", quality = "192k", startTime, endTime, normalize } = req.query;
    if (!url) return res.status(400).send("No URL provided");

    const safeTitle = sanitizeFilename(title || "audio");
    const encodedFilename = encodeURIComponent(`${safeTitle}.${format}`)
        .replace(/['()]/g, escape).replace(/\*/g, "%2A");

    const mimeTypes = { mp3: "audio/mpeg", m4a: "audio/mp4", flac: "audio/flac", wav: "audio/wav", ogg: "audio/ogg" };

    // Spawn yt-dlp first and buffer a small amount of data to confirm it's working
    // before committing to streaming headers. This prevents 0-byte files on failure.
    const yt = spawn("yt-dlp", buildYtdlpArgs(url), { windowsHide: true });

    let headersSent = false;
    let ytFailed = false;
    const ytBuffer = [];

    // Watch for yt-dlp errors before we commit to streaming
    yt.stderr.on("data", d => {
        const line = d.toString();
        console.error("yt-dlp:", line.trim());
        const m = line.match(/\[download\]\s+(\d+\.\d+)%/);
        if (m && clientId) sendProgress(clientId, m[1]);
    });

    yt.on("error", err => {
        console.error("yt-dlp spawn error:", err);
        ytFailed = true;
        if (!headersSent) res.status(500).send("Failed to start yt-dlp.");
    });

    // Buffer first chunk to verify yt-dlp actually has data
    yt.stdout.once("data", firstChunk => {
        if (res.headersSent || ytFailed) return;
        headersSent = true;

        // Build ffmpeg args now that we know yt-dlp is actually producing data
        const ffArgs = [];
        if (startTime) ffArgs.push("-ss", startTime);
        if (endTime) ffArgs.push("-to", endTime);
        ffArgs.push("-i", "pipe:0");

        if (normalize === "true") ffArgs.push("-af", "loudnorm");

        if (format === "mp3") ffArgs.push("-c:a", "libmp3lame", "-b:a", quality);
        else if (format === "m4a") ffArgs.push("-c:a", "aac", "-b:a", quality);
        else if (format === "flac") ffArgs.push("-c:a", "flac");
        else if (format === "wav") ffArgs.push("-c:a", "pcm_s16le");
        else if (format === "ogg") ffArgs.push("-c:a", "libvorbis", "-q:a", "5");

        if (title) ffArgs.push("-metadata", `title=${title}`);
        if (artist) ffArgs.push("-metadata", `artist=${artist}`);
        ffArgs.push("-f", format === "m4a" ? "mp4" : format);
        if (format === "m4a") ffArgs.push("-movflags", "frag_keyframe+empty_moov");
        ffArgs.push("pipe:1");

        const ff = spawn("ffmpeg", ffArgs, { windowsHide: true });

        ff.stderr.on("data", d => console.error("ffmpeg:", d.toString().trim()));
        ff.on("error", err => {
            console.error("ffmpeg spawn error:", err);
            if (!res.headersSent) res.status(500).send("Failed to start ffmpeg.");
        });

        // Now we know we have data – set response headers and start streaming
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle.replace(/[^\x20-\x7E]/g, "") || "audio"}.${format}"; filename*=UTF-8''${encodedFilename}`);
        res.setHeader("Content-Type", mimeTypes[format] || "audio/mpeg");

        // Write buffered first chunk, then pipe the rest
        ff.stdin.write(firstChunk);
        yt.stdout.pipe(ff.stdin);
        ff.stdout.pipe(res);

        yt.stdout.on("error", e => { if (e.code !== "EPIPE") console.error("yt stdout:", e); });
        ff.stdin.on("error", e => { if (e.code !== "EPIPE") console.error("ff stdin:", e); });
        ff.stdout.on("error", e => { if (e.code !== "EPIPE") console.error("ff stdout:", e); });

        let done = false;
        const cleanup = () => {
            if (done) return;
            done = true;
            try { yt.kill("SIGTERM"); } catch (_) {}
            try { ff.kill("SIGTERM"); } catch (_) {}
        };
        res.on("close", cleanup);
        res.on("finish", cleanup);

        yt.on("close", () => { try { ff.stdin.end(); } catch (_) {} });
        ff.on("close", () => { if (clientId) sendProgress(clientId, 100); });
    });

    // If yt-dlp exits without producing any data at all
    yt.on("close", code => {
        if (!headersSent) {
            console.error("yt-dlp exited with code", code, "and no data");
            if (!res.headersSent) res.status(500).send("Could not download this video. It may be restricted or unavailable.");
        }
    });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
