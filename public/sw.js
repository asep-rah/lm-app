self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', (event) => {
  // Pass-through fetch handler agar syarat PWA terpenuhi
  event.respondWith(fetch(event.request));
});