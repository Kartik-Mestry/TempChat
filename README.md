# 🔥 TempChat — Temporary & Ephemeral Chat Rooms

A lightweight, modern, zero-trace temporary chat web application built with **Node.js**, **Express**, and **Socket.io**.

---

## ✨ Features

- **Randomized Room IDs**: Memorable, unique auto-generated IDs (e.g. `amber-haven-428` or `cosmic-falcon-712`).
- **Instant Sharing**:
  - 1-click **Copy Room ID**
  - 1-click **Copy Invite Link** (automatically opens the join tab with the ID pre-filled)
  - Auto-generated **QR Code** for quick mobile scanning
- **100% Ephemeral & Private**:
  - **In-Memory Only**: Zero database or disk persistence.
  - **Self-Destruct Timer**: Rooms automatically expire after the configured time (15 mins, 30 mins, 1 hr, 3 hrs, 24 hrs).
  - **Host Burn Button**: Host can instantly wipe and destroy the room for all users at any moment.
  - **Auto-Cleanup**: Rooms are immediately purged from memory once all users leave.
- **Rich Real-Time Chat**:
  - Real-time messages with timestamps and user color tags.
  - Live typing indicator (`Alice is typing...`).
  - Active participant drawer with online count.
  - Image and file sharing (up to 8MB) with in-browser lightbox image preview and file downloads.
  - Sound synthesis via Web Audio API (gentle audio chime on new message, no external assets required).
  - Host badge (`HOST`) and automatic host election if the host disconnects while others remain.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The server will start on: **[http://localhost:3000](http://localhost:3000)**

---

## 👥 How to Use

1. **Host**:
   - Open [http://localhost:3000](http://localhost:3000).
   - Enter your nickname, pick an avatar color, choose an expiry duration, and click **"Generate & Enter Room"**.
   - Click **"Share"** in the top bar to copy your invite link, room code, or display the QR code.
2. **Guest**:
   - Open the shared invite link (or enter [http://localhost:3000](http://localhost:3000) and paste the Room ID into the "Join with ID" tab).
   - Enter your nickname and join the chat instantly!
