// TempChat Client-Side Application (Hardened & Polished)
(function () {
    'use strict';

    // Socket instance
    const socket = io();

    // App State
    let currentUser = null;
    let currentRoomId = null;
    let roomExpiresAt = null;
    let expiryTimerId = null;
    let typingTimeoutId = null;
    let isTyping = false;
    let soundEnabled = true;
    let qrCodeInstance = null;
    let activeFileReader = null;
    let fileReadRoomId = null;

    // Reply & Voice Note state
    let activeReply = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let audioStream = null;
    let recordingTimerId = null;
    let recordingSeconds = 0;
    let currentlyPlayingAudio = null;

    // DOM Elements - Screens
    const lobbyScreen = document.getElementById('lobby-screen');
    const chatScreen = document.getElementById('chat-screen');

    // DOM Elements - Tabs & Forms
    const tabCreateBtn = document.getElementById('tab-create-btn');
    const tabJoinBtn = document.getElementById('tab-join-btn');
    const createRoomForm = document.getElementById('create-room-form');
    const joinRoomForm = document.getElementById('join-room-form');

    const createUsernameInput = document.getElementById('create-username');
    const createColorPicker = document.getElementById('create-color-picker');
    const roomTtlSelect = document.getElementById('room-ttl');

    const joinRoomIdInput = document.getElementById('join-room-id');
    const joinUsernameInput = document.getElementById('join-username');
    const joinColorPicker = document.getElementById('join-color-picker');

    // DOM Elements - Chat Navigation & Header
    const displayRoomId = document.getElementById('display-room-id');
    const copyRoomIdBtn = document.getElementById('copy-room-id-btn');
    const roomIdContainer = document.getElementById('room-id-container');
    const expiryTimer = document.getElementById('expiry-timer');
    const shareModalBtn = document.getElementById('share-modal-btn');
    const participantsToggleBtn = document.getElementById('participants-toggle-btn');
    const participantsCountBadge = document.getElementById('participants-count-badge');
    const burnRoomBtn = document.getElementById('burn-room-btn');
    const leaveRoomBtn = document.getElementById('leave-room-btn');

    // DOM Elements - Chat Area
    const messagesContainer = document.getElementById('messages-container');
    const welcomeRoomId = document.getElementById('welcome-room-id');
    const welcomeCopyBtn = document.getElementById('welcome-copy-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const attachFileBtn = document.getElementById('attach-file-btn');
    const fileInput = document.getElementById('file-input');
    const voiceRecordBtn = document.getElementById('voice-record-btn');
    const voiceRecordingBar = document.getElementById('voice-recording-bar');
    const recordingTimer = document.getElementById('recording-timer');
    const cancelVoiceBtn = document.getElementById('cancel-voice-btn');
    const sendVoiceBtn = document.getElementById('send-voice-btn');

    // DOM Elements - Reply Bar
    const replyPreviewBar = document.getElementById('reply-preview-bar');
    const replyToUser = document.getElementById('reply-to-user');
    const replyToText = document.getElementById('reply-to-text');
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');

    // DOM Elements - Sidebar
    const participantsSidebar = document.getElementById('participants-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const participantsList = document.getElementById('participants-list');
    const sidebarCount = document.getElementById('sidebar-count');
    const soundToggle = document.getElementById('sound-toggle');

    // DOM Elements - Modals
    const shareModal = document.getElementById('share-modal');
    const shareModalClose = document.getElementById('share-modal-close');
    const shareRoomIdInput = document.getElementById('share-room-id-input');
    const shareRoomLinkInput = document.getElementById('share-room-link-input');
    const copyModalIdBtn = document.getElementById('copy-modal-id-btn');
    const copyModalLinkBtn = document.getElementById('copy-modal-link-btn');
    const qrcodeBox = document.getElementById('qrcode-box');

    const burnModal = document.getElementById('burn-modal');
    const burnModalClose = document.getElementById('burn-modal-close');
    const cancelBurnBtn = document.getElementById('cancel-burn-btn');
    const confirmBurnBtn = document.getElementById('confirm-burn-btn');

    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxImg = document.getElementById('lightbox-img');

    const toastContainer = document.getElementById('toast-container');

    // Connection lifecycle handling
    socket.on('disconnect', () => {
        showToast('Connection interrupted. Reconnecting...', 'error');
        messageInput.disabled = true;
    });

    socket.on('connect', () => {
        messageInput.disabled = false;
    });

    // Web Audio Synthesizer for gentle notification sounds
    let audioCtx = null;
    function playNotificationSound(type = 'message') {
        if (!soundEnabled) return;
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);

            const now = audioCtx.currentTime;
            if (type === 'message') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, now); // D5
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === 'system') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(440, now);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
                osc.start(now);
                osc.stop(now + 0.18);
            }
        } catch (e) {
            // Audio context requires user gesture
        }
    }

    // Toast Helper
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    // Color Pickers Setup
    function setupColorPickers(container) {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.color-circle');
            if (!btn) return;
            container.querySelectorAll('.color-circle').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
        });
    }
    setupColorPickers(createColorPicker);
    setupColorPickers(joinColorPicker);

    function getSelectedColor(container) {
        const active = container.querySelector('.color-circle.active');
        return sanitizeColor(active ? active.dataset.color : '#ff6b35');
    }

    function sanitizeColor(color, fallback = '#ff6b35') {
        if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
            return color.toLowerCase();
        }
        return fallback;
    }

    // Tab Navigation
    tabCreateBtn.addEventListener('click', () => {
        tabCreateBtn.classList.add('active');
        tabJoinBtn.classList.remove('active');
        createRoomForm.classList.add('active');
        joinRoomForm.classList.remove('active');
    });

    tabJoinBtn.addEventListener('click', () => {
        tabJoinBtn.classList.add('active');
        tabCreateBtn.classList.remove('active');
        joinRoomForm.classList.add('active');
        createRoomForm.classList.remove('active');
    });

    // Handle URL query parameters (?room=xyz)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        tabJoinBtn.click();
        joinRoomIdInput.value = roomParam.trim().toLowerCase();
        joinUsernameInput.focus();
    }

    // Create Room Submission
    createRoomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = createUsernameInput.value.trim();
        if (!username) return;

        const avatarColor = getSelectedColor(createColorPicker);
        const ttlMinutes = parseInt(roomTtlSelect.value, 10);

        socket.emit('create_room', { username, avatarColor, ttlMinutes }, (response) => {
            if (response && response.success) {
                enterChat(response.roomId, response.user, response.expiresAt, response.participants);
                showToast('Temporary room created!', 'success');
            } else {
                showToast(response?.message || 'Error creating room', 'error');
            }
        });
    });

    // Join Room Submission
    joinRoomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomId = joinRoomIdInput.value.trim().toLowerCase();
        const username = joinUsernameInput.value.trim();
        if (!roomId || !username) return;

        const avatarColor = getSelectedColor(joinColorPicker);

        socket.emit('join_room', { roomId, username, avatarColor }, (response) => {
            if (response && response.success) {
                enterChat(response.roomId, response.user, response.expiresAt, response.participants);
                showToast('Joined temporary room', 'success');

                // Render existing session messages if any
                if (response.messages && Array.isArray(response.messages)) {
                    response.messages.forEach(msg => appendMessage(msg));
                }
            } else {
                showToast(response?.message || 'Room not found or expired', 'error');
            }
        });
    });

    // Enter Chat Interface
    function enterChat(roomId, user, expiresAt, participants) {
        currentRoomId = roomId;
        currentUser = user;
        roomExpiresAt = expiresAt;

        lobbyScreen.classList.remove('active');
        chatScreen.classList.add('active');

        displayRoomId.textContent = roomId;
        welcomeRoomId.textContent = roomId;

        const newUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
        window.history.replaceState({ room: roomId }, '', newUrl);

        if (currentUser && currentUser.isHost) {
            burnRoomBtn.style.display = 'flex';
        } else {
            burnRoomBtn.style.display = 'none';
        }

        updateParticipantsUI(participants || [currentUser]);
        startExpiryCountdown(expiresAt);
        messageInput.focus();
    }

    // Expiry Countdown Timer
    function startExpiryCountdown(expiresAt) {
        if (expiryTimerId) clearInterval(expiryTimerId);

        function updateTimer() {
            const now = Date.now();
            const diff = expiresAt - now;

            if (diff <= 0) {
                clearInterval(expiryTimerId);
                expiryTimer.textContent = 'EXPIRED';
                showToast('This room has expired.', 'error');
                return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            const pad = (n) => String(n).padStart(2, '0');
            expiryTimer.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        }

        updateTimer();
        expiryTimerId = setInterval(updateTimer, 1000);
    }

    // Update Participants Sidebar Safely without HTML Injection
    function updateParticipantsUI(participants) {
        const list = Array.isArray(participants) ? participants : [];
        participantsCountBadge.textContent = list.length;
        sidebarCount.textContent = list.length;

        participantsList.innerHTML = '';
        list.forEach(p => {
            const li = document.createElement('li');
            li.className = `participant-item ${p.id === currentUser?.id ? 'self' : ''}`;

            const avatar = document.createElement('div');
            avatar.className = 'p-avatar';
            avatar.style.backgroundColor = sanitizeColor(p.avatarColor, '#ff6b35');
            avatar.textContent = (p.username || '?').slice(0, 2).toUpperCase();

            const info = document.createElement('div');
            info.className = 'p-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'p-name';
            nameSpan.textContent = p.username || 'Guest';
            info.appendChild(nameSpan);

            if (p.isHost) {
                const hostBadge = document.createElement('span');
                hostBadge.className = 'host-badge';
                hostBadge.textContent = 'HOST';
                info.appendChild(hostBadge);
            }

            if (p.id === currentUser?.id) {
                const youSpan = document.createElement('span');
                youSpan.style.fontSize = '10px';
                youSpan.style.color = 'var(--text-muted)';
                youSpan.textContent = '(You)';
                info.appendChild(youSpan);
            }

            li.appendChild(avatar);
            li.appendChild(info);
            participantsList.appendChild(li);
        });
    }

    // Chat Message Form Submission
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendCurrentMessage();
    });

    // Enter to Send, Shift+Enter for new line
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendCurrentMessage();
        }
    });

    // Auto-expand textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';

        if (!isTyping) {
            isTyping = true;
            socket.emit('typing', { isTyping: true });
        }
        clearTimeout(typingTimeoutId);
        typingTimeoutId = setTimeout(() => {
            isTyping = false;
            socket.emit('typing', { isTyping: false });
        }, 1500);
    });

    function clearReply() {
        activeReply = null;
        replyPreviewBar.classList.add('hidden');
        replyToUser.textContent = '';
        replyToText.textContent = '';
    }

    cancelReplyBtn.addEventListener('click', clearReply);

    function sendCurrentMessage() {
        const text = messageInput.value.trim();
        if (!text) return;

        socket.emit('send_message', {
            text: text,
            replyTo: activeReply
        });

        clearReply();
        messageInput.value = '';
        messageInput.style.height = 'auto';

        if (isTyping) {
            isTyping = false;
            socket.emit('typing', { isTyping: false });
            clearTimeout(typingTimeoutId);
        }
    }

    // Voice Recording implementation (Push-to-Talk / One-tap)
    async function startVoiceRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('Voice recording is not supported in this browser.', 'error');
            return;
        }

        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            recordingSeconds = 0;

            let mimeType = 'audio/webm';
            if (window.MediaRecorder) {
                if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                    mimeType = 'audio/webm;codecs=opus';
                } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
                    mimeType = 'audio/ogg;codecs=opus';
                } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                    mimeType = 'audio/mp4';
                }
            }

            mediaRecorder = new MediaRecorder(audioStream, { mimeType: mimeType });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    audioChunks.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                if (audioChunks.length === 0) return;
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                const finalDuration = recordingSeconds || 1;

                const reader = new FileReader();
                reader.onload = function () {
                    const base64Audio = reader.result;
                    socket.emit('send_voice', {
                        audioData: base64Audio,
                        duration: finalDuration,
                        replyTo: activeReply
                    }, (res) => {
                        if (res && !res.success) {
                            showToast(res.message || 'Failed to send voice note', 'error');
                        }
                    });
                    clearReply();
                };
                reader.readAsDataURL(audioBlob);
            };

            mediaRecorder.start(200);

            voiceRecordingBar.classList.remove('hidden');
            recordingTimer.textContent = '0:00 / 0:30';

            recordingTimerId = setInterval(() => {
                recordingSeconds++;
                const mins = Math.floor(recordingSeconds / 60);
                const secs = String(recordingSeconds % 60).padStart(2, '0');
                recordingTimer.textContent = `${mins}:${secs} / 0:30`;

                if (recordingSeconds >= 30) {
                    stopAndSendVoiceRecording();
                }
            }, 1000);

        } catch (err) {
            console.error('Microphone error:', err);
            showToast('Microphone access denied or unavailable.', 'error');
            cancelVoiceRecording();
        }
    }

    function stopAndSendVoiceRecording() {
        if (recordingTimerId) clearInterval(recordingTimerId);
        voiceRecordingBar.classList.add('hidden');

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (audioStream) {
            audioStream.getTracks().forEach(t => t.stop());
            audioStream = null;
        }
    }

    function cancelVoiceRecording() {
        if (recordingTimerId) clearInterval(recordingTimerId);
        voiceRecordingBar.classList.add('hidden');
        audioChunks = [];
        recordingSeconds = 0;

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.onstop = null;
            mediaRecorder.stop();
        }
        if (audioStream) {
            audioStream.getTracks().forEach(t => t.stop());
            audioStream = null;
        }
    }

    voiceRecordBtn.addEventListener('click', () => {
        if (voiceRecordingBar.classList.contains('hidden')) {
            startVoiceRecording();
        } else {
            stopAndSendVoiceRecording();
        }
    });

    cancelVoiceBtn.addEventListener('click', cancelVoiceRecording);
    sendVoiceBtn.addEventListener('click', stopAndSendVoiceRecording);

    // Audio Player helper for inline voice notes
    function createVoicePlayer(audioSrc, totalDuration) {
        const playerWrapper = document.createElement('div');
        playerWrapper.className = 'voice-player';

        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'voice-play-btn';
        playBtn.title = 'Play Voice Note';
        playBtn.innerHTML = `
            <svg class="play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <svg class="pause-icon hidden" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        `;

        const waveContainer = document.createElement('div');
        waveContainer.className = 'voice-wave-container';

        const progressTrack = document.createElement('div');
        progressTrack.className = 'voice-progress-track';

        const progressFill = document.createElement('div');
        progressFill.className = 'voice-progress-fill';
        progressTrack.appendChild(progressFill);

        const durationSpan = document.createElement('span');
        durationSpan.className = 'voice-duration';
        const totalSecs = Math.max(1, Math.round(totalDuration || 0));
        const totalMin = Math.floor(totalSecs / 60);
        const totalSecStr = String(totalSecs % 60).padStart(2, '0');
        durationSpan.textContent = `0:00 / ${totalMin}:${totalSecStr}`;

        waveContainer.appendChild(progressTrack);
        waveContainer.appendChild(durationSpan);

        playerWrapper.appendChild(playBtn);
        playerWrapper.appendChild(waveContainer);

        let audio = null;
        const playIcon = playBtn.querySelector('.play-icon');
        const pauseIcon = playBtn.querySelector('.pause-icon');

        function resetUI() {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
            progressFill.style.width = '0%';
            durationSpan.textContent = `0:00 / ${totalMin}:${totalSecStr}`;
        }

        playBtn.addEventListener('click', () => {
            if (!audio) {
                audio = new Audio(audioSrc);

                audio.addEventListener('timeupdate', () => {
                    if (!audio.duration) return;
                    const percent = (audio.currentTime / audio.duration) * 100;
                    progressFill.style.width = `${percent}%`;

                    const curSecs = Math.floor(audio.currentTime);
                    const curMin = Math.floor(curSecs / 60);
                    const curSecStr = String(curSecs % 60).padStart(2, '0');
                    durationSpan.textContent = `${curMin}:${curSecStr} / ${totalMin}:${totalSecStr}`;
                });

                audio.addEventListener('ended', () => {
                    resetUI();
                    currentlyPlayingAudio = null;
                });
            }

            if (audio.paused) {
                if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
                    currentlyPlayingAudio.pause();
                    currentlyPlayingAudio.currentTime = 0;
                }
                currentlyPlayingAudio = audio;
                audio.play().then(() => {
                    playIcon.classList.add('hidden');
                    pauseIcon.classList.remove('hidden');
                }).catch(e => console.error('Audio play error:', e));
            } else {
                audio.pause();
                playIcon.classList.remove('hidden');
                pauseIcon.classList.add('hidden');
            }
        });

        progressTrack.addEventListener('click', (e) => {
            if (!audio || !audio.duration) return;
            const rect = progressTrack.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const newFraction = Math.max(0, Math.min(1, clickX / rect.width));
            audio.currentTime = newFraction * audio.duration;
        });

        return playerWrapper;
    }

    // Reactions Tray Renderer
    function renderReactionsTray(trayEl, reactions, messageId) {
        trayEl.innerHTML = '';
        if (!reactions || typeof reactions !== 'object') return;

        let hasAny = false;
        for (const [emoji, users] of Object.entries(reactions)) {
            if (!Array.isArray(users) || users.length === 0) continue;
            hasAny = true;
            const pill = document.createElement('button');
            pill.type = 'button';
            const isUserReacted = users.includes(currentUser?.username);
            pill.className = `reaction-pill ${isUserReacted ? 'active' : ''}`;
            pill.innerHTML = `<span class="emoji-symbol">${emoji}</span> <span class="reaction-count">${users.length}</span>`;
            pill.title = users.join(', ');
            pill.addEventListener('click', () => {
                socket.emit('toggle_reaction', { messageId, emoji });
            });
            trayEl.appendChild(pill);
        }

        if (hasAny) {
            trayEl.classList.remove('hidden');
        } else {
            trayEl.classList.add('hidden');
        }
    }

    // File Attachment Handler bound to current room session
    attachFileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;

        if (file.size > 8 * 1024 * 1024) {
            showToast('File too large. Maximum size is 8MB.', 'error');
            fileInput.value = '';
            return;
        }

        // Bind read to currently active room session
        fileReadRoomId = currentRoomId;
        const reader = new FileReader();
        activeFileReader = reader;

        reader.onload = function (e) {
            // Discard if user left or switched rooms during the file read
            if (!currentRoomId || fileReadRoomId !== currentRoomId) {
                fileInput.value = '';
                activeFileReader = null;
                return;
            }

            const base64Data = e.target.result;
            socket.emit('send_file', {
                fileName: file.name,
                fileType: file.type,
                fileData: base64Data,
                fileSize: file.size,
                replyTo: activeReply
            }, (res) => {
                if (res && !res.success) {
                    showToast(res.message || 'File upload failed', 'error');
                }
            });
            clearReply();
            fileInput.value = '';
            activeFileReader = null;
        };

        reader.onerror = function () {
            showToast('Failed to read file', 'error');
            activeFileReader = null;
            fileInput.value = '';
        };

        reader.readAsDataURL(file);
    });

    // Append Message to UI safely
    function appendMessage(msg) {
        if (!msg || !msg.sender) return;

        const isSelf = msg.sender.id === currentUser?.id;

        const row = document.createElement('div');
        row.className = `message-row ${isSelf ? 'self' : ''}`;
        row.dataset.msgId = msg.id;
        row.id = `msg-${msg.id}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.style.backgroundColor = sanitizeColor(msg.sender.avatarColor, '#ff6b35');
        avatar.textContent = (msg.sender.username || '?').slice(0, 2).toUpperCase();

        const bubbleWrapper = document.createElement('div');
        bubbleWrapper.className = 'message-bubble-wrapper';

        const meta = document.createElement('div');
        meta.className = 'message-meta';

        const senderSpan = document.createElement('span');
        senderSpan.className = 'sender-name';
        senderSpan.textContent = msg.sender.username || 'Guest';
        meta.appendChild(senderSpan);

        if (msg.sender.isHost) {
            const hostBadge = document.createElement('span');
            hostBadge.className = 'host-badge';
            hostBadge.textContent = 'HOST';
            meta.appendChild(hostBadge);
        }

        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        meta.appendChild(timeSpan);
        bubbleWrapper.appendChild(meta);

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        // Render Quoted Reply if message was sent as a reply
        if (msg.replyTo && msg.replyTo.senderName) {
            const quoteBox = document.createElement('div');
            quoteBox.className = 'message-quote-box';
            quoteBox.title = 'Click to jump to original message';
            quoteBox.innerHTML = `
                <div class="quote-bar"></div>
                <div class="quote-content">
                    <span class="quote-author">${escapeHtml(msg.replyTo.senderName)}</span>
                    <span class="quote-snippet">${escapeHtml(msg.replyTo.text)}</span>
                </div>
            `;
            quoteBox.addEventListener('click', () => {
                const target = document.getElementById(`msg-${msg.replyTo.id}`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('highlight-flash');
                    setTimeout(() => target.classList.remove('highlight-flash'), 1600);
                }
            });
            bubble.appendChild(quoteBox);
        }

        if (msg.type === 'text') {
            const textDiv = document.createElement('div');
            textDiv.className = 'message-text-content';
            textDiv.innerHTML = linkify(escapeHtml(msg.text));
            bubble.appendChild(textDiv);
        } else if (msg.type === 'voice') {
            const voicePlayer = createVoicePlayer(msg.audioData, msg.duration);
            bubble.appendChild(voicePlayer);
        } else if (msg.type === 'file') {
            const fileType = typeof msg.fileType === 'string' ? msg.fileType : '';
            if (fileType.startsWith('image/')) {
                bubble.style.padding = '6px';
                const img = document.createElement('img');
                img.className = 'chat-image-preview';
                img.alt = msg.fileName || 'Image attachment';
                if (typeof msg.fileData === 'string' && msg.fileData.startsWith('data:image/')) {
                    img.src = msg.fileData;
                }
                img.addEventListener('click', () => {
                    if (img.src) previewImage(img.src);
                });
                bubble.appendChild(img);
            } else {
                const link = document.createElement('a');
                link.className = 'file-attachment-card';
                if (typeof msg.fileData === 'string' && msg.fileData.startsWith('data:')) {
                    link.href = msg.fileData;
                }
                link.download = msg.fileName || 'attachment';

                link.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="18"/><line x1="15" y1="15" x2="12" y2="18"/></svg>`;

                const fileInfo = document.createElement('div');
                fileInfo.className = 'file-info';

                const fileNameSpan = document.createElement('span');
                fileNameSpan.className = 'file-name';
                fileNameSpan.textContent = msg.fileName || 'Attachment';

                const fileSizeSpan = document.createElement('span');
                fileSizeSpan.className = 'file-size';
                fileSizeSpan.textContent = `${formatBytes(msg.fileSize)} • Click to download`;

                fileInfo.appendChild(fileNameSpan);
                fileInfo.appendChild(fileSizeSpan);
                link.appendChild(fileInfo);
                bubble.appendChild(link);
            }
        }

        bubbleWrapper.appendChild(bubble);

        // Action Toolbar (Reactions & Reply)
        const actionToolbar = document.createElement('div');
        actionToolbar.className = 'message-action-toolbar';

        const quickReactions = document.createElement('div');
        quickReactions.className = 'quick-reactions-group';

        ['🔥', '👍', '❤️', '😂'].forEach(emoji => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quick-reaction-btn';
            btn.textContent = emoji;
            btn.title = `React ${emoji}`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                socket.emit('toggle_reaction', { messageId: msg.id, emoji });
            });
            quickReactions.appendChild(btn);
        });
        actionToolbar.appendChild(quickReactions);

        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'action-reply-btn';
        replyBtn.title = 'Reply to this message';
        replyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
        replyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            let snippet = msg.text || (msg.type === 'voice' ? '🎙️ Voice note' : (msg.fileName ? `📎 ${msg.fileName}` : 'Message'));
            activeReply = {
                id: msg.id,
                senderName: msg.sender.username,
                text: snippet.slice(0, 100)
            };
            replyToUser.textContent = msg.sender.username;
            replyToText.textContent = snippet.slice(0, 80);
            replyPreviewBar.classList.remove('hidden');
            messageInput.focus();
        });
        actionToolbar.appendChild(replyBtn);

        bubbleWrapper.appendChild(actionToolbar);

        // Reactions Tray
        const reactionsTray = document.createElement('div');
        reactionsTray.className = 'message-reactions-tray hidden';
        renderReactionsTray(reactionsTray, msg.reactions, msg.id);
        bubbleWrapper.appendChild(reactionsTray);

        row.appendChild(avatar);
        row.appendChild(bubbleWrapper);

        messagesContainer.appendChild(row);
        scrollToBottom();

        if (!isSelf) {
            playNotificationSound('message');
        }
    }

    // Append System Notice
    function appendSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'system-message-row';
        div.innerHTML = `<span class="system-pill">${escapeHtml(text)}</span>`;
        messagesContainer.appendChild(div);
        scrollToBottom();
        playNotificationSound('system');
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Socket Event Listeners
    socket.on('new_message', (msg) => {
        appendMessage(msg);
    });

    socket.on('user_joined', (data) => {
        if (data.message) appendSystemMessage(data.message);
        if (data.participants) updateParticipantsUI(data.participants);
    });

    socket.on('user_left', (data) => {
        if (data.message) appendSystemMessage(data.message);
        if (data.participants) updateParticipantsUI(data.participants);
    });

    socket.on('host_changed', (data) => {
        if (data.newHost && data.newHost.id === currentUser?.id) {
            currentUser.isHost = true;
            burnRoomBtn.style.display = 'flex';
            showToast('You are now the room host!', 'info');
        }
        if (data.newHost) appendSystemMessage(`${data.newHost.username} is now the host.`);
        if (data.participants) updateParticipantsUI(data.participants);
    });

    socket.on('user_typing', (data) => {
        if (data.isTyping) {
            typingText.textContent = `${data.username} is typing...`;
            typingIndicator.classList.remove('hidden');
            scrollToBottom();
        } else {
            typingIndicator.classList.add('hidden');
        }
    });

    socket.on('reaction_updated', (data) => {
        if (!data || !data.messageId) return;
        const row = document.getElementById(`msg-${data.messageId}`);
        if (row) {
            const tray = row.querySelector('.message-reactions-tray');
            if (tray) {
                renderReactionsTray(tray, data.reactions, data.messageId);
            }
        }
    });

    socket.on('room_burned', (data) => {
        showToast(data.message || 'Room burned by host', 'error');
        leaveChatUI();
    });

    socket.on('room_expired', (data) => {
        showToast(data.message || 'Room expired', 'error');
        leaveChatUI();
    });

    // Leave Chat
    function leaveChatUI() {
        if (expiryTimerId) clearInterval(expiryTimerId);

        cancelVoiceRecording();
        clearReply();

        if (currentlyPlayingAudio) {
            try {
                currentlyPlayingAudio.pause();
                currentlyPlayingAudio.currentTime = 0;
            } catch (e) {}
            currentlyPlayingAudio = null;
        }

        if (activeFileReader) {
            try { activeFileReader.abort(); } catch (e) {}
            activeFileReader = null;
        }
        fileReadRoomId = null;
        currentRoomId = null;
        currentUser = null;

        // Close all modal overlays owned by room session
        lightboxModal.classList.add('hidden');
        lightboxImg.src = '';
        shareModal.classList.add('hidden');
        burnModal.classList.add('hidden');

        // Clean query param
        window.history.replaceState({}, '', window.location.pathname);

        // Reset screens
        chatScreen.classList.remove('active');
        lobbyScreen.classList.add('active');

        // Clear messages
        messagesContainer.querySelectorAll('.message-row, .system-message-row').forEach(el => el.remove());
    }

    leaveRoomBtn.addEventListener('click', () => {
        if (confirm('Leave this temporary room?')) {
            socket.emit('leave_room');
            leaveChatUI();
        }
    });

    // Burn Room (Host)
    burnRoomBtn.addEventListener('click', () => {
        burnModal.classList.remove('hidden');
    });

    burnModalClose.addEventListener('click', () => burnModal.classList.add('hidden'));
    cancelBurnBtn.addEventListener('click', () => burnModal.classList.add('hidden'));

    confirmBurnBtn.addEventListener('click', () => {
        socket.emit('burn_room', (res) => {
            burnModal.classList.add('hidden');
            if (res && res.success) {
                showToast('Room successfully burned and purged.', 'info');
                leaveChatUI();
            }
        });
    });

    // Share Modal
    shareModalBtn.addEventListener('click', () => {
        openShareModal();
    });

    function openShareModal() {
        if (!currentRoomId) return;
        const joinLink = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}`;

        shareRoomIdInput.value = currentRoomId;
        shareRoomLinkInput.value = joinLink;

        qrcodeBox.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
            qrCodeInstance = new QRCode(qrcodeBox, {
                text: joinLink,
                width: 160,
                height: 160,
                colorDark: '#0b0f19',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        }

        shareModal.classList.remove('hidden');
    }

    shareModalClose.addEventListener('click', () => shareModal.classList.add('hidden'));

    // Copy Handlers
    function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMsg, 'success');
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    }

    copyRoomIdBtn.addEventListener('click', () => {
        if (currentRoomId) copyToClipboard(currentRoomId, 'Room ID copied!');
    });

    roomIdContainer.addEventListener('click', (e) => {
        if (e.target !== copyRoomIdBtn && currentRoomId) {
            copyToClipboard(currentRoomId, 'Room ID copied!');
        }
    });

    welcomeCopyBtn.addEventListener('click', () => {
        if (currentRoomId) {
            const link = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}`;
            copyToClipboard(link, 'Invite link copied!');
        }
    });

    copyModalIdBtn.addEventListener('click', () => {
        copyToClipboard(shareRoomIdInput.value, 'Room ID copied!');
    });

    copyModalLinkBtn.addEventListener('click', () => {
        copyToClipboard(shareRoomLinkInput.value, 'Invite link copied!');
    });

    // Participants Sidebar Toggle
    participantsToggleBtn.addEventListener('click', () => {
        participantsSidebar.classList.toggle('hidden');
    });

    closeSidebarBtn.addEventListener('click', () => {
        participantsSidebar.classList.add('hidden');
    });

    // Sound Toggle
    soundToggle.addEventListener('change', (e) => {
        soundEnabled = e.target.checked;
    });

    // Lightbox for image preview
    window.previewImage = function (src) {
        if (typeof src === 'string' && src.startsWith('data:image/')) {
            lightboxImg.src = src;
            lightboxModal.classList.remove('hidden');
        }
    };

    lightboxClose.addEventListener('click', () => {
        lightboxModal.classList.add('hidden');
        lightboxImg.src = '';
    });

    lightboxModal.addEventListener('click', (e) => {
        if (e.target === lightboxModal) {
            lightboxModal.classList.add('hidden');
            lightboxImg.src = '';
        }
    });

    // Utilities
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function linkify(text) {
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #818cf8; text-decoration: underline;">${url}</a>`);
    }

    function formatBytes(bytes, decimals = 1) {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

})();
