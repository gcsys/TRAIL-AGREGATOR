const test = require("node:test");
const assert = require("node:assert/strict");
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
require("./charger")("comparateur.js");
const C = globalThis.Comparateur;

const r = (id, km, dplus, extra = {}) => ({ id, nom: `Trail ${id}`, course: "", ville: "Millau", departement_code: "12", date: "2027-05-15", date_confirmee: true, distance_km: km, denivele_pos_m: dplus, km_effort: dplus == null ? null : km + dplus / 100, ...extra });

test("sélection : 4 formats au plus, gardée dans le navigateur", () => {
  C.vider();
  assert.equal(C.basculer("a"), true);
  ["b", "c", "d"].forEach((x) => C.basculer(x));
  assert.equal(C.basculer("e"), null);
  assert.equal(C.basculer("b"), false);
  assert.deepEqual(C.ids(), ["a", "c", "d"]);
  assert.deepEqual(JSON.parse(store.get("ta.cmp.v1")), ["a", "c", "d"]);
});

test("lignes : valeurs calculées marquées, lignes sans donnée retirées", () => {
  const L = C.lignes([r("a", 20, 1000), r("b", 42.5, null, { date: "2027-06", date_confirmee: false })]);
  const get = (n) => L.find((l) => l.libelle === n);
  assert.deepEqual(get("Distance").valeurs, ["20 km", "42,5 km"]);
  assert.deepEqual(get("D+ par km").valeurs, ["50 m/km", "–"]);
  assert.equal(get("D+ par km").calcule, true);
  assert.deepEqual(get("Date").valeurs, ["sam. 15 mai 2027", "juin 2027, jour à préciser"]);
  assert.equal(get("Trajet"), undefined);
  assert.equal(get("Prix"), undefined);
});

test("html : trajet, prix, temps, échappement, bouton retirer", () => {
  const h = C.html([r("a<", 20, 1000, { inscription: { prix: 35 } }), r("b", 42, 2000)], {
    trajet: (x) => (x.id === "b" ? "≈ 1 h 10 de route" : null), temps: () => "≈ 2 h à 2 h 30", chrono: "10 km en 45 min",
    cle: (x) => x.id,
  }, (s) => String(s).replace(/</g, "&lt;"));
  assert.match(h, /data-cmp-retirer="a&lt;"/);
  assert.match(h, /<td>35 €<\/td><td>–<\/td>/);
  assert.match(h, /≈ 1 h 10 de route/);
  assert.match(h, /Temps estimé <span class="tag muted">calcul<\/span>/);
  assert.match(h, /d'après votre référence : 10 km en 45 min/);
});
