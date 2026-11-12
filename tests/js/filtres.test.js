const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("filtres.js");
const F = globalThis.Filtres;

const course = (o = {}) => ({
  id: "x", nom: "Trail des Templiers", course: "", ville: "Millau", organisateur: "", departement: "Aveyron", departement_code: "12",
  region: "Occitanie", region_code: "76", date: "2027-10-24", date_confirmee: true, lat: 44.098, lon: 3.078,
  distance_km: 80, denivele_pos_m: 3500, km_effort: 115, utmb_index: "100K", itra_points_estimes: 4, utmb_world_series: false,
  type: "trail", nocturne: false, site_web: "", lien_inscription: "", ...o,
});
const passe = (r, c) => F.passe(r, F.criteres(c));

test("sans critère, tout passe", () => assert.ok(passe(course(), {})));

test("recherche texte sans accents, sur la commune et le département", () => {
  assert.ok(passe(course(), { q: F.norm("Millau") }));
  assert.ok(passe(course(), { q: F.norm("aveyron") }));
  assert.ok(!passe(course({ _hay: undefined }), { q: "nimes" }));
});

test("dates : une date au mois près couvre tout le mois", () => {
  const r = course({ date: "2027-10" });
  assert.ok(passe(r, { from: "2027-10-20" }));
  assert.ok(passe(r, { to: "2027-10-01" }));
  assert.ok(!passe(r, { from: "2027-11-01" }));
  assert.ok(!passe(course({ date: null }), { from: "2027-01-01" }));
  assert.ok(passe(r, { months: new Set(["2027-10"]) }));
  assert.ok(!passe(r, { months: new Set(["2027-11"]) }));
});

test("bornes de distance, D+ et km-effort ; valeur inconnue exclue dès qu'une borne existe", () => {
  assert.ok(passe(course(), { kmMin: 80, kmMax: 80 }));
  assert.ok(!passe(course(), { kmMax: 79 }));
  assert.ok(!passe(course({ denivele_pos_m: null }), { dMin: 0 }));
  assert.ok(passe(course({ denivele_pos_m: null }), { kmMin: 10 }));
  assert.ok(!passe(course(), { keMin: 116 }));
});

test("profil selon le D+ par km", () => {
  assert.equal(F.profilOf(course({ distance_km: 20, denivele_pos_m: 400 })), "roulant");
  assert.equal(F.profilOf(course({ distance_km: 20, denivele_pos_m: 500 })), "vallonne");
  assert.equal(F.profilOf(course({ distance_km: 20, denivele_pos_m: 1000 })), "vallonne");
  assert.equal(F.profilOf(course({ distance_km: 20, denivele_pos_m: 1001 })), "montagne");
  assert.equal(F.profilOf(course({ denivele_pos_m: null })), null);
  assert.ok(passe(course(), { profils: new Set(["vallonne"]) }));
  assert.ok(!passe(course(), { profils: new Set(["roulant"]) }));
});

test("UTMB, World Series, ITRA, type, nocturne", () => {
  assert.ok(passe(course(), { utmb: "any" }));
  assert.ok(!passe(course(), { utmb: "none" }));
  assert.ok(!passe(course(), { utmb: "50K" }));
  assert.ok(!passe(course(), { ws: "yes" }));
  assert.ok(passe(course(), { ws: "no" }));
  assert.ok(passe(course(), { itra: 4 }));
  assert.ok(!passe(course({ itra_points_estimes: null }), { itra: 0 }));
  assert.ok(!passe(course(), { type: "ultra" }));
  assert.ok(!passe(course(), { night: true }));
});

test("D+ connu, date confirmée, site officiel", () => {
  assert.ok(!passe(course({ denivele_pos_m: null }), { dplus: true }));
  assert.ok(!passe(course({ date: "2027-10" }), { confirmed: true }));
  assert.ok(!passe(course({ date_confirmee: false }), { confirmed: true }));
  assert.ok(!passe(course(), { site: true }));
  assert.ok(passe(course({ lien_inscription: "https://x.fr" }), { site: true }));
  assert.ok(!passe(course({ site_web: "javascript:alert(1)" }), { site: true }));
});

// ----- Zone -----
const zone = (o = {}) => ({ deps: new Set(), regs: new Set(), shapes: [], bbox: null, radius: null, ...o });
// point dans polygone simple (anneau extérieur), pour ne pas dépendre de Turf
const pip = (pt, poly) => {
  const [x, y] = pt.geometry.coordinates, ring = poly.geometry.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const carre = (o, s, e, n) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] } });

test("sans zone, tout passe", () => assert.ok(F.dansZone(course(), zone(), pip)));

test("département et région sélectionnés", () => {
  assert.ok(F.dansZone(course(), zone({ deps: new Set(["12"]) }), pip));
  assert.ok(!F.dansZone(course(), zone({ deps: new Set(["30"]) }), pip));
  assert.ok(F.dansZone(course(), zone({ regs: new Set(["76"]) }), pip));
});

test("rayon autour d'un point", () => {
  const nimes = { lat: 43.8367, lon: 4.3601 };
  const dist = F.haversine(nimes.lat, nimes.lon, 44.098, 3.078); // Millau, environ 107 km
  assert.ok(dist > 100 && dist < 115, String(dist));
  assert.ok(F.dansZone(course(), zone({ radius: { ...nimes, km: 110 } }), pip));
  assert.ok(!F.dansZone(course(), zone({ radius: { ...nimes, km: 100 } }), pip));
});

test("zone affichée et tracé", () => {
  assert.ok(F.dansZone(course(), zone({ bbox: [3, 44, 3.2, 44.2] }), pip));
  assert.ok(!F.dansZone(course(), zone({ bbox: [4, 44, 4.2, 44.2] }), pip));
  assert.ok(F.dansZone(course(), zone({ shapes: [carre(3, 44, 3.2, 44.2)] }), pip));
  assert.ok(!F.dansZone(course(), zone({ shapes: [carre(4, 44, 4.2, 44.2)] }), pip));
});

test("plusieurs éléments de zone : union", () => {
  assert.ok(F.dansZone(course(), zone({ deps: new Set(["30"]), shapes: [carre(3, 44, 3.2, 44.2)] }), pip));
});

test("course sans coordonnées : seulement par département ou région", () => {
  const r = course({ lat: null, lon: null });
  assert.ok(!F.dansZone(r, zone({ bbox: [-5, 40, 10, 52] }), pip));
  assert.ok(F.dansZone(r, zone({ deps: new Set(["12"]) }), pip));
});

test("temps de route : isochrone quand elle est là, borne large en attendant", () => {
  const nimes = { lat: 43.8367, lon: 4.3601 };
  // Millau est à ~107 km à vol d'oiseau de Nîmes
  assert.ok(F.dansZone(course(), zone({ radius: { ...nimes, route: 60 } }), pip), "1 h à 130 km/h couvre 130 km : provisoirement dedans");
  assert.ok(!F.dansZone(course(), zone({ radius: { ...nimes, route: 30 } }), pip));
  const iso = carre(3.5, 43.5, 5, 44.5); // n'atteint pas Millau
  assert.ok(!F.dansZone(course(), zone({ radius: { ...nimes, route: 60, iso } }), pip));
  assert.ok(F.dansZone(course({ lat: 43.9, lon: 4.0 }), zone({ radius: { ...nimes, route: 60, iso } }), pip));
});
