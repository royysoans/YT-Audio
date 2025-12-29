document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('download-form');
    const urlInput = document.getElementById('url');
    const button = document.getElementById('download-btn');
    const btnText = button.querySelector('.text');
    const btnArrow = button.querySelector('.arrow');

    // UI Elements
    const previewContainer = document.getElementById('preview-container');
    const videoThumbnail = document.getElementById('video-thumbnail');
    const videoTitle = document.getElementById('video-title');
    const videoUploader = document.getElementById('video-uploader');

    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const statusText = document.getElementById('status-text');

    let currentVideoData = null;
    let eventSource = null;
    let clientId = null;

    // Connect to SSE for progress
    function setupSSE() {
        if (eventSource) return;
        eventSource = new EventSource('/api/progress');
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.progress) {
                updateProgress(data.progress, 'Downloading...');
            }
        };
        // We'll get our client ID from the first message or just use timestamp
        // Simplified: The server uses Date.now() but we don't know it.
        // Let's modify server to send the client ID first.
    }

    // Since server doesn't send ID, let's just make the client generate it and send to server.
    // OPTION 2: Server sends ID in a specific message.
    // Let's adjust server.js quickly after this to handle a provided clientId.
    clientId = Date.now();

    function updateProgress(percent, status) {
        progressContainer.style.display = 'block';
        progressBarFill.style.width = `${percent}%`;
        progressText.textContent = `${Math.round(percent)}%`;
        if (status) statusText.textContent = status;

        if (percent >= 100) {
            statusText.textContent = 'Complete!';
            statusText.style.color = '#10b981'; // green
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            setTimeout(() => {
                resetUI();
            }, 5000);
        }
    }

    function resetUI() {
        button.disabled = false;
        btnText.textContent = 'Find Video';
        btnArrow.style.display = 'inline';
        progressContainer.style.display = 'none';
        progressBarFill.style.width = '0%';
        currentVideoData = null;
        previewContainer.style.display = 'none';
        urlInput.value = '';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!currentVideoData) {
            // STEP 1: FETCH INFO
            button.disabled = true;
            btnText.textContent = 'Searching...';

            try {
                const response = await fetch('/api/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: urlInput.value })
                });

                if (!response.ok) throw new Error('Video not found');

                const data = await response.json();
                currentVideoData = data;

                // Update Preview
                videoThumbnail.src = data.thumbnail;
                videoTitle.textContent = data.title;
                videoUploader.textContent = data.uploader;
                previewContainer.style.display = 'flex';

                btnText.textContent = 'Extract MP3';
                button.disabled = false;
            } catch (err) {
                alert(err.message);
                resetUI();
            }
        } else {
            // STEP 2: DOWNLOAD
            button.disabled = true;
            btnText.textContent = 'Extracting...';

            updateProgress(0, 'Initializing...');

            // Connect SSE
            eventSource = new EventSource(`/api/progress?clientId=${clientId}`);
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.progress) {
                    updateProgress(parseFloat(data.progress), 'Extracting Audio...');
                }
            };

            // Trigger download via hidden link to keep SSE alive
            const downloadUrl = `/download?url=${encodeURIComponent(urlInput.value)}&title=${encodeURIComponent(currentVideoData.title)}&artist=${encodeURIComponent(currentVideoData.uploader)}&clientId=${clientId}`;

            // Using window.location often works for attachments without killing the page
            window.location.href = downloadUrl;
        }
    });

    // Helper to send the "real" client ID that the server picked
    // Actually, I'll update server.js to use the query param instead for mapping.
});
