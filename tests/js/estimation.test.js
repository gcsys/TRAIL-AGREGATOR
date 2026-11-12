const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("estimation.js");
const E = globalThis.Estimation;

test("lecture des durées", () => {
  assert.equal(E.parseDuree("45:30"), 45 * 60 + 30);
  assert.equal(E.parseDuree("1:45:30"), 6330);
  assert.equal(E.parseDuree("1h45"), 6300);
  assert.equal(E.parseDuree("1 h 45 min"), 6300);
  assert.equal(E.parseDuree("52"), 52 * 60);
  assert.equal(E.parseDuree("abc"), null);
  assert.equal(E.parseDuree(""), null);
});

test("affichage des durées", () => {
  assert.equal(E.formatDuree(52 * 60 + 10), "52 min");
  assert.equal(E.formatDuree(3600 + 5 * 60), "1 h 05");
  assert.equal(E.formatDuree(5 * 3600 + 7 * 60), "5 h 05"); // au-delà de 2 h : arrondi à 5 min
});

test("même distance sur route : on retrouve le chrono", () => {
  const e = E.estimer({ type: "10k", temps: 2700 }, { distance_km: 10, denivele_pos_m: 0 });
  assert.equal(Math.round(e.centre), Math.round(2700 * 1.05)); // terrain trail roulant
  assert.ok(e.bas < e.centre && e.centre < e.haut);
});

test("plus long et plus montagneux : plus lent, de façon croissante", () => {
  const ref = { type: "semi", temps: 1.5 * 3600 };
  const a = E.estimer(ref, { distance_km: 20, denivele_pos_m: 400 }).centre;
  const b = E.estimer(ref, { distance_km: 20, denivele_pos_m: 1200 }).centre;
  const c = E.estimer(ref, { distance_km: 40, denivele_pos_m: 1200 }).centre;
  assert.ok(a < b && b < c);
  // ordre de grandeur : 1 h 30 au semi -> 40 km et 1 200 m D+ en 4 h 30 à 5 h
  assert.ok(c > 4.3 * 3600 && c < 5.2 * 3600, String(c / 3600));
});

test("référence trail : son propre profil est pris en compte", () => {
  const ref = { type: "trail", temps: 3 * 3600, km: 25, dplus: 1500 };
  const e = E.estimer(ref, { distance_km: 25, denivele_pos_m: 1500 });
  assert.equal(Math.round(e.centre), 3 * 3600);
});

test("sans D+ ou sans référence : pas d'estimation", () => {
  assert.equal(E.estimer({ type: "10k", temps: 2700 }, { distance_km: 30, denivele_pos_m: null }), null);
  assert.equal(E.estimer(null, { distance_km: 30, denivele_pos_m: 500 }), null);
  assert.equal(E.estimer({ type: "trail", temps: 3600 }, { distance_km: 30, denivele_pos_m: 500 }), null);
});

test("enregistrement et libellé", () => {
  E.enregistrer({ type: "10k", temps: 2700 });
  assert.equal(E.libelle(), "10 km en 45 min");
  E.enregistrer({ type: "trail", temps: 0 });
  assert.equal(E.chrono(), null);
});

test("fourchette lisible", () => {
  assert.equal(E.fourchette({ bas: 31 * 60, haut: 39 * 60 }), "31 à 39 min");
  assert.equal(E.fourchette({ bas: 50 * 60, haut: 65 * 60 }), "50 min à 1 h 05");
  assert.equal(E.fourchette({ bas: 7800, haut: 9600 }), "2 h 10 à 2 h 40");
});
