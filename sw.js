// sw.js — Service Worker para Saki Sushi
// Maneja: notificaciones push entrantes (vía VAPID) y
//         notificaciones locales solicitadas por la página cuando está en segundo plano.

const CACHE_NAME = 'saki-sushi-v1';

// ─────────────────────────────────────────
// INSTALACIÓN Y ACTIVACIÓN
// ─────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Instalado');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activado');
    event.waitUntil(clients.claim());
});

// ─────────────────────────────────────────
// NOTIFICACIONES PUSH (servidor → dispositivo)
// Disparadas por la Edge Function send-push vía VAPID.
// ─────────────────────────────────────────
self.addEventListener('push', (event) => {
    console.log('[SW] Push recibido');

    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { titulo: '🍣 Saki Sushi', mensaje: event.data ? event.data.text() : 'Nueva notificación' };
    }

    const titulo  = data.titulo  || '🍣 Saki Sushi';
    const mensaje = data.mensaje || 'Tienes una nueva notificación';
    const url     = data.url     || '/Cliente/';
    const icon    = data.icon    || 'https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm';
    const badge   = data.badge   || 'https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm';

    const options = {
        body:    mensaje,
        icon:    icon,
        badge:   badge,
        vibrate: [200, 100, 200],
        tag:     'saki-notif-' + (data.pedido_id || Date.now()),
        renotify: true,
        data: { url, pedido_id: data.pedido_id, tipo: data.tipo },
        actions: [
            { action: 'ver', title: '👁 Ver pedido' },
            { action: 'cerrar', title: 'Cerrar' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(titulo, options)
    );
});

// ─────────────────────────────────────────
// NOTIFICACIONES LOCALES (página en segundo plano → SW)
// La página detecta una notificación nueva vía polling y
// le envía un postMessage al SW para que la muestre.
// ─────────────────────────────────────────
self.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'SHOW_LOCAL_NOTIFICATION') {
        const titulo  = event.data.titulo  || '🍣 Saki Sushi';
        const mensaje = event.data.mensaje || 'Tienes una nueva notificación';
        const url     = event.data.url     || '/Cliente/';
        const tipo    = event.data.tipo    || 'info';

        const options = {
            body:    mensaje,
            icon:    'https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm',
            badge:   'https://lh3.googleusercontent.com/pw/AP1GczPrZAoWxmsOGRD9xl1hO5Q65JXuwUZzoR6gUk-cw5lVmarxQe_-lwqpA60tTKLlXfpvIjAJlKC6jFls-xETJOPkebLIIPhbGlUkknmhrRbdhMUll2UViGSUj3WmHKg2YEsZlAfxBPPTjIHhScjD0jfe=w1439-h1439-s-no-gm',
            vibrate: [200, 100, 200],
            silent:  false,
            tag:     'saki-local-' + Date.now(),
            renotify: true,
            data: { url, tipo },
            actions: [
                { action: 'ver', title: '👁 Ver pedido' },
                { action: 'cerrar', title: 'Cerrar' }
            ]
        };

        event.waitUntil(
            self.registration.showNotification(titulo, options)
        );
    }
});

// ─────────────────────────────────────────
// CLIC EN NOTIFICACIÓN
// Abre o enfoca la pestaña del cliente al hacer clic.
// ─────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'cerrar') return;

    const urlDestino = event.notification.data?.url || '/Cliente/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Si ya hay una pestaña abierta con esa URL, la enfocamos
            for (const client of clientList) {
                if (client.url.includes('/Cliente/') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no hay ninguna, abrimos una nueva
            if (clients.openWindow) {
                return clients.openWindow(urlDestino);
            }
        })
    );
});
