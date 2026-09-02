self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  let data = { title: 'Placer Studios', body: 'Una modelo está en línea.' };
  if (event.data) {
    try { data = event.data.json(); } catch (e) {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Placer Studios', {
      body: data.body || '',
      icon: '/logo-placer-studios.svg',
      badge: '/logo-placer-studios.svg',
      tag: 'placer-online',
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
