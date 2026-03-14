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

7. Sender select a file to send to peer.

8. The receiver receives a popup request to accept the file offer.

9. Files are transferred in **chunks through the WebRTC DataChannel** into the browser's configured download directory.

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




---

# DEVELOPMENT
## Run

Install dependencies and start dev server:

```bash
npm install
npx ng serve
```

Development uses the default local backend URL; no environment variable is needed.

---

## Production

Create a `.env` file in the project root (or configure via your hosting provider) with the production backend URL:

```env
NG_APP_HUB_URL=https://your-production-server/hub
```

Then build the app:

```bash
npm run build --production
```

The frontend will use the value from the `.env` file to connect to the production backend.

## Security Headers (`vercel.json`)

> **Note:** Security headers are configured at the server/hosting level and are platform-specific. The current setup uses `vercel.json` for Vercel. If migrating to a different host, recreate these headers in the appropriate config file.
> 
> | Platform | Config Location |
> |---|---|
> | Vercel | `vercel.json` |
> | Netlify | `netlify.toml` or `_headers` |
> | IIS | `web.config` |
> | Nginx | `nginx.conf` |
> | Apache | `.htaccess` |
> | ASP.NET | `Program.cs` middleware |
> | Local dev | `angular.json` → `serve.options.headers` |

| Header | Value | Purpose | Details |
|---|---|---|---|
| Content-Security-Policy | see `vercel.json` | Prevents XSS | Whitelists approved sources for scripts, styles, fonts and connections. Blocks anything not explicitly allowed. |
| X-Content-Type-Options | nosniff | Prevents MIME sniffing | Forces browser to trust the declared Content-Type header. Stops browser from guessing file types and potentially executing malicious code disguised as another file type. |
| Referrer-Policy | strict-origin-when-cross-origin | Protects user privacy | When a user navigates away from Whispr, only the domain is sent to the destination — never the full URL or any query parameters. |
| X-Frame-Options | DENY | Prevents clickjacking | Blocks other websites from embedding Whispr inside an iframe. Prevents attackers from overlaying invisible frames to trick users into unintended actions. |


## SEO & Meta
- Meta tags and JSON-LD in `src/index.html`


## Analytics
The gtag ID in src/index.html is tied to the original project's Google Analytics property. If you're forking or self-hosting, replace G-XXXXXXXXXX with your own Google Analytics Measurement ID or remove the gtag script entirely if you don't need analytics (see below).
```

  <script async src="https://www.googletagmanager.com/gtag/js?id=G-MJG4NRL8JM"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    gtag('js', new Date());

    gtag('config', 'G-MJG4NRL8JM');
  </script>

```
