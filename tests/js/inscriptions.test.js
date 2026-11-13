const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("inscriptions.js");
require("./charger")("filtres.js");
const I = globalThis.Inscriptions;
const F = globalThis.Filtres;

const f = (km, inscription) => ({ distance_km: km, inscription });

test("sans relevé : pas de section", () => {
  assert.equal(I.html([f(20, null), f(40, null)]), "");
});

test("statut, mode, prix par format, date de relevé", () => {
  const h = I.html([f(20, { statut: "ouvertes", mode: "tirage", ouverture: "2026-11-02", releve_le: "2026-11-12", prix: 35 }),
                    f(80.5, { statut: "ouvertes", releve_le: "2026-11-12", prix: 95.5 })], undefined, "2026-11-13");
  assert.match(h, /insc-ouvertes">Ouvertes</);
  assert.match(h, /tirage au sort/);
  assert.doesNotMatch(h, /Ouverture/); // déjà ouvertes : la date d'ouverture n'apporte rien
  assert.match(h, /20 km : <b>35 €<\/b><\/span> · <span class="nw">80,5 km : <b>95,5 €<\/b>/);
  assert.match(h, /Relevé le 12\/11\/2026\./);
});

test("relevé ancien ou ouverture dépassée : à vérifier", () => {
  const a = I.html([f(20, { statut: "a_venir", ouverture: "2027-01-10", releve_le: "2026-11-12" })], undefined, "2026-11-20");
  assert.match(a, /Ouverture le <b>10 janvier 2027<\/b>/);
  assert.doesNotMatch(a, /à vérifier/);
  const b = I.html([f(20, { statut: "a_venir", ouverture: "2026-11-15", releve_le: "2026-11-12" })], undefined, "2026-11-20");
  assert.match(b, /Ouverture annoncée le <b>15 novembre 2026<\/b>/);
  assert.match(b, /à vérifier/);
  const c = I.html([f(20, { statut: "ouvertes", releve_le: "2026-09-01" })], undefined, "2026-11-20");
  assert.match(c, /à vérifier/);
});

test("filtre Inscriptions ouvertes", () => {
  const c = F.criteres({ inscr: true });
  assert.equal(F.passe({ inscription: { statut: "ouvertes" } }, c), true);
  assert.equal(F.passe({ inscription: { statut: "complet" } }, c), false);
  assert.equal(F.passe({ inscription: null }, c), false);
  assert.equal(F.passe({ inscription: null }, F.criteres()), true);
});
