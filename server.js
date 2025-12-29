const express = require("express");
const { spawn } = require("child_process");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const path = require("path");
const fs = require("fs");

function sanitizeFilename(name) {
    return name
        .replace(/[\/\\?%*:|"<>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

let clients = [];

app.get("/api/progress", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const clientId = req.query.clientId;
    if (!clientId) return res.end();

    const newClient = { id: clientId, res };
    clients.push(newClient);

    req.on("close", () => {
        clients = clients.filter(c => c.id !== clientId);
    });
});

function sendProgress(clientId, progress) {
    const client = clients.find(c => c.id == clientId);
    if (client) {
        client.res.write(`data: ${JSON.stringify({ progress })}\n\n`);
    }
}

app.post("/api/info", (req, res) => {
    const url = req.body.url;
    if (!url) return res.status(400).json({ error: "No URL provided" });

    const infoProcess = spawn("yt-dlp", [
        "--no-playlist",
        "--dump-json",
        "--force-ipv4",
        url
    ]);

    let output = "";
    infoProcess.stdout.on("data", (data) => output += data.toString());
    infoProcess.stderr.on("data", (data) => console.error("yt-info-err:", data.toString()));

    infoProcess.on("close", (code) => {
        if (code !== 0) return res.status(500).json({ error: "Failed to fetch metadata" });
        try {
            const data = JSON.parse(output);
            res.json({
                title: data.title,
                thumbnail: data.thumbnail,
                uploader: data.uploader,
                id: data.id
            });
        } catch (e) {
            res.status(500).json({ error: "Failed to parse metadata" });
        }
    });
});

app.get("/download", (req, res) => {
    const { url, title, artist, clientId } = req.query;
    if (!url) return res.status(400).send("No URL");

    const safeTitle = sanitizeFilename(title || "audio");

    const encodedTitle = encodeURIComponent(`${safeTitle}.mp3`).replace(/['()]/g, escape).replace(/\*/g, "%2A");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle.replace(/[^\x20-\x7E]/g, '') || 'audio'}.mp3"; filename*=UTF-8''${encodedTitle}`);
    res.setHeader("Content-Type", "audio/mpeg");
    const yt = spawn("yt-dlp", [
        "-f", "bestaudio",
        "--no-playlist",
        "--force-overwrites",
        "-o", "-",
        url
    ]);

    const ff = spawn("ffmpeg", [
        "-i", "pipe:0",
        "-vn",
        "-ab", "192k",
        "-metadata", `title=${title || ""}`,
        "-metadata", `artist=${artist || ""}`,
        "-f", "mp3",
        "pipe:1"
    ]);

    yt.stdout.pipe(ff.stdin);
    ff.stdout.pipe(res);

    yt.stderr.on("data", (data) => {
        const line = data.toString();
        const match = line.match(/\[download\]\s+(\d+\.\d+)%/);
        if (match && clientId) {
            sendProgress(clientId, match[1]);
        }
    });

    ff.stderr.on("data", (data) => {

    });

    let finished = false;
    const cleanup = () => {
        if (finished) return;
        finished = true;
        yt.kill();
        ff.kill();
    };

    res.on("close", cleanup);
    res.on("finish", cleanup);

    yt.on("close", (code) => {
        if (code !== 0 && !res.writableEnded) {
            console.error("yt-dlp failed with code", code);
        }
        ff.stdin.end();
    });

    ff.on("close", (code) => {
        if (clientId) {
            sendProgress(clientId, 100);
        }
    });
});


app.listen(3000, () => {
    console.log("Server running at http://localhost:3000");
});
