const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("groupe.js");
require("./charger")("favoris.js");
const G = globalThis.Groupe;
const F = globalThis.Favoris;

const r = (id, date, km) => ({ id, nom: `Trail ${id}`, date, distance_km: km });

test("choisir, retirer et répartition par format", () => {
  const g = { membres: [] };
  G.choisir(g, "Léa", "a", "123", 1000);
  G.choisir(g, "léa ", "b", "", 2000); // même personne, casse et espaces ignorés
  G.choisir(g, "Tom", "a", "", 1500);
  assert.equal(g.membres.length, 2);
  const { par } = G.repartition([r("a", "2027-05-01", 20), r("b", "2027-06-01", 40)], g);
  assert.deepEqual(par.get("a"), [{ n: "Léa", d: "123" }, { n: "Tom", d: "" }]);
  G.retirer(g, "Tom", "a", 3000);
  assert.equal(G.actifs(g).length, 1);
  assert.equal(g.membres.find((m) => m.n === "Tom").t, 3000); // pierre tombale datée
});

test("fusion : la version la plus récente de chaque personne gagne, retraits compris", () => {
  const a = { membres: [{ n: "Léa", c: { a: "1" }, t: 10 }, { n: "Tom", c: { a: "" }, t: 10 }] };
  const b = { membres: [{ n: "Léa", c: { a: "1", b: "9" }, t: 20 }, { n: "Tom", c: {}, t: 30 }, { n: "Zoé", c: { b: "" }, t: 5 }] };
  const f = G.fusionner(a, b);
  const par = Object.fromEntries(f.membres.map((m) => [m.n, m.c]));
  assert.deepEqual(par, { Léa: { a: "1", b: "9" }, Tom: {}, Zoé: { b: "" } });
  assert.deepEqual(G.fusionner(b, a), f); // ordre indifférent
  assert.equal(G.compacter(f, 60 * 864e5 + 31).membres.length, 2); // vieille pierre tombale retirée
});

test("normaliser : nettoie ce qui arrive d'un lien", () => {
  const g = G.normaliser({ membres: [{ n: "  Ana\n", c: { a: "12345678901234" }, t: "7" }, { n: "ana", c: {} }, { n: "", c: {} }, null] });
  assert.deepEqual(g, { membres: [{ n: "Ana", c: { a: "123456789012" }, t: 7 }] });
  assert.deepEqual(G.normaliser(undefined), { membres: [] });
});

test("le groupe voyage dans le lien et met à jour la liste qui le suit", async () => {
  const byId = new Map([["a", r("a", "2027-05-01", 20)], ["b", r("b", "2027-06-01", 40)]]);
  const l = F.create("Sortie", ["a"]);
  F.setGroupe(l.id, { membres: G.choisir({ membres: [] }, "Léa", "a", "12", 100).membres });
  const lien = await F.encode(F.get(l.id), byId);
  const recu = await F.decode(lien);
  assert.equal(recu.groupe.gid, F.groupe(l.id).gid);
  // Un ami ajoute une course et son choix, puis renvoie le lien.
  recu.ids.push("b");
  G.choisir(recu.groupe, "Tom", "b", "", 200);
  const resolved = F.resolveShared(recu, byId, [...byId.values()]);
  const n = F.lists().length;
  const maj = F.importShared(recu, resolved, byId);
  assert.equal(maj.id, l.id);
  assert.equal(F.lists().length, n); // pas de doublon
  assert.deepEqual(F.get(l.id).ids, ["a", "b"]);
  assert.deepEqual(G.actifs(F.groupe(l.id)).map((m) => m.n).sort(), ["Léa", "Tom"]);
});

test("html : puces, dossard, échappement, lecture seule", () => {
  const g = { membres: [{ n: "<b>", c: { a: "7" }, t: 1 }] };
  const esc = (s) => String(s).replace(/</g, "&lt;");
  const h = G.html([r("a", "2027-05-01", 20), r("b", "2027-06-01", 40)], g, esc);
  assert.match(h, /&lt;b> <span class="gp-dos">n° 7<\/span>/);
  assert.match(h, /Personne pour l'instant/);
  assert.match(h, /<form class="gp-form"/);
  const lecture = G.html([r("a", "2027-05-01", 20)], g, esc, { edition: false });
  assert.doesNotMatch(lecture, /<form|gp-x/);
});
