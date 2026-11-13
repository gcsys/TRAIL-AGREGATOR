const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("historique.js");
const H = globalThis.Historique;

test("rien à dire : pas de section", () => {
  assert.equal(H.html(undefined), "");
  assert.equal(H.html({}), "");
});

test("habitude, estimation marquée et éditions précédentes", () => {
  const h = H.html({ habitude: "3e week-end de mai", n: 2, estimation_texte: "samedi 15 mai 2027",
    precedentes: [["2025-05-17", [20]], ["2026-05-16", [22.5, 42]]] });
  assert.ok(h.includes("<h4>Éditions</h4>"));
  assert.ok(h.includes("3e week-end de mai"));
  assert.ok(h.includes("estimation"));
  assert.ok(h.includes("d'après 2 éditions"));
  assert.ok(h.includes("à confirmer par l'organisateur"));
  assert.ok(h.indexOf("samedi 16 mai 2026") < h.indexOf("samedi 17 mai 2025"), "plus récente d'abord");
  assert.ok(h.includes("22,5 km, 42 km"));
});

test("changement de date et date inhabituelle", () => {
  const h = H.html({ changements: [{ le: "2026-11-13", avant: "2027-05-15", apres: "2027-06-05" }], habitude: "3e week-end de mai", n: 1, inhabituelle: true });
  assert.ok(h.includes("annoncée le 15 mai, désormais le 5 juin"));
  assert.ok(h.includes("relevé le 13/11/2026"));
  assert.ok(h.includes("d'après l'édition précédente"));
  assert.ok(h.includes("ne suit pas cette habitude"));
});

test("jour : mois seul et 1er", () => {
  assert.equal(H.jour("2027-05"), "mai 2027");
  assert.equal(H.jour("2027-05-01"), "samedi 1er mai 2027");
});

test("échappement", () => {
  const h = H.html({ precedentes: [["2026-05-16", []]] }, (s) => s.replace(/a/g, "@"));
  assert.ok(h.includes("form@ts inconnus"));
});

test("charger : une seule requête, {} en cas d'erreur", async () => {
  let n = 0;
  const f = () => { n++; return Promise.reject(new Error("x")); };
  assert.deepEqual(await H.charger(f), {});
  await H.charger(f);
  assert.equal(n, 1);
});
