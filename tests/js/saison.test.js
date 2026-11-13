const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("saison.js");
const S = globalThis.Saison;

const r = (id, date, km = 20, d = 800) => ({ id, nom: `Trail ${id}`, date, distance_km: km, denivele_pos_m: d });
const rows = [r("obj", "2027-06-26", 80, 4000), r("a", "2027-04-03"), r("b", "2027-05-01", 42, 2000), r("c", "2027-06-12"), r("d", "2027-05"), r("e", null)];

test("tri, écarts en semaines, alertes sous le seuil", () => {
  const a = S.analyser(rows, { objectif: "obj", seuil: 3 });
  assert.deepEqual(a.items.map((x) => x.r.id), ["a", "d", "b", "c", "obj"]);
  const b = a.items.find((x) => x.r.id === "b");
  assert.equal(b.ecart, 4);
  assert.equal(b.alerte, false);
  const c = a.items.find((x) => x.r.id === "c");
  assert.equal(Math.round(c.ecart * 7), 42); // depuis b (le mois seul de d ne compte pas)
  const obj = a.items.find((x) => x.r.id === "obj");
  assert.equal(obj.ecart, 2);
  assert.equal(obj.alerte, true);
  assert.equal(a.nAlertes, 1);
  assert.equal(a.sansDate, 1);
});

test("rôles et jours restants avant l'objectif", () => {
  const a = S.analyser(rows.concat(r("f", "2027-07-10")), { objectif: "obj" });
  const role = Object.fromEntries(a.items.map((x) => [x.r.id, x.role]));
  assert.deepEqual(role, { a: "preparation", b: "preparation", d: "preparation", c: "preparation", obj: "objectif", f: "apres" });
  assert.equal(Math.round(a.items.find((x) => x.r.id === "c").avant * 7), 14);
  assert.equal(S.analyser(rows, {}).items[0].role, null);
});

test("seuil réglable et même jour", () => {
  assert.equal(S.analyser(rows, { seuil: 5 }).nAlertes, 2); // 4 semaines (a→b) et 2 semaines (c→obj)
  const m = S.analyser([r("x", "2027-05-01"), r("y", "2027-05-01", 10)], {});
  assert.equal(m.items[1].alerte, "meme-jour");
});

test("html : objectif, alerte, jour à préciser, échappement", () => {
  const h = S.html(S.analyser(rows.concat(r("<z>", "2027-08-01")), { objectif: "obj", seuil: 3 }), (s) => String(s).replace(/</g, "&lt;"));
  assert.match(h, /Objectif : <b>Trail obj<\/b> \(26 juin 2027\), 4 courses de préparation\./);
  assert.match(h, /class="sz-gap alerte"><span>2 semaines seulement : sous votre seuil de 3 semaines/);
  assert.match(h, /Jour à préciser : écart non calculé/);
  assert.match(h, /J-14/);
  assert.match(h, /Trail &lt;z>/);
  assert.match(h, /<option value="3" selected>/);
  assert.equal(S.html(S.analyser([], {})), "");
});
