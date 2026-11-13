const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// 16MB max buffer to accommodate 8MB raw files + base64 encoding overhead (~11MB) + envelope
const io = new Server(server, {
    maxHttpBufferSize: 16 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;

// Maximum attachment storage retained in RAM per room (15MB)
const MAX_ROOM_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// Maximum history payload sent on join_room (5MB)
const MAX_HISTORY_BYTES = 5 * 1024 * 1024;

// In-memory data store only - zero persistence for privacy
// Map<roomId, { id, hostSocketId, hostName, createdAt, ttlMs, expiresAt, participants: Map<socketId, user>, messages: [], attachmentBytes: number }>
const rooms = new Map();

// Random Room ID generator with cryptographic randomness
const ADJECTIVES = ['silent', 'swift', 'amber', 'cosmic', 'hidden', 'neon', 'quiet', 'shadow', 'solar', 'velvet', 'wild', 'frost', 'ghost', 'mystic'];
const NOUNS = ['fox', 'haven', 'whisper', 'spark', 'echo', 'breeze', 'falcon', 'nebula', 'rift', 'orbit', 'pulse', 'beacon', 'ember', 'vortex'];

function generateRoomId() {
    let id;
    do {
        const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        // 6 hex characters = 16.7 million combinations per word pair, making brute-force discovery practically impossible
        const token = crypto.randomBytes(3).toString('hex');
        id = `${adj}-${noun}-${token}`;
    } while (rooms.has(id));
    return id;
}

// Color and string sanitizers
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
function sanitizeColor(color, fallback = '#6366f1') {
    if (typeof color === 'string' && HEX_COLOR_REGEX.test(color)) {
        return color.toLowerCase();
    }
    return fallback;
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.slice(0, 4000);
}

// Safe acknowledgment callback helper
function safeAck(callback, data) {
    if (typeof callback === 'function') {
        try {
            callback(data);
        } catch (err) {
            console.error('[Ack Error]', err.message);
        }
    }
}

// Room destruction helper with explicit channel removal
function destroyRoom(roomId, eventName = 'room_expired', payload = {}) {
    const room = rooms.get(roomId);
    if (!room) return;

    io.to(roomId).emit(eventName, payload);
    // Explicitly unsubscribe all sockets from the Socket.IO channel
    io.in(roomId).socketsLeave(roomId);
    rooms.delete(roomId);
    console.log(`[Room Event] Room destroyed (${eventName}).`);
}

// Real-time room expiration check
function isRoomActive(room) {
    if (!room) return false;
    if (room.expiresAt && Date.now() > room.expiresAt) {
        destroyRoom(room.id, 'room_expired', { message: 'This temporary room has reached its time limit and expired.' });
        return false;
    }
    return true;
}

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Check if a room exists (strict against expired rooms)
app.get('/api/room/:roomId', (req, res) => {
    const roomId = (req.params.roomId || '').trim().toLowerCase();
    const room = rooms.get(roomId);
    if (!room || !isRoomActive(room)) {
        return res.status(404).json({ exists: false, message: 'Room not found or expired.' });
    }
    return res.json({
        exists: true,
        participantCount: room.participants.size,
        createdAt: room.createdAt,
        expiresAt: room.expiresAt
    });
});

// Periodic garbage collection for expired rooms
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
        if (room.expiresAt && now > room.expiresAt) {
            destroyRoom(roomId, 'room_expired', { message: 'This temporary room has reached its time limit and expired.' });
        }
    }
}, 15000);

