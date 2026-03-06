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