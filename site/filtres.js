/* Filtres et zone de recherche : fonctions pures, sans DOM, testées dans tests/js/.
 * app.js lit le formulaire une fois par rafraîchissement (Filtres.criteres) puis
 * appelle Filtres.passe et Filtres.dansZone pour chaque course. */
(function (root) {
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const dateStart = (d) => (d.length === 7 ? d + "-01" : d);
  const dateEnd = (d) => (d.length === 7 ? d + "-31" : d);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
  const haversine = (lat1, lon1, lat2, lon2) => {
    const R = 6371, rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  const between = (v, min, max) => (min == null || (v != null && v >= min)) && (max == null || (v != null && v <= max));

  /* Profil d'après le D+ par km : roulant < 25 m/km, vallonné 25 à 50, montagne au-delà. */
  const profilOf = (r) => {
    if (r.denivele_pos_m == null || !r.distance_km) return null;
    const ratio = r.denivele_pos_m / r.distance_km;
    return ratio < 25 ? "roulant" : ratio <= 50 ? "vallonne" : "montagne";
  };

  /* Texte de recherche d'une course (mis en cache sur l'objet). */
  const hay = (r) => (r._hay ??= " " + norm([r.nom, r.course, r.ville, r.organisateur, r.departement, r.departement_code, r.region].join(" ")));

  /* Critères vides : toutes les courses passent. */
  const criteres = (c = {}) => ({
    q: "", from: "", to: "", months: new Set(), profils: new Set(),
    kmMin: null, kmMax: null, dMin: null, dMax: null, keMin: null, keMax: null,
    utmb: "", ws: "", itra: null, type: "", night: false, dplus: false, confirmed: false, site: false,
    ...c,
  });

  function passe(r, c) {
    if (c.q && !hay(r).includes(c.q)) return false;
    if (c.from && (!r.date || dateEnd(r.date) < c.from)) return false;
    if (c.to && (!r.date || dateStart(r.date) > c.to)) return false;
    if (c.months.size && (!r.date || !c.months.has(r.date.slice(0, 7)))) return false;
    if (!between(r.distance_km, c.kmMin, c.kmMax)) return false;
    if (!between(r.denivele_pos_m, c.dMin, c.dMax)) return false;
    if (!between(r.km_effort, c.keMin, c.keMax)) return false;
    if (c.profils.size && !c.profils.has(profilOf(r))) return false;
    if (c.utmb === "any" && !r.utmb_index) return false;
    if (c.utmb === "none" && r.utmb_index) return false;
    if (c.utmb && !["any", "none"].includes(c.utmb) && r.utmb_index !== c.utmb) return false;
    if (c.ws === "yes" && !r.utmb_world_series) return false;
    if (c.ws === "no" && r.utmb_world_series) return false;
    if (c.itra != null && (r.itra_points_estimes ?? -1) < c.itra) return false;
    if (c.type && r.type !== c.type) return false;
    if (c.night && !r.nocturne) return false;
    if (c.dplus && r.denivele_pos_m == null) return false;
    if (c.confirmed && !(r.date && r.date.length === 10 && r.date_confirmee)) return false;
    if (c.site && !(safeUrl(r.site_web) || safeUrl(r.lien_inscription))) return false;
    return true;
  }

  /* Zone : { deps: Set, regs: Set, shapes: [Feature<Polygon>], bbox: [o, s, e, n], radius: {lat, lon, km} }.
   * Une course est dans la zone si elle est dans l'un des éléments (union).
   * pip(point, polygone) : test point-dans-polygone (turf.booleanPointInPolygon dans le site). */
  const zoneActive = (z) => !!(z.deps.size || z.regs.size || z.shapes.length || z.bbox || z.radius);
  function dansZone(r, z, pip) {
    if (!zoneActive(z)) return true;
    if (r.departement_code && z.deps.has(r.departement_code)) return true;
    if (r.region_code && z.regs.has(r.region_code)) return true;
    if (r.lat == null) return false;
    if (z.radius && haversine(z.radius.lat, z.radius.lon, r.lat, r.lon) <= z.radius.km) return true;
    if (z.bbox) {
      const [w, s, e, n] = z.bbox;
      if (r.lon >= w && r.lon <= e && r.lat >= s && r.lat <= n) return true;
    }
    if (!z.shapes.length) return false;
    const pt = { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [r.lon, r.lat] } };
    return z.shapes.some((s) => pip(pt, s));
  }

  root.Filtres = { norm, haversine, between, profilOf, hay, criteres, passe, zoneActive, dansZone, dateStart, dateEnd, safeUrl };
})(typeof window !== "undefined" ? window : globalThis);
