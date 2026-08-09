/*
 * Service Worker — macht die App offline spielbar.
 *
 * Ohne ihn wäre "immer spielen können" eine Lüge: Im Zug ohne Empfang bliebe
 * die Seite weiß, obwohl ROM und Spielstände längst auf dem Gerät liegen.
 *
 * Zwei Strategien, je nach Art der Anfrage:
 *
 *  - Navigationen (das HTML): erst Netz, dann Cache. So bekommt man nach einem
 *    Deploy die neue Version, ohne dass eine veraltete Seite kleben bleibt.
 *  - Alles andere: erst Cache, dann Netz — und im Hintergrund auffrischen.
 *    Die Dateinamen sind durch Vite inhaltsabhängig gehasht, ein Treffer im
 *    Cache kann also gar nicht veraltet sein.
 *
 * Spielstände und ROM liegen in IndexedDB und gehen den Cache nichts an.
 */

const VERSION = 'v1';
const CACHE = `lolo-${VERSION}`;
const BASIS = new URL('./', self.location).pathname;

/* Was ohne Hash-Namen auskommt und deshalb benannt werden muss. */
const GRUNDGERUEST = [
  BASIS,
  `${BASIS}manifest.webmanifest`,
  `${BASIS}icons/icon-192.png`,
  `${BASIS}icons/apple-touch-icon.png`,
  // Ohne den Emulator selbst wäre der Rest sinnlos.
  `${BASIS}vendor/binjgb/binjgb.js`,
  `${BASIS}vendor/binjgb/binjgb.wasm`,
  // Der Entpacker wird erst beim Import gebraucht — aber genau dann hat man
  // vielleicht keinen Empfang mehr. Also vorsorglich mitnehmen.
  `${BASIS}vendor/libarchive/worker-bundle.js`,
  `${BASIS}vendor/libarchive/libarchive.wasm`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Einzeln statt addAll(): Fehlt eine Datei, soll nicht die ganze
      // Installation scheitern und die App ohne Offline-Fähigkeit dastehen.
      await Promise.all(
        GRUNDGERUEST.map((url) => cache.add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const namen = await caches.keys();
      await Promise.all(
        namen.filter((name) => name.startsWith('lolo-') && name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const antwort = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(BASIS, antwort.clone());
          return antwort;
        } catch {
          // Offline: die zuletzt gesehene Seite ausliefern.
          return (await caches.match(BASIS)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const treffer = await cache.match(request);

      const ausDemNetz = fetch(request)
        .then((antwort) => {
          if (antwort.ok) cache.put(request, antwort.clone());
          return antwort;
        })
        .catch(() => undefined);

      // Liegt es im Cache, sofort ausliefern und nebenher auffrischen.
      const antwort = treffer ?? (await ausDemNetz);
      return antwort ?? Response.error();
    })(),
  );
});
