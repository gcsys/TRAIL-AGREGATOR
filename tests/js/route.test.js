const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("route.js");
const R = globalThis.Route;

test("paliers demandés pour une durée", () => {
  assert.deepEqual(R.tranches(60), [15, 30, 45, 60]);
  assert.deepEqual(R.tranches(75), [15, 30, 45, 60, 75]);
  assert.deepEqual(R.tranches(15), [15]);
});

test("libellés de durée", () => {
  assert.equal(R.libelle(0, 15), "moins de 15 min");
  assert.equal(R.libelle(30, 45), "30 à 45 min");
  assert.equal(R.libelle(45, 60), "45 min à 1 h");
  assert.equal(R.libelle(60, 90), "1 h à 1 h 30");
});

test("tranche d'un point : premier palier qui le contient", () => {
  const bandes = [{ min: 15, poly: "a" }, { min: 30, poly: "b" }, { min: 45, poly: "c" }];
  const dans = (inside) => (pt, poly) => inside.includes(poly);
  assert.equal(R.tranche({}, bandes, dans(["b", "c"])).texte, "15 à 30 min");
  assert.equal(R.tranche({}, bandes, dans(["a", "b", "c"])).texte, "moins de 15 min");
  assert.equal(R.tranche({}, bandes, dans([])), null);
});

test("URL de l'API : longitude d'abord, durée en secondes, voiture", () => {
  const u = new URL(R.url(43.83671, 4.36012, 60));
  assert.equal(u.origin + u.pathname, "https://data.geopf.fr/navigation/isochrone");
  assert.equal(u.searchParams.get("point"), "4.36,43.837");
  assert.equal(u.searchParams.get("costValue"), "3600");
  assert.equal(u.searchParams.get("profile"), "car");
});

test("requêtes espacées, mises en cache, et nouvel essai après une erreur", async () => {
  const appels = [];
  let echec = true;
  const fetchFn = async (u) => {
    appels.push(Date.now());
    if (echec) return (echec = false), { ok: false, status: 503 };
    return { ok: true, json: async () => ({ geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }) };
  };
  await assert.rejects(R.isochrone(44, 3, 30, { fetchFn }), /indisponible/);
  const [a, b] = await Promise.all([R.isochrone(44, 3, 30, { fetchFn }), R.isochrone(44, 3, 45, { fetchFn })]);
  assert.equal(a.properties.minutes, 30);
  assert.equal(b.properties.minutes, 45);
  await R.isochrone(44, 3, 30, { fetchFn }); // en cache : pas de nouvel appel
  assert.equal(appels.length, 3);
  assert.ok(appels[1] - appels[0] >= 240 && appels[2] - appels[1] >= 240, "au moins 250 ms entre deux requêtes");
});

test("limite de débit (429) : un nouvel essai", async () => {
  let n = 0;
  const fetchFn = async () => (++n === 1 ? { ok: false, status: 429 } : { ok: true, status: 200, json: async () => ({ geometry: { type: "MultiPolygon", coordinates: [] } }) });
  const f = await R.isochrone(45, 5, 60, { fetchFn });
  assert.equal(f.geometry.type, "MultiPolygon");
  assert.equal(n, 2);
});
