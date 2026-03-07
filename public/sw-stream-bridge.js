const map = new Map();

// Read intercept path from registration URL at startup
const swUrl = new URL(self.location.href);
const INTERCEPT_PATH = swUrl.searchParams.get('interceptPath');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  map.clear();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(INTERCEPT_PATH)) return;

  const id = url.pathname.split(INTERCEPT_PATH)[1];

  // Creates a ReadableStream that keeps the response body open indefinitely
  const stream = new ReadableStream({
    start(controller) {
      map.set(id, controller);
      // Tell the page the stream is ready to receive chunks
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'stream-ready', id }))
      );
    },
    // Cancel/Abort download from browser's download manager will trigger this
    cancel(reason) {
      map.delete(id);
      // Notify the page so it can tell the sender to stop transmitting
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ 
          type: 'transfer-cancelled', 
          id 
        }));
      });
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

// triggered by PostMessage (receiver's end)
self.addEventListener('message', event => {
  const { id, chunk, done, cancel } = event.data;
  const controller = map.get(id);
  if (!controller) return;

  // App-initiated cancel — abort the stream and clean up
  if (cancel) {
    try { controller.error('cancelled'); } catch { }
    map.delete(id);
    return;
  }

  try {
    done ? (controller.close(), map.delete(id))
         : controller.enqueue(new Uint8Array(chunk));
  } catch (err) {
    map.delete(id);
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'transfer-failed', id }))
    );
  }
});