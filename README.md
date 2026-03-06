# Whispr

**Peer-to-peer file transfer using WebRTC.**

Files are transferred **directly between browsers**.  
The backend is used **only for signaling and session coordination**.

No files pass through or are stored on the server.

---

## How It Works

1. A user opens the app and enters a display name.

2. The client establishes a **WebSocket connection** to the backend signaling server.

3. The server creates a **session (WebSocket group)** and the frontend generates a **QR code** containing the session URL.

4. A second user scans the QR code and joins the session.

5. **WebRTC negotiation** begins through the signaling server.

6. Once the peer connection is established, a **WebRTC DataChannel** is created.

7. Users select whether they want to **send** or **receive** files.

8. The receiver configures a **download directory**.

9. Files are transferred in **chunks through the WebRTC DataChannel**.

Transfer speed is limited by the **slowest network connection between the two peers**.

---

## Architecture

| Component | Technology |
|-----------|------------|
| Frontend  | Angular |
| Backend   | ASP.NET Core |
| Signaling | SignalR (WebSocket) |
| Transfer  | WebRTC DataChannel |

---

## Notes

- The backend **only relays signaling messages** (SDP and ICE candidates).
- **File data never passes through the server.**
- Transfers occur **directly between peers**.
