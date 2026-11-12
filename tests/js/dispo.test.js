const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("dispo.js");
const D = globalThis.Dispo;

// réglage de test : un week-end sur deux à partir du samedi 8 mai 2027 (indisponible)
D.set({ on: true, ref: "2027-05-08", every: 2, hide: true });

test("week-end de référence indisponible, le suivant libre, puis alternance", () => {
  assert.ok(D.blocked("2027-05-08"));
  assert.ok(D.blocked("2027-05-09")); // dimanche du même week-end
  assert.ok(!D.blocked("2027-05-15"));
  assert.ok(D.blocked("2027-05-22"));
  assert.ok(D.blocked("2027-04-24")); // avant la référence aussi
});

test("un jour de semaine n'est jamais bloqué", () => assert.ok(!D.blocked("2027-05-10")));

test("changement d'heure sans effet (fin octobre)", () => {
  // 8 mai + 24 semaines = 23 octobre (bloqué) ; 30/31 octobre = changement d'heure (libre)
  assert.ok(D.blocked("2027-10-23"));
  assert.ok(!D.blocked("2027-10-31"));
});

test("statut d'une course", () => {
  assert.equal(D.status({ date: "2027-05-15", date_confirmee: true }), "ok");
  assert.equal(D.status({ date: "2027-05-08", date_confirmee: true }), "busy");
  assert.equal(D.status({ date: "2027-05", date_confirmee: false }), "unsure");
  assert.equal(D.status({ date: "2027-05-15", date_confirmee: false }), "unsure");
});

test("indicateur coupé : pas de statut", () => {
  D.set({ on: false });
  assert.equal(D.status({ date: "2027-05-08", date_confirmee: true }), null);
  D.set({ on: true });
});

test("prochains week-ends indisponibles", () => {
  assert.deepEqual(D.next(3, new Date(2027, 4, 10)), ["2027-05-22", "2027-06-05", "2027-06-19"]);
});
