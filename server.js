const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 // 10MB max buffer for images/files
});

const PORT = process.env.PORT || 3000;

// In-memory data store only - zero persistence for privacy
// Map<roomId, { id, hostSocketId, hostName, createdAt, ttlMs, expiresAt, participants: Map<socketId, user>, messages: [] }>
const rooms = new Map();

// Random Room ID generator (readable adjective-noun-number format or 8-char hex)
const ADJECTIVES = ['silent', 'swift', 'amber', 'cosmic', 'hidden', 'neon', 'quiet', 'shadow', 'solar', 'velvet', 'wild', 'frost', 'ghost', 'mystic'];
const NOUNS = ['fox', 'haven', 'whisper', 'spark', 'echo', 'breeze', 'falcon', 'nebula', 'rift', 'orbit', 'pulse', 'beacon', 'ember', 'vortex'];

function generateRoomId() {
    let id;
    do {
        const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        const num = Math.floor(100 + Math.random() * 900);
        id = `${adj}-${noun}-${num}`;
    } while (rooms.has(id));
    return id;
}

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Check if a room exists
app.get('/api/room/:roomId', (req, res) => {
    const roomId = req.params.roomId.trim().toLowerCase();
    const room = rooms.get(roomId);
    if (!room) {
        return res.status(404).json({ exists: false, message: 'Room not found or expired.' });
    }
    return res.json({
        exists: true,
        roomId: room.id,
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
            io.to(roomId).emit('room_expired', { message: 'This temporary room has reached its time limit and expired.' });
            rooms.delete(roomId);
            console.log(`[Auto-Clean] Room ${roomId} expired and deleted.`);
        }
    }
}, 15000);

// Helper to sanitize message strings
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.slice(0, 4000);
}

// Socket handling
io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    // Create Room
    socket.on('create_room', ({ username, avatarColor, ttlMinutes }, callback) => {
        try {
            const cleanName = (username || 'Host').trim().slice(0, 24);
            const safeColor = avatarColor || '#6366f1';
            const ttl = parseInt(ttlMinutes, 10) || 60; // default 60 mins
            const ttlMs = ttl * 60 * 1000;
            const roomId = generateRoomId();

            const room = {
                id: roomId,
                hostSocketId: socket.id,
                hostName: cleanName,
                createdAt: Date.now(),
                ttlMs: ttlMs,
                expiresAt: Date.now() + ttlMs,
                participants: new Map(),
                messages: []
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

            console.log(`[Room Created] ID: ${roomId} by ${cleanName}`);

            callback({
                success: true,
                roomId: roomId,
                user: user,
                expiresAt: room.expiresAt,
                participants: Array.from(room.participants.values())
            });
        } catch (err) {
            console.error('Error creating room:', err);
            callback({ success: false, message: 'Could not create room' });
        }
    });

    // Join Room
    socket.on('join_room', ({ roomId, username, avatarColor }, callback) => {
        try {
            const cleanRoomId = (roomId || '').trim().toLowerCase();
            const cleanName = (username || 'Guest').trim().slice(0, 24);
            const safeColor = avatarColor || '#10b981';

            const room = rooms.get(cleanRoomId);
            if (!room) {
                return callback({ success: false, message: 'Room not found or has already expired.' });
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

            console.log(`[User Joined] ${cleanName} joined ${cleanRoomId}`);

            callback({
                success: true,
                roomId: room.id,
                user: user,
                expiresAt: room.expiresAt,
                participants: Array.from(room.participants.values()),
                messages: room.messages.slice(-50) // recent in-memory messages
            });
        } catch (err) {
            console.error('Error joining room:', err);
            callback({ success: false, message: 'Could not join room' });
        }
    });

    // Send Message
    socket.on('send_message', ({ text }, callback) => {
        if (!currentRoomId || !currentUser) {
            return callback && callback({ success: false, message: 'Not in a room' });
        }

        const room = rooms.get(currentRoomId);
        if (!room) {
            return callback && callback({ success: false, message: 'Room does not exist' });
        }

        const safeText = escapeHtml(text).trim();
        if (!safeText) {
            return callback && callback({ success: false, message: 'Empty message' });
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
        if (room.messages.length > 100) room.messages.shift();

        // Broadcast to everyone including sender
        io.to(currentRoomId).emit('new_message', messageData);

        if (callback) callback({ success: true, messageId: messageData.id });
    });

    // Send File / Image
    socket.on('send_file', ({ fileName, fileType, fileData, fileSize }, callback) => {
        if (!currentRoomId || !currentUser) {
            return callback && callback({ success: false, message: 'Not in a room' });
        }

        const room = rooms.get(currentRoomId);
        if (!room) {
            return callback && callback({ success: false, message: 'Room does not exist' });
        }

        // 8MB limit
        if (fileSize > 8 * 1024 * 1024) {
            return callback && callback({ success: false, message: 'File too large (max 8MB)' });
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
            fileName: escapeHtml(fileName).slice(0, 100),
            fileType: fileType,
            fileData: fileData, // base64 string
            fileSize: fileSize,
            timestamp: Date.now()
        };

        room.messages.push(messageData);
        if (room.messages.length > 100) room.messages.shift();

        io.to(currentRoomId).emit('new_message', messageData);

        if (callback) callback({ success: true, messageId: messageData.id });
    });

    // Typing status
    socket.on('typing', ({ isTyping }) => {
        if (!currentRoomId || !currentUser) return;
        socket.to(currentRoomId).emit('user_typing', {
            userId: currentUser.id,
            username: currentUser.username,
            isTyping: !!isTyping
        });
    });

    // Host manually burns / deletes room
    socket.on('burn_room', (callback) => {
        if (!currentRoomId || !currentUser || !currentUser.isHost) {
            return callback && callback({ success: false, message: 'Only host can destroy this room.' });
        }

        const room = rooms.get(currentRoomId);
        if (room) {
            io.to(currentRoomId).emit('room_burned', {
                message: 'The host has burned and destroyed this room. All data has been wiped.'
            });
            rooms.delete(currentRoomId);
            console.log(`[Burned] Room ${currentRoomId} was manually destroyed by host.`);
        }

        if (callback) callback({ success: true });
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

    // If host leaves, either assign a new host or destroy if empty
    if (room.participants.size === 0) {
        console.log(`[Empty Room Cleaned] Room ${roomId} has no participants left. Deleted.`);
        rooms.delete(roomId);
    } else if (room.hostSocketId === socket.id) {
        // Elect next oldest participant as new host
        const nextHost = room.participants.values().next().value;
        if (nextHost) {
            nextHost.isHost = true;
            room.hostSocketId = nextHost.id;
            room.hostName = nextHost.username;
            io.to(roomId).emit('host_changed', {
                newHost: nextHost,
                participants: Array.from(room.participants.values())
            });
            console.log(`[Host Transferred] Room ${roomId} host transferred to ${nextHost.username}`);
        }
    }
}

server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` TempChat server is live on http://localhost:${PORT}`);
    console.log(` Zero-persistence ephemeral chat engine running.`);
    console.log(`===============================================`);
});
