document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('download-form');
    const urlInput = document.getElementById('url');
    const button = document.getElementById('download-btn');
    const resetBtn = document.getElementById('reset-btn');
    const btnText = button.querySelector('.text');
    const btnArrow = button.querySelector('.arrow');

    const previewContainer = document.getElementById('preview-container');
    const videoThumbnail = document.getElementById('video-thumbnail');
    const videoTitle = document.getElementById('video-title');
    const videoUploader = document.getElementById('video-uploader');

    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const statusText = document.getElementById('status-text');

    const errorBanner = document.getElementById('error-banner');
    const errorMessage = document.getElementById('error-message');

    let currentVideoData = null;
    let eventSource = null;
    const clientId = 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();

    function showError(msg) {
        errorMessage.textContent = msg;
        errorBanner.style.display = 'flex';
    }

    function hideError() {
        errorBanner.style.display = 'none';
        errorMessage.textContent = '';
    }

    function validateYouTubeUrl(url) {
        const pattern = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/.+/i;
        return pattern.test(url.trim());
    }

    function updateProgress(percent, status) {
        progressContainer.style.display = 'block';
        const rounded = Math.min(100, Math.max(0, Math.round(percent)));
        progressBarFill.style.width = `${rounded}%`;
        progressText.textContent = `${rounded}%`;
        if (status) statusText.textContent = status;

        if (rounded >= 100) {
            statusText.textContent = 'Download Complete!';
            statusText.style.color = '#10b981';
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            setTimeout(() => {
                button.disabled = false;
                btnText.textContent = 'Extract MP3 Again';
                btnArrow.style.display = 'inline';
            }, 1000);
        }
    }

    function resetUI() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        button.disabled = false;
        btnText.textContent = 'Find Video';
        btnArrow.style.display = 'inline';
        progressContainer.style.display = 'none';
        progressBarFill.style.width = '0%';
        progressText.textContent = '0%';
        statusText.style.color = '';
        currentVideoData = null;
        previewContainer.style.display = 'none';
        resetBtn.style.display = 'none';
        urlInput.value = '';
        hideError();
    }

    resetBtn.addEventListener('click', resetUI);

    urlInput.addEventListener('input', () => {
        hideError();
        if (currentVideoData) {
            resetUI();
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const inputUrl = urlInput.value.trim();
        if (!validateYouTubeUrl(inputUrl)) {
            showError('Please enter a valid YouTube URL');
            return;
        }

        if (!currentVideoData) {
            // STEP 1: FETCH METADATA
            button.disabled = true;
            btnText.textContent = 'Searching...';

            try {
                const response = await fetch('/api/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: inputUrl })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Video not found or unavailable');
                }

                currentVideoData = data;

                videoThumbnail.src = data.thumbnail || '';
                videoTitle.textContent = data.title;
                videoUploader.textContent = data.uploader;
                previewContainer.style.display = 'flex';
                resetBtn.style.display = 'block';

                btnText.textContent = 'Extract MP3';
                button.disabled = false;
            } catch (err) {
                showError(err.message || 'Failed to fetch video details');
                resetUI();
            }
        } else {
            // STEP 2: START SSE & TRIGGER DOWNLOAD
            button.disabled = true;
            btnText.textContent = 'Extracting Audio...';
            btnArrow.style.display = 'none';

            updateProgress(0, 'Initializing audio stream...');

            if (eventSource) {
                eventSource.close();
            }

            eventSource = new EventSource(`/api/progress?clientId=${clientId}`);
            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.progress !== undefined) {
                        updateProgress(parseFloat(data.progress), 'Converting & Downloading...');
                    }
                } catch (err) {
                    console.error('SSE parse error:', err);
                }
            };

            eventSource.onerror = () => {
                // EventSource error reconnect handling
            };

            // Trigger file download through an invisible iframe to maintain the active SSE stream
            const downloadUrl = `/download?url=${encodeURIComponent(inputUrl)}&title=${encodeURIComponent(currentVideoData.title)}&artist=${encodeURIComponent(currentVideoData.uploader)}&clientId=${clientId}`;

            let downloadFrame = document.getElementById('hidden-download-frame');
            if (!downloadFrame) {
                downloadFrame = document.createElement('iframe');
                downloadFrame.id = 'hidden-download-frame';
                downloadFrame.style.display = 'none';
                document.body.appendChild(downloadFrame);
            }
            downloadFrame.src = downloadUrl;
        }
    });
});
