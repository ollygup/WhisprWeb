const map = new Map();          // id -> controller
const pendingPulls = new Map(); // id -> { controller, resolve }

const swUrl = new URL(self.location.href);
const INTERCEPT_PATH = swUrl.searchParams.get('interceptPath');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  map.clear();
  pendingPulls.clear();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(INTERCEPT_PATH)) return;

  const id = url.pathname.split(INTERCEPT_PATH)[1];

  const stream = new ReadableStream({
    start(controller) {
      map.set(id, controller);
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'stream-ready', id }))
      );
    },

    // Browser calls pull() when ready for the next chunk.
    // Browser pause (download manager) -> pull() stops firing naturally.
    // Browser resume -> pull() fires again
    pull(controller) {
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'request-chunk', id }))
      );

      return new Promise(resolve => {
        pendingPulls.set(id, { controller, resolve });
      });
    },

    // Fires on browser cancel (from browser's download manager)
    cancel() {
      map.delete(id);
      pendingPulls.delete(id);
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'transfer-cancelled', id }))
      );
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
  const { id, chunk, done, cancel } = event.data;
  const controller = map.get(id);
  if (!controller) return;

  // App-level cancel
  if (cancel) {
    try { controller.error('cancelled'); } catch {}
    map.delete(id);
    pendingPulls.delete(id);
    return;
  }

  processChunk(id, chunk, done);
});

function processChunk(id, chunk, done) {
  const controller = map.get(id);
  const pending = pendingPulls.get(id);

  try {
    if (done) {
      controller.close();
      map.delete(id);
      pendingPulls.delete(id);
      pending?.resolve();
    } else if (pending) {
      pending.controller.enqueue(new Uint8Array(chunk));
      pendingPulls.delete(id);
      pending.resolve(); // browser may now call pull() again
    }
  } catch (err) {
    map.delete(id);
    pendingPulls.delete(id);
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'transfer-failed', id }))
    );
  }
}