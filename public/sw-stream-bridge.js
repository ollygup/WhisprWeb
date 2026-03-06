const map = new Map();

// Read intercept path from registration URL at startup
const swUrl = new URL(self.location.href);
const INTERCEPT_PATH = swUrl.searchParams.get('interceptPath');

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(INTERCEPT_PATH)) return;

  const id = url.pathname.split(INTERCEPT_PATH)[1];

  const stream = new ReadableStream({
    start(controller) {
      map.set(id, controller);
    }
  });

  event.respondWith(new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${url.searchParams.get('name')}"`,
      'Content-Length': url.searchParams.get('size')
    }
  }));
});

self.addEventListener('message', event => {
  const { id, chunk, done } = event.data;
  const controller = map.get(id);
  if (!controller) return;

  done ? (controller.close(), map.delete(id))
       : controller.enqueue(new Uint8Array(chunk));
});

// How it works
// 1. a.click()
//    → browser makes a fetch request to /sw-download/abc-123
//    → SW intercepts it, creates a ReadableStream
//    → stores its controller in map under "abc-123"
//    → returns Response(stream) → browser opens Save dialog
//    → stream is now OPEN and WAITING

// 2. chunks arrive over WebRTC
//    → postMessage({ id: "abc-123", chunk, done: false })
//    → SW message listener: map.get("abc-123") → controller
//    → controller.enqueue(new Uint8Array(chunk))
//    → bytes flow into the browser's download

// 3. sender sends transfer-complete
//    → finaliseDownload() calls postMessage({ done: true })
//    → controller.close()
//    → browser sees stream end → file download completes
//    → map.delete("abc-123") → cleanup