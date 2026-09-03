self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Laundrivery',
    body: 'Ada update baru.',
    url: '/customer/dashboard',
    icon: '/icon-192.png',
    kind: '',
    tag: ''
  };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    try {
      const text = event.data ? event.data.text() : '';
      if (text) payload.body = text;
    } catch {
      /* ignore */
    }
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const appVisible = list.some((c) => c.visibilityState === 'visible');
      const isChat = payload.kind === 'customer_chat' || payload.tag === 'customer-chat';
      if (appVisible && isChat) return;
      return self.registration.showNotification(payload.title || 'Laundrivery', {
        body: payload.body || '',
        icon: payload.icon || '/icon-192.png',
        badge: '/icon-192.png',
        tag: payload.tag || payload.kind || 'laundrivery',
        renotify: true,
        vibrate: [140, 80, 140],
        data: { url: payload.url || '/customer/dashboard' }
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/customer/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
