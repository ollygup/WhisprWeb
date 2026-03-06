# Whispr

Secure peer-to-peer file transfer using WebRTC.

No cloud storage.  
No middleware.  
Files move directly between browsers.

## Features

- End-to-end encrypted transfer
- Direct P2P using WebRTC
- SignalR used only for signaling
- No file persistence on server



```
Sender Browser
     │
     │ SignalR (signaling only)
     ▼
Receiver Browser
     │
     ▼
Direct WebRTC DataChannel (file transfer)
```
