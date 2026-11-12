/* Temps de route : isochrones de la Géoplateforme IGN (data.geopf.fr, sans clé,
 * 5 requêtes par seconde au plus par adresse IP).
 *
 * - Route.isochrone(lat, lon, minutes) : polygone GeoJSON des lieux atteignables
 *   en voiture dans ce temps, depuis le point (mis en cache pour la session).
 * - Route.tranches(minutes) : paliers emboîtés utilisés pour estimer la durée
 *   de route d'une course (« 30 à 45 min »), sans une requête par course.
 * - Route.tranche(point, bandes, pip) : premier palier qui contient le point.
 *
 * Toutes les durées affichées sont des estimations (réseau routier IGN, sans trafic). */
(function (root) {
  const API = "https://data.geopf.fr/navigation/isochrone";
  const PALIERS = [15, 30, 45, 60, 90, 120, 150, 180];
  const MIN_GAP = 250; // ms entre deux requêtes : 4 par seconde au plus
  const KEY = "ta.iso.v1:";

  const arrondi = (v) => Math.round(v * 1e3) / 1e3; // ~100 m : même point = même cache
  const cle = (lat, lon, min) => `${arrondi(lat)},${arrondi(lon)},${min}`;

  function url(lat, lon, min) {
    const p = new URLSearchParams({
      point: `${arrondi(lon)},${arrondi(lat)}`,
      resource: "bdtopo-valhalla",
      costValue: String(min * 60),
      costType: "time",
      timeUnit: "second",
      profile: "car",
      direction: "departure",
      geometryFormat: "geojson",
    });
    return `${API}?${p}`;
  }

  /* Paliers à demander pour une durée maximale : ceux en dessous, plus la durée elle-même. */
  function tranches(min) {
    return [...new Set([...PALIERS.filter((p) => p < min), min])].sort((a, b) => a - b);
  }

  /* Libellé d'une tranche : « moins de 15 min », « 30 à 45 min », « 1 h à 1 h 30 ». */
  const duree = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`);
  function libelle(bas, haut) {
    if (!bas) return `moins de ${duree(haut)}`;
    if (bas < 60 && haut < 60) return `${bas} à ${haut} min`;
    return `${duree(bas)} à ${duree(haut)}`;
  }

  /* Bandes triées par durée croissante : [{ min, poly }]. Renvoie { bas, haut, texte } ou null. */
  function tranche(pt, bandes, pip) {
    let bas = 0;
    for (const b of bandes) {
      if (b.poly && pip(pt, b.poly)) return { bas, haut: b.min, texte: libelle(bas, b.min) };
      bas = b.min;
    }
    return null;
  }

  // ----- Requêtes -----
  const memo = new Map();
  let file = Promise.resolve();
  let derniere = 0;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function lireCache(k) {
    try {
      const v = root.sessionStorage.getItem(KEY + k);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }
  function ecrireCache(k, v) {
    try {
      root.sessionStorage.setItem(KEY + k, JSON.stringify(v));
    } catch (e) {
      /* stockage plein ou indisponible : le cache mémoire suffit */
    }
  }

  // Le service répond en 1 à 6 s ; au-delà de 30 s on abandonne (repli sur la distance).
  const TIMEOUT = 30000;
  function appel(fetchFn, u) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT);
    return fetchFn(u, ctrl ? { signal: ctrl.signal } : undefined).finally(() => t && clearTimeout(t));
  }

  /* Polygone (Feature) atteignable en `min` minutes depuis (lat, lon). Les requêtes passent
   * une par une, espacées d'au moins MIN_GAP, pour respecter la limite du service. */
  function isochrone(lat, lon, min, { fetchFn = root.fetch.bind(root) } = {}) {
    const k = cle(lat, lon, min);
    if (memo.has(k)) return memo.get(k);
    const cached = lireCache(k);
    if (cached) {
      const p = Promise.resolve(cached);
      memo.set(k, p);
      return p;
    }
    const p = (file = file.catch(() => {}).then(async () => {
      const attente = derniere + MIN_GAP - Date.now();
      if (attente > 0) await pause(attente);
      derniere = Date.now();
      let r = await appel(fetchFn, url(lat, lon, min));
      if (r.status === 429) {
        // limite de débit atteinte (5 requêtes par seconde) : un seul nouvel essai, un peu plus tard
        await pause(1500);
        derniere = Date.now();
        r = await appel(fetchFn, url(lat, lon, min));
      }
      if (!r.ok) throw new Error(`Service de calcul d'itinéraire indisponible (${r.status})`);
      const d = await r.json();
      const geom = d.geometry;
      if (!geom || !/Polygon$/.test(geom.type)) throw new Error("Réponse inattendue du service");
      const f = { type: "Feature", properties: { minutes: min }, geometry: geom };
      ecrireCache(k, f);
      return f;
    }));
    memo.set(k, p);
    p.catch(() => memo.delete(k)); // nouvel essai possible
    return p;
  }

  root.Route = { url, tranches, tranche, libelle, duree, isochrone, PALIERS };
})(typeof window !== "undefined" ? window : globalThis);
