const CACHE_NAME = 'checklist-cache-v10.19';
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './style.css?v=8.30',
  './app.js?v=10.00',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/notification-badge.png',
  './vendor/lucide.min.js?v=1.24.0'
];
const OPTIONAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // No Safari, um único 404/redirect/erro de rede em `addAll` cancela a
      // instalação inteira e o worker nunca fica ativo. Cacheia cada recurso
      // isoladamente: notificações continuam funcionando mesmo se um asset
      // visual estiver temporariamente indisponível.
      await Promise.allSettled(CRITICAL_ASSETS.map(asset => cache.add(asset)));
      await Promise.allSettled(OPTIONAL_ASSETS.map(asset => cache.add(asset)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
  const target = new URL(absoluteTargetUrl);
  const opensTrainingReport = target.searchParams.get('training_calendar') === '1';
  const trainingDate = target.searchParams.get('training_date');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => 'focus' in client);
      if (existingClient) {
        if (opensTrainingReport) {
          existingClient.postMessage({ type: 'OPEN_TRAINING_REPORT', taskId, trainingDate });
          return existingClient.focus();
        }
        // No Android, o postMessage pode chegar enquanto o PWA ainda está
        // retomando. Usa somente a URL para não disparar duas rolagens.
        if ('navigate' in existingClient && absoluteTargetUrl.includes('?')) {
          return existingClient.navigate(absoluteTargetUrl).then((navigatedClient) => (navigatedClient || existingClient).focus());
        }
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
    icon: payload.icon || './icons/icon-192.png',
    badge: './icons/notification-badge.png',
    tag: payload.tag || `shared-task-${payload.task_id || Date.now()}`,
    data: { taskId: payload.task_id || null, inviteId: payload.invite_id || null, notificationType: payload.notification_type || null, url: payload.url || './' },
    vibrate: [180, 80, 180]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
