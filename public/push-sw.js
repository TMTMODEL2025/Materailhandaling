/* Service Worker for Background Web Push Notifications */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {
    title: '🔔 มีรายการแจ้งซ่อมใหม่!',
    body: 'มีรายการแจ้งซ่อมใหม่เข้ามาในระบบ กรุณาตรวจสอบ',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'repair-push-' + Date.now(),
    url: '/?tab=repair',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (e) {
      try {
        payload.body = event.data.text() || payload.body;
      } catch (_) {
        // ignore
      }
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/pwa-192x192.png',
    tag: payload.tag || 'repair-notification',
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 120, 300, 120, 400],
    data: {
      url: payload.url || '/?tab=repair',
      vehicle: payload.vehicle || '',
      symptom: payload.symptom || '',
      reporter: payload.reporter || '',
      sequenceNo: payload.sequenceNo || '',
    },
    actions: [
      {
        action: 'open',
        title: 'เปิดดูรายการแจ้งซ่อม',
      },
    ],
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, options),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({
              type: 'PUSH_REPAIR_RECEIVED',
              payload,
            });
          }
        })
        .catch(() => {}),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/?tab=repair';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({
              type: 'OPEN_REPAIR_TAB',
              payload: event.notification.data || {},
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
