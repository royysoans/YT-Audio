const express = require("express");
const { spawn } = require("child_process");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

function sanitizeFilename(name) {
    return name
        .replace(/[\/\\?%*:|"<>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// O(1) Map for client SSE connections to avoid memory leaks & linear array searches
const clients = new Map();

app.get("/api/progress", (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Close old connection if same clientId re-connects
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

app.post("/api/info", (req, res) => {
    const url = req.body.url;
    if (!url) return res.status(400).json({ error: "No URL provided" });

    const infoProcess = spawn("yt-dlp", [
        "--no-playlist",
        "--dump-single-json",
        "--no-warnings",
        "--force-ipv4",
        url
    ]);

    let output = "";
    infoProcess.stdout.on("data", (data) => { output += data.toString(); });
    infoProcess.stderr.on("data", (data) => { console.error("yt-info-err:", data.toString()); });

    infoProcess.on("close", (code) => {
        if (code !== 0) return res.status(500).json({ error: "Failed to fetch metadata. Check the URL." });
        try {
            const data = JSON.parse(output);
            res.json({
                title: data.title || "Unknown Title",
                thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[data.thumbnails.length - 1].url : ""),
                uploader: data.uploader || data.channel || "Unknown Artist",
                id: data.id
            });
        } catch (e) {
            res.status(500).json({ error: "Failed to parse metadata" });
        }
    });
});

app.get("/download", (req, res) => {
    const { url, title, artist, clientId } = req.query;
    if (!url) return res.status(400).send("No URL provided");

    const safeTitle = sanitizeFilename(title || "audio");
    const encodedFilename = encodeURIComponent(`${safeTitle}.mp3`)
        .replace(/['()]/g, escape)
        .replace(/\*/g, "%2A");

    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle.replace(/[^\x20-\x7E]/g, '') || 'audio'}.mp3"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader("Content-Type", "audio/mpeg");

    // Speed up download with concurrent fragment downloading (-N 4) & no mtime overhead
    const yt = spawn("yt-dlp", [
        "-f", "bestaudio/best",
        "--no-playlist",
        "--force-overwrites",
        "--no-mtime",
        "-N", "4",
        "-o", "-",
        url
    ]);

    // High quality audio encoding with ID3v2 tags for player compatibility
    const ff = spawn("ffmpeg", [
        "-i", "pipe:0",
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        "-id3v2_version", "3",
        "-metadata", `title=${title || ""}`,
        "-metadata", `artist=${artist || ""}`,
        "-f", "mp3",
        "pipe:1"
    ]);

    yt.stdout.pipe(ff.stdin);
    ff.stdout.pipe(res);

    // Prevent uncaught stream errors if downstream or pipes close
    yt.stdout.on("error", (err) => {
        if (err.code !== "EPIPE") console.error("yt stdout error:", err);
    });
    ff.stdin.on("error", (err) => {
        if (err.code !== "EPIPE") console.error("ff stdin error:", err);
    });
    ff.stdout.on("error", (err) => {
        if (err.code !== "EPIPE") console.error("ff stdout error:", err);
    });

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
    };

    res.on("close", cleanup);
    res.on("finish", cleanup);

    yt.on("close", (code) => {
        if (code !== 0 && !res.writableEnded) {
            console.error("yt-dlp exited with code", code);
        }
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
