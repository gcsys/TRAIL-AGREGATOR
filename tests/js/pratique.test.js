const test = require("node:test");
const assert = require("node:assert");
require("./charger")("pratique.js");
const P = globalThis.Pratique;

const r = { nom: "Trail des Templiers", ville: "Millau", departement_code: "12", lat: 44.0983, lon: 3.0779, date: "2027-03-01" };

test("veille d'un 1er mars (année non bissextile)", () => {
  assert.strictEqual(P.veille("2027-03-01"), "2027-02-28");
  assert.strictEqual(P.veille("2027-01-01"), "2026-12-31");
});

test("liens avec coordonnées, jour et centre de recherche", () => {
  const l = P.liens(r, { lat: 43.6, lon: 3.88 });
  const u = Object.fromEntries(l.map((x) => [x.texte, x.url]));
  assert.match(u["OpenStreetMap"], /route=43\.60000%2C3\.88000%3B44\.09830%2C3\.07790/);
  assert.match(u["Google Maps"], /destination=44\.09830%2C3\.07790&origin=43\.60000%2C3\.88000/);
  assert.match(u["Booking, nuit de la veille"], /ss=Millau&checkin=2027-02-28&checkout=2027-03-01/);
  assert.match(u["BlaBlaCar"], /tn=Millau&db=2027-03-01/);
  assert.deepStrictEqual([...new Set(l.map((x) => x.groupe))], ["Itinéraire", "Hébergement", "Covoiturage"]);
});

test("sans coordonnées ni jour : recherche par commune, sans dates", () => {
  const l = P.liens({ ville: "Nant", departement_code: "12", date: "2027-05" }, null);
  const u = Object.fromEntries(l.map((x) => [x.texte, x.url]));
  assert.match(u["OpenStreetMap"], /search\?query=Nant%2012/);
  assert.ok(!/origin=/.test(u["Google Maps"]));
  assert.ok(!/checkin/.test(u["Booking"]));
  assert.ok(!/db=/.test(u["BlaBlaCar"]));
});

test("html : liens externes, échappés, mention sans commission", () => {
  const h = P.html({ ...r, ville: 'A"<b>' }, null, (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]));
  assert.ok(!h.includes("<b>"));
  assert.match(h, /rel="noopener nofollow"/);
  assert.match(h, /sans partenariat ni commission/);
});
