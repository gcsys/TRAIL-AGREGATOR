const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("donnees.js", "favoris.js");
const F = globalThis.Favoris;

const r = { id: "t-80", nom: "Trail des Templiers", ville: "Millau", distance_km: 80, denivele_pos_m: null, km_effort: null, date: "2027-10" };

test("listes : créer, ajouter, retirer, noms uniques", () => {
  const l = F.create("Objectifs");
  assert.equal(F.create("objectifs").name, "objectifs (2)");
  assert.ok(F.toggle(l.id, r));
  assert.ok(F.isFav(r.id));
  assert.ok(!F.toggle(l.id, r));
  assert.ok(!F.isFav(r.id));
});

test("correction perso : recalcule km-effort, UTMB et ITRA", () => {
  const o = F.apply(r, { denivele_pos_m: 3500, date: "2027-10-24" });
  assert.equal(o.km_effort, 115);
  assert.equal(o.utmb_index, "100K");
  assert.equal(o.itra_points_estimes, 4);
  assert.equal(o.date_confirmee, true);
  assert.equal(o._orig, r);
  assert.equal(F.apply(r, undefined), r);
});

test("partage : encode puis décode, sans les notes perso", async () => {
  const l = F.create("Partage", [r.id]);
  F.setEdit(r.id, { denivele_pos_m: 3500, notes_perso: "privé" });
  const code = await F.encode(l, new Map([[r.id, r]]));
  assert.match(code, /^[zj][A-Za-z0-9_-]+$/);
  const back = await F.decode(code);
  assert.equal(back.name, "Partage");
  assert.deepEqual(back.ids, [r.id]);
  assert.deepEqual(back.edits[r.id], { denivele_pos_m: 3500 });
  assert.deepEqual(back.hints[r.id], ["Trail des Templiers", "Millau", 80]);
});

test("liste partagée : rattachement par nom + commune + km quand l'id a changé", () => {
  const nouvelle = { ...r, id: "t-80-v2" };
  const res = F.resolveShared({ ids: ["t-80"], hints: { "t-80": ["Trail des Templiers", "Millau", 80] } }, new Map(), [nouvelle]);
  assert.deepEqual(res, [{ from: "t-80", to: "t-80-v2" }]);
});

test("lien de partage invalide refusé", async () => {
  await assert.rejects(F.decode("xabc"));
});
