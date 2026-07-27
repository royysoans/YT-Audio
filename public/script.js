document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('download-form');
    const urlInput = document.getElementById('url');
    const button = document.getElementById('download-btn');
    const resetBtn = document.getElementById('reset-btn');
    const btnText = document.getElementById('btn-text');

    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedOptions = document.getElementById('advanced-options');
    const toggleArrow = advancedToggle.querySelector('.toggle-arrow');

    // Format Pill Selector
    const formatSelect = document.getElementById('format');
    const formatPills = document.querySelectorAll('#format-pills .pill-btn');

    formatPills.forEach(pill => {
        pill.addEventListener('click', () => {
            formatPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            formatSelect.value = pill.getAttribute('data-value');
        });
    });

    const playlistContainer = document.getElementById('playlist-container');
    const playlistItems = document.getElementById('playlist-items');
    const queueCount = document.getElementById('queue-count');

    const errorBanner = document.getElementById('error-banner');
    const errorMessage = document.getElementById('error-message');

    // Advanced Options
    const qualitySelect = document.getElementById('quality');
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    const normalizeCheck = document.getElementById('normalize');

    let currentQueue = [];
    let currentDownloadIndex = -1;
    let eventSource = null;
    let isDownloading = false;

    const baseClientId = 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();

    advancedToggle.addEventListener('click', () => {
        const isHidden = advancedOptions.style.display === 'none';
        advancedOptions.style.display = isHidden ? 'block' : 'none';
        toggleArrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    });

    function showError(msg) {
        errorMessage.textContent = msg;
        errorBanner.style.display = 'flex';
    }

    function hideError() {
        errorBanner.style.display = 'none';
        errorMessage.textContent = '';
    }

    function extractYouTubeUrls(text) {
        const regex = /https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/[^\s,]+/gi;
        const matches = text.match(regex);
        return matches ? Array.from(new Set(matches)) : [];
    }

    function resetUI() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        button.disabled = false;
        btnText.textContent = 'RIP AUDIO ►';

        currentQueue = [];
        currentDownloadIndex = -1;
        isDownloading = false;

        playlistContainer.style.display = 'none';
        playlistItems.innerHTML = '';
        queueCount.textContent = '0';

        resetBtn.style.display = 'none';
        urlInput.value = '';
        hideError();
    }

    resetBtn.addEventListener('click', resetUI);

    urlInput.addEventListener('input', () => {
        hideError();
        if (currentQueue.length > 0 && !isDownloading) {
            resetUI();
        }
    });

    function renderPlaylist() {
        playlistItems.innerHTML = '';
        queueCount.textContent = currentQueue.length;

        currentQueue.forEach((video, index) => {
            const row = document.createElement('div');
            row.className = 'track-row';
            row.id = `track-${index}`;

            row.innerHTML = `
                <img class="track-thumb" src="${video.thumbnail}" alt="Thumb">
                <div class="track-details">
                    <div class="track-title">${video.title}</div>
                    <div class="track-artist">${video.uploader}</div>
                </div>
                <div class="track-status" id="status-${index}">QUEUED</div>
                <div class="track-progress-line" id="progress-${index}"></div>
            `;
            playlistItems.appendChild(row);
        });

        playlistContainer.style.display = 'block';
    }

    function updateTrackProgress(index, percent, status) {
        const row = document.getElementById(`track-${index}`);
        const progressLine = document.getElementById(`progress-${index}`);
        const statusText = document.getElementById(`status-${index}`);

        if (!row) return;

        row.classList.add('active');

        const rounded = Math.min(100, Math.max(0, Math.round(percent)));
        progressLine.style.width = `${rounded}%`;

        if (status) statusText.textContent = status;

        if (rounded >= 100) {
            statusText.textContent = 'DONE!';
            row.classList.remove('active');
            row.classList.add('done');
        }
    }

    async function downloadNextInQueue() {
        currentDownloadIndex++;

        if (currentDownloadIndex >= currentQueue.length) {
            // All completed
            isDownloading = false;
            btnText.textContent = 'ALL TRACKS RIPPED! ★';
            setTimeout(() => {
                button.disabled = false;
                btnText.textContent = 'RIP AUDIO ►';
            }, 2500);
            return;
        }

        const video = currentQueue[currentDownloadIndex];
        const clientId = `${baseClientId}_${currentDownloadIndex}`;

        updateTrackProgress(currentDownloadIndex, 0, 'RIPPING...');

        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource(`/api/progress?clientId=${clientId}`);
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.progress !== undefined) {
                    updateTrackProgress(currentDownloadIndex, parseFloat(data.progress), 'RIPPING...');
                }
            } catch (err) {
                console.error('SSE parse error:', err);
            }
        };

        const queryParams = new URLSearchParams({
            url: video.url,
            title: video.title,
            artist: video.uploader,
            thumbnail: video.thumbnail,
            clientId: clientId,
            format: formatSelect.value,
            quality: qualitySelect.value
        });

        if (startTimeInput.value.trim()) queryParams.append('startTime', startTimeInput.value.trim());
        if (endTimeInput.value.trim()) queryParams.append('endTime', endTimeInput.value.trim());
        if (normalizeCheck.checked) queryParams.append('normalize', 'true');

        const downloadUrl = `/download?${queryParams.toString()}`;

        let downloadFrame = document.getElementById('hidden-download-frame');
        if (!downloadFrame) {
            downloadFrame = document.createElement('iframe');
            downloadFrame.id = 'hidden-download-frame';
            downloadFrame.style.display = 'none';
            document.body.appendChild(downloadFrame);
        }
        downloadFrame.src = downloadUrl;

        const checkCompletion = setInterval(() => {
            const statusText = document.getElementById(`status-${currentDownloadIndex}`);
            if (statusText && statusText.textContent === 'DONE!') {
                clearInterval(checkCompletion);
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
                setTimeout(() => {
                    downloadNextInQueue();
                }, 1500);
            }
        }, 1000);
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const inputContent = urlInput.value.trim();
        const extractedUrls = extractYouTubeUrls(inputContent);

        if (extractedUrls.length === 0) {
            showError('Please enter at least one valid YouTube URL');
            return;
        }

        if (currentQueue.length === 0) {
            button.disabled = true;
            btnText.textContent = 'SCANNING LINKS...';

            try {
                const response = await fetch('/api/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ urls: extractedUrls })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to fetch video details');
                }

                currentQueue = data.videos || [];

                if (currentQueue.length === 0) {
                    throw new Error('No videos found');
                }

                renderPlaylist();
                resetBtn.style.display = 'block';

                btnText.textContent = currentQueue.length > 1 ? `RIP ALL (${currentQueue.length}) ►` : 'START RIPPING ►';
                button.disabled = false;
            } catch (err) {
                showError(err.message || 'Failed to fetch details');
                resetUI();
            }
        } else if (!isDownloading) {
            isDownloading = true;
            button.disabled = true;
            btnText.textContent = 'RIPPING IN PROGRESS...';

            advancedOptions.style.display = 'none';
            toggleArrow.style.transform = 'rotate(0deg)';

            currentDownloadIndex = -1;
            downloadNextInQueue();
        }
    });
});