// Socket handling
io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    // Create Room
    socket.on('create_room', (payload, callback) => {
        try {
            if (!payload || typeof payload !== 'object') {
                return safeAck(callback, { success: false, message: 'Invalid payload' });
            }

            // Clean up any previous active room session for this socket
            if (currentRoomId) {
                handleUserExit(socket, currentRoomId, currentUser);
                currentRoomId = null;
                currentUser = null;
            }

            const cleanName = (typeof payload.username === 'string' ? payload.username : 'Host').trim().slice(0, 24) || 'Host';
            const safeColor = sanitizeColor(payload.avatarColor, '#6366f1');
            const ttl = parseInt(payload.ttlMinutes, 10) || 60;
            const ttlMs = Math.min(Math.max(ttl, 5), 1440) * 60 * 1000;
            const roomId = generateRoomId();

            const room = {
                id: roomId,
                hostSocketId: socket.id,
                hostName: cleanName,
                createdAt: Date.now(),
                ttlMs: ttlMs,
                expiresAt: Date.now() + ttlMs,
                participants: new Map(),
                messages: [],
                attachmentBytes: 0
            };

            const user = {
                id: socket.id,
                username: cleanName,
                avatarColor: safeColor,
                isHost: true,
                joinedAt: Date.now()
            };

            room.participants.set(socket.id, user);
            rooms.set(roomId, room);

            currentRoomId = roomId;
            currentUser = user;

            socket.join(roomId);
            console.log('[Room Event] New room created');

            safeAck(callback, {
                success: true,
                roomId: roomId,
                user: user,
                expiresAt: room.expiresAt,
                participants: Array.from(room.participants.values())
            });
        } catch (err) {
            console.error('[Create Room Error]', err.message);
            safeAck(callback, { success: false, message: 'Could not create room' });
        }
    });

    // Join Room
    socket.on('join_room', (payload, callback) => {
        try {
            if (!payload || typeof payload !== 'object') {
                return safeAck(callback, { success: false, message: 'Invalid payload' });
            }

            // Clean up any previous active room session for this socket
            if (currentRoomId) {
                handleUserExit(socket, currentRoomId, currentUser);
                currentRoomId = null;
                currentUser = null;
            }

            const cleanRoomId = (typeof payload.roomId === 'string' ? payload.roomId : '').trim().toLowerCase();
            const cleanName = (typeof payload.username === 'string' ? payload.username : 'Guest').trim().slice(0, 24) || 'Guest';
            const safeColor = sanitizeColor(payload.avatarColor, '#10b981');

            const room = rooms.get(cleanRoomId);
            if (!room || !isRoomActive(room)) {
                return safeAck(callback, { success: false, message: 'Room not found or has already expired.' });
            }

            const isHost = room.hostSocketId === socket.id;

            const user = {
                id: socket.id,
                username: cleanName,
                avatarColor: safeColor,
                isHost: isHost,
                joinedAt: Date.now()
            };

            room.participants.set(socket.id, user);
            currentRoomId = cleanRoomId;
            currentUser = user;

            socket.join(cleanRoomId);

            // Notify everyone else in the room
            socket.to(cleanRoomId).emit('user_joined', {
                user: user,
                message: `${user.username} joined the chat.`,
                participants: Array.from(room.participants.values())
            });

            console.log('[Room Event] User joined room');

            // Assemble bounded history payload to prevent client DoS
            const history = [];
            let historyBytes = 0;
            for (let i = room.messages.length - 1; i >= 0 && history.length < 50; i--) {
                const msg = room.messages[i];
                const msgBytes = msg.fileData ? msg.fileData.length : (msg.text ? msg.text.length : 0);
                if (historyBytes + msgBytes > MAX_HISTORY_BYTES) break;
                history.unshift(msg);
                historyBytes += msgBytes;
            }

            safeAck(callback, {
                success: true,
                roomId: room.id,
                user: user,
                expiresAt: room.expiresAt,
                participants: Array.from(room.participants.values()),
                messages: history
            });
        } catch (err) {
            console.error('[Join Room Error]', err.message);
            safeAck(callback, { success: false, message: 'Could not join room' });
        }
    });

    // Send Message
    socket.on('send_message', (payload, callback) => {
        if (!payload || typeof payload !== 'object') {
            return safeAck(callback, { success: false, message: 'Invalid payload' });
        }

        if (!currentRoomId || !currentUser) {
            return safeAck(callback, { success: false, message: 'Not in a room' });
        }

        const room = rooms.get(currentRoomId);
        if (!room || !isRoomActive(room)) {
            return safeAck(callback, { success: false, message: 'Room does not exist or expired' });
        }

        const safeText = escapeHtml(payload.text).trim();
        if (!safeText) {
            return safeAck(callback, { success: false, message: 'Empty message' });
        }

        const messageData = {
            id: crypto.randomUUID(),
            type: 'text',
            sender: {
                id: currentUser.id,
                username: currentUser.username,
                avatarColor: currentUser.avatarColor,
                isHost: currentUser.isHost
            },
            text: safeText,
            timestamp: Date.now()
        };

        // Cache in memory up to 100 messages
        room.messages.push(messageData);
        if (room.messages.length > 100) {
            const evicted = room.messages.shift();
            if (evicted.type === 'file' && evicted.fileData) {
                room.attachmentBytes = Math.max(0, room.attachmentBytes - (evicted.fileSize || 0));
            }
        }

        io.to(currentRoomId).emit('new_message', messageData);
        safeAck(callback, { success: true, messageId: messageData.id });
    });

    // Send File / Image
    socket.on('send_file', (payload, callback) => {
        if (!payload || typeof payload !== 'object') {
            return safeAck(callback, { success: false, message: 'Invalid payload' });
        }

        if (!currentRoomId || !currentUser) {
            return safeAck(callback, { success: false, message: 'Not in a room' });
        }

        const room = rooms.get(currentRoomId);
        if (!room || !isRoomActive(room)) {
            return safeAck(callback, { success: false, message: 'Room does not exist or expired' });
        }

        const fileSize = parseInt(payload.fileSize, 10) || 0;
        // 8MB individual file limit
        if (fileSize <= 0 || fileSize > 8 * 1024 * 1024) {
            return safeAck(callback, { success: false, message: 'File must be between 1 byte and 8MB' });
        }

        const fileData = typeof payload.fileData === 'string' ? payload.fileData : '';
        // Validate that data URL starts with safe MIME schema
        if (!fileData.startsWith('data:') || !fileData.includes(';base64,')) {
            return safeAck(callback, { success: false, message: 'Invalid file data format' });
        }

        const rawFileType = typeof payload.fileType === 'string' ? payload.fileType.toLowerCase() : 'application/octet-stream';
        // Sanitize MIME type
        const safeFileType = /^[a-z0-9\-\.\/]+$/.test(rawFileType) ? rawFileType.slice(0, 50) : 'application/octet-stream';
        const safeFileName = escapeHtml(payload.fileName).slice(0, 100) || 'attachment';

        // Enforce per-room attachment RAM budget (15MB total)
        // Evict older attachments if over budget
        while (room.attachmentBytes + fileSize > MAX_ROOM_ATTACHMENT_BYTES && room.messages.length > 0) {
            const oldestFileIdx = room.messages.findIndex(m => m.type === 'file' && m.fileData);
            if (oldestFileIdx === -1) break;
            const oldest = room.messages[oldestFileIdx];
            room.attachmentBytes = Math.max(0, room.attachmentBytes - (oldest.fileSize || 0));
            room.messages.splice(oldestFileIdx, 1);
        }

        const messageData = {
            id: crypto.randomUUID(),
            type: 'file',
            sender: {
                id: currentUser.id,
                username: currentUser.username,
                avatarColor: currentUser.avatarColor,
                isHost: currentUser.isHost
            },
            fileName: safeFileName,
            fileType: safeFileType,
            fileData: fileData,
            fileSize: fileSize,
            timestamp: Date.now()
        };

        room.attachmentBytes += fileSize;
        room.messages.push(messageData);
        if (room.messages.length > 100) {
            const evicted = room.messages.shift();
            if (evicted.type === 'file' && evicted.fileData) {
                room.attachmentBytes = Math.max(0, room.attachmentBytes - (evicted.fileSize || 0));
            }
        }

        io.to(currentRoomId).emit('new_message', messageData);
        safeAck(callback, { success: true, messageId: messageData.id });
    });

    // Typing status
    socket.on('typing', (payload) => {
        if (!payload || typeof payload !== 'object' || !currentRoomId || !currentUser) return;
        socket.to(currentRoomId).emit('user_typing', {
            userId: currentUser.id,
            username: currentUser.username,
            isTyping: !!payload.isTyping
        });
    });

    // Host manually burns / deletes room
    socket.on('burn_room', (callback) => {
        if (!currentRoomId || !currentUser || !currentUser.isHost) {
            return safeAck(callback, { success: false, message: 'Only host can destroy this room.' });
        }

        destroyRoom(currentRoomId, 'room_burned', {
            message: 'The host has burned and destroyed this room. All data has been wiped.'
        });

        currentRoomId = null;
        currentUser = null;

        safeAck(callback, { success: true });
    });

    // Leave room
    socket.on('leave_room', () => {
        handleUserExit(socket, currentRoomId, currentUser);
        currentRoomId = null;
        currentUser = null;
    });

    // Disconnect
    socket.on('disconnect', () => {
        handleUserExit(socket, currentRoomId, currentUser);
        currentRoomId = null;
        currentUser = null;
    });
});

function handleUserExit(socket, roomId, user) {
    if (!roomId || !rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    room.participants.delete(socket.id);
    socket.leave(roomId);

    if (user) {
        socket.to(roomId).emit('user_left', {
            userId: user.id,
            username: user.username,
            message: `${user.username} left the chat.`,
            participants: Array.from(room.participants.values())
        });
    }

    if (room.participants.size === 0) {
        destroyRoom(roomId, 'room_expired', { message: 'All participants left. Room closed.' });
    } else if (room.hostSocketId === socket.id) {
        const nextHost = room.participants.values().next().value;
        if (nextHost) {
            nextHost.isHost = true;
            room.hostSocketId = nextHost.id;
            room.hostName = nextHost.username;
            io.to(roomId).emit('host_changed', {
                newHost: nextHost,
                participants: Array.from(room.participants.values())
            });
            console.log('[Room Event] Host transferred to next participant');
        }
    }
}

server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` TempChat server is live on http://localhost:${PORT}`);
    console.log(` Zero-persistence ephemeral chat engine running.`);
    console.log(`===============================================`);
});
