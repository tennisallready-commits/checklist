const CACHE_NAME = 'checklist-cache-v9.04';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=7.92',
  './app.js?v=8.86',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  './vendor/lucide.min.js?v=1.24.0',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
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
  // Non-GET requests should not be cached
  if (e.request.method !== 'GET') return;
  // Only intercept HTTP/HTTPS requests
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // If response is valid, clone and save to cache
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(e.request);
      })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = event.notification.data && event.notification.data.taskId;
  const inviteId = event.notification.data && event.notification.data.inviteId;
  const notificationType = event.notification.data && event.notification.data.notificationType;
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : (taskId ? `./?notification_task=${encodeURIComponent(taskId)}` : './');
  const absoluteTargetUrl = new URL(targetUrl, self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => 'focus' in client);
      if (existingClient) {
        existingClient.postMessage(taskId
          ? { type: notificationType === 'task-reminder' ? 'OPEN_TASK_REMINDER' : 'OPEN_SHARED_TASK', taskId }
          : inviteId ? { type: 'OPEN_COLLABORATION_INVITE', inviteId } : { type: 'OPEN_NOTIFICATIONS' });
        return existingClient.focus();
      }
      return clients.openWindow(absoluteTargetUrl);
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Nova tarefa compartilhada';
  const options = {
    body: payload.body || 'Uma nova tarefa foi adicionada ao seu checklist.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: payload.tag || `shared-task-${payload.task_id || Date.now()}`,
    data: { taskId: payload.task_id || null, inviteId: payload.invite_id || null, notificationType: payload.notification_type || null, url: payload.url || './' },
    vibrate: [180, 80, 180]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
