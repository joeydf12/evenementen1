const CACHE = "hhc09-v4";
const ASSETS = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);

  // Alleen zelf afhandelen wat van dit domein komt en met GET wordt opgehaald --
  // requests van browserextensies (chrome-extension://) of niet-GET requests
  // (bv. Supabase POST/PATCH) mag de Cache API niet in, dat gooit een fout.
  // Zulke requests laten we ongemoeid (geen respondWith = gewoon normaal netwerk).
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Network-first i.p.v. cache-first: elke nieuwe deploy moet meteen zichtbaar
  // zijn voor gebruikers die de app al eerder open hadden, i.p.v. voor altijd
  // vast te zitten aan de gecachte JS-bundel van de vorige build. Alleen bij
  // een echte netwerkfout (bv. offline) valt hij terug op de laatste cache.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.status === 200) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
