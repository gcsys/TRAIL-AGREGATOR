const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("calendrier.js");
const C = globalThis.Calendrier;

const ev = (key, date, maxKm = 20) => ({ key, first: { nom: `Trail ${key}`, date, ville: "Millau" }, minKm: maxKm, maxKm });

test("grille du lundi au dimanche", () => {
  const g = C.grille("2027-05"); // 1er mai 2027 : samedi
  assert.deepEqual(g[0], [null, null, null, null, null, "2027-05-01", "2027-05-02"]);
  assert.equal(g.at(-1)[0], "2027-05-31");
  assert.ok(g.every((s) => s.length === 7));
});

test("regroupement par jour, mois flous et mois vides intercalés", () => {
  const r = C.regrouper([ev("a", "2027-03-14"), ev("b", "2027-05"), ev("c", "2027-03-14"), ev("d", null)]);
  assert.deepEqual(r.mois, ["2027-03", "2027-04", "2027-05"]);
  assert.equal(r.jours.get("2027-03-14").length, 2);
  assert.equal(r.flous.get("2027-05")[0].key, "b");
  assert.equal(C.regrouper([ev("a", "2027-01-01"), ev("b", "2030-01-01")]).tronque, true);
});

test("html : courses du jour, week-ends dispo, jour à préciser, échappement", () => {
  const h = C.html([ev("a<b", "2027-05-01"), ev("x", "2027-05")], {
    esc: (s) => String(s).replace(/</g, "&lt;"),
    semaine: (d) => (d === "2027-05-01" ? "busy" : "ok"),
    aujourdhui: "2027-05-02",
  });
  assert.match(h, /<h3>mai 2027 <span class="dim">2 courses<\/span>/);
  assert.match(h, /class="j we we-busy a"/);
  assert.match(h, /class="j we we-ok auj"/);
  assert.match(h, /data-act="fiche" data-key="a&lt;b"/);
  assert.match(h, /Jour à préciser :/);
  assert.equal(C.html([]), "");
});

test("liste d'un jour", () => {
  const h = C.jourHtml([ev("a", "2027-05-01", 42), ev("b", "2027-05-02")], "2027-05-01");
  assert.match(h, /<h4>samedi 1er mai<\/h4>/);
  assert.match(h, /Trail a/);
  assert.doesNotMatch(h, /Trail b/);
  assert.match(h, /42 km/);
});
