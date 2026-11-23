const CACHE_NAME = 'zalocrm-cache-v4';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Network-First for HTML/document requests (always fetch latest index.html if online)
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, res.clone());
            return res;
          });
        })
        .catch(() => {
          return caches.match(e.request);
        })
    );
    return;
  }

  // Cache-First for static assets (CSS, JS, images, manifest)
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((res) => {
        // Cache static assets (images, css, js, fonts)
        if (res.status === 200 && (
          url.pathname.startsWith('/assets/') ||
          url.pathname.endsWith('.png') ||
          url.pathname.endsWith('.svg') ||
          url.pathname.endsWith('.webmanifest')
        )) {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, res.clone());
            return res;
          });
        }
        return res;
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client && 'navigate' in client) {
          client.focus();
          return client.navigate(targetUrl);
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('push', (event) => {
  let title = 'Tin nhắn mới';
  let body = '';
  let url = '/chat';
  
  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || 'Tin nhắn mới';
      body = data.body || '';
      url = data.url || '/chat';
    } catch (err) {
      body = event.data.text() || '';
    }
  }
  
  const options = {
    body: body,
    icon: '/logo_pwa_192.png',
    badge: '/logo_pwa_192.png',
    tag: 'zalo-crm-msg',
    renotify: true,
    data: {
      url: url
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});



