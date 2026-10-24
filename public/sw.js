// Service worker: receives push notifications, runs their action buttons, and opens the app when one is tapped.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Plant Care', body: 'You have plants to check today.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      actions: Array.isArray(data.actions) ? data.actions : [],
      data: { url: data.url || '/', ids: data.ids || [] },
    }),
  );
});

async function runAction(action, ids) {
  try {
    const res = await fetch('/api/push-action', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ids }),
    });
    if (!res.ok || res.redirected) return false;
    await self.registration.showNotification('Plant Care', {
      body: action === 'water' ? 'Marked as watered.' : 'Snoozed until tomorrow.',
      tag: 'action-result',
      icon: '/icons/icon-192.png',
      silent: true,
    });
    return true;
  } catch {
    return false;
  }
}

function openApp(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const w of windows) {
      if ('focus' in w) {
        w.navigate(url);
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = d.url || '/';
  if ((event.action === 'water' || event.action === 'snooze') && (d.ids || []).length > 0) {
    event.waitUntil(runAction(event.action, d.ids).then((ok) => (ok ? undefined : openApp(url))));
    return;
  }
  event.waitUntil(openApp(url));
});
