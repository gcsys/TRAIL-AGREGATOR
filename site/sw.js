/* Service worker d'Agregatrail : le site s'installe comme une application et reste consultable hors ligne.
 * - Pages (navigation) : réseau d'abord, copie en cache si le réseau manque.
 * - Données (data/*.json, geo/*) : réseau d'abord, la dernière version reçue sert hors ligne.
 * - Code, styles, polices, bibliothèques : cache d'abord. Leurs adresses portent la version du build
 *   (?v=…), et chaque build a son propre cache : les anciens sont supprimés à l'activation.
 * - Autres sites (fonds de carte, géocodage, itinéraires) : jamais interceptés ni mis en cache.
 * La liste à mettre en cache à l'installation est lue dans index.html : rien à tenir à jour à la main. */
const VERSION = "__BUILD__"; // remplacé au déploiement par le commit (build-deploy.yml)
const SHELL = `ta-shell-${VERSION}`;
const DATA = "ta-data-v1";
const EXTRA = ["./", "data/index.json", "geo/departements.geojson", "geo/regions.geojson", "manifest.webmanifest", "icons/icon-192.png"];

/* Adresses locales citées par index.html (src="…", href="…"), sans les liens externes ni les ancres. */
function locales(html) {
  const out = new Set();
  for (const m of html.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
    const u = m[1];
    if (/^(?:[a-z]+:|\/\/)/i.test(u) || u.endsWith("/") || /\.(?:xml|html)(?:\?|$)/.test(u)) continue;
    out.add(u);
  }
  return [...out];
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      const page = await fetch("./", { cache: "no-cache" });
      const html = await page.clone().text();
      await shell.put("./", page);
      // Une ressource absente ne doit pas bloquer l'installation : on met en cache ce qui répond.
      await Promise.all(
        locales(html).map((u) =>
          fetch(u)
            .then((r) => r.ok && shell.put(u, r))
            .catch(() => {})
        )
      );
      const data = await caches.open(DATA);
      await Promise.all(
        EXTRA.slice(1).map((u) =>
          fetch(u)
            .then((r) => r.ok && (/^(data|geo)\//.test(u) ? data : shell).put(u, r))
            .catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("ta-shell-") && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

async function reseauDabord(req, cacheName, repli) {
  const cache = await caches.open(cacheName);
  try {
    const r = await fetch(req);
    if (r.ok) cache.put(req, r.clone());
    return r;
  } catch (err) {
    const c = (await cache.match(req, { ignoreSearch: req.mode === "navigate" })) || (repli && (await caches.match(repli)));
    if (c) return c;
    throw err;
  }
}

async function cacheDabord(req) {
  const c = await caches.match(req);
  if (c) return c;
  const r = await fetch(req);
  if (r.ok && r.type === "basic") (await caches.open(SHELL)).put(req, r.clone());
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonds de carte et API : comportement normal du navigateur
  const chemin = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (req.mode === "navigate") {
    // Hors ligne, une page jamais visitée retombe sur l'application (qui sait afficher les courses en cache).
    e.respondWith(reseauDabord(req, DATA, "./"));
  } else if (/^(data|geo)\//.test(chemin) || /\.json$/.test(chemin)) {
    e.respondWith(reseauDabord(req, DATA));
  } else {
    e.respondWith(cacheDabord(req));
  }
});
