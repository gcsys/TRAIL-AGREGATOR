const test = require("node:test");
const assert = require("node:assert/strict");

// Faux localStorage, installé avant de charger le module.
function fauxStockage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    _m: m,
  };
}
globalThis.localStorage = fauxStockage({ "ta.mode": "table", "autre.site": "x" });
require("./charger")("donnees.js", "favoris.js");
const F = globalThis.Favoris;

const r = { id: "t-80", nom: "Trail des Templiers", ville: "Millau", distance_km: 80, date: "2027-10" };
const r2 = { id: "t-42", nom: "Marathon des Causses", ville: "Millau", distance_km: 42, date: "2027-10" };

test("sauvegarde : copie toutes les clés du site, rien d'autre", () => {
  const l = F.create("Objectifs");
  F.toggle(l.id, r);
  F.setEdit(r.id, { denivele_pos_m: 3500, notes_perso: "à faire" });
  const s = F.exportAll();
  assert.equal(s.format, "agregatrail-sauvegarde");
  assert.equal(s.donnees["ta.mode"], "table");
  assert.ok(!("autre.site" in s.donnees));
  assert.equal(JSON.parse(s.donnees["ta.lists.v1"])[0].name, "Objectifs");
  assert.equal(JSON.parse(s.donnees["ta.edits.v1"])[r.id].notes_perso, "à faire");
  // le fichier passe par JSON (téléchargement puis lecture)
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test("état de la sauvegarde : changé tant qu'aucun fichier n'est fait, puis à jour", () => {
  assert.equal(F.backupStatus().changed, true);
  F.markBackup();
  assert.equal(F.backupStatus().changed, false);
  assert.ok(F.backupStatus().at);
});

test("restauration dans un navigateur vidé : tout revient", () => {
  const fichier = JSON.parse(JSON.stringify(F.exportAll()));
  globalThis.localStorage._m.clear();
  // simule un rechargement de page : le module relit le stockage vide
  F.reload();
  assert.equal(F.lists().length, 0);
  const res = F.importAll(fichier);
  assert.equal(res.ajoutees, 1);
  assert.equal(res.reglages, 1); // ta.mode
  assert.equal(globalThis.localStorage.getItem("ta.mode"), "table");
  assert.ok(F.isFav(r.id));
  assert.equal(F.editOf(r.id).denivele_pos_m, 3500);
  assert.equal(F.backupStatus().changed, false);
});

test("restauration par-dessus des listes existantes : fusion sans perte", () => {
  const fichier = JSON.parse(JSON.stringify(F.exportAll()));
  const obj = F.lists().find((l) => l.name === "Objectifs");
  F.toggle(obj.id, r2); // ajoutée après la sauvegarde
  F.setEdit(r.id, { denivele_pos_m: 3600 }); // correction plus récente
  F.create("Nouvelle");
  // la sauvegarde contient une liste de plus, avec une course en plus
  const ls = JSON.parse(fichier.donnees["ta.lists.v1"]);
  ls.push({ id: "autre", name: "Objectifs", ids: ["t-99"] });
  ls[0].ids.push("t-10");
  fichier.donnees["ta.lists.v1"] = JSON.stringify(ls);
  const res = F.importAll(fichier);
  assert.deepEqual(res, { ajoutees: 1, completees: 1, reglages: 0 });
  assert.deepEqual(F.get(obj.id).ids, ["t-80", "t-42", "t-10"]);
  assert.equal(F.get("autre").name, "Objectifs (2)");
  assert.ok(F.lists().some((l) => l.name === "Nouvelle"));
  assert.equal(F.editOf(r.id).denivele_pos_m, 3600);
});

test("fichier qui n'est pas une sauvegarde : refusé", () => {
  assert.throws(() => F.importAll({ format: "autre", donnees: {} }));
  assert.throws(() => F.importAll(null));
});
