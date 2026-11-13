const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("langage.js");
const { analyser } = globalThis.Langage;
const AUJ = "2026-11-13"; // vendredi

test("distance, mois et temps de route", () => {
  const a = analyser("trail de 20 à 30 km en mai à moins d'1 h de Lyon", AUJ);
  assert.equal(a.kmMin, 20);
  assert.equal(a.kmMax, 30);
  assert.deepEqual(a.mois, ["2027-05"]);
  assert.deepEqual(a.autour, { lieu: "lyon", minutes: 60 });
  assert.equal(a.reste, "");
  assert.deepEqual(a.pastilles, ["1 h de route autour de lyon", "20–30 km", "mai 2027"]);
});

test("rayon en km, D+ maximum, profil et nuit", () => {
  const a = analyser("course nocturne vallonnée moins de 1000 m de d+ à 50 km de Montpellier", AUJ);
  assert.deepEqual(a.autour, { lieu: "montpellier", km: 50 });
  assert.equal(a.dMax, 1000);
  assert.equal(a.kmMin, undefined); // « 1000 m » n'est pas une distance
  assert.deepEqual(a.profils, ["vallonne"]);
  assert.equal(a.nuit, true);
});

test("distance approximative, bornes simples, semi, ultra", () => {
  assert.deepEqual([analyser("environ 40 km", AUJ).kmMin, analyser("environ 40 km", AUJ).kmMax], [34, 46]);
  assert.equal(analyser("plus de 50 km", AUJ).kmMin, 50);
  assert.equal(analyser("max 15km", AUJ).kmMax, 15);
  assert.deepEqual([analyser("un semi", AUJ).kmMin, analyser("un semi", AUJ).kmMax], [18, 25]);
  assert.equal(analyser("ultra en montagne", AUJ).kmMin, 80);
});

test("périodes : mois passé l'an prochain, saison, week-end, d'ici N jours", () => {
  assert.deepEqual(analyser("en novembre ou décembre", AUJ).mois, ["2026-11", "2026-12"]);
  assert.deepEqual(analyser("en mars 2028", AUJ).mois, ["2028-03"]);
  assert.deepEqual(analyser("cet été", AUJ).mois, ["2027-06", "2027-07", "2027-08"]);
  const we = analyser("ce week-end", AUJ);
  assert.deepEqual([we.du, we.au], ["2026-11-14", "2026-11-15"]);
  const ici = analyser("dans les 30 jours", AUJ);
  assert.deepEqual([ici.du, ici.au], ["2026-11-13", "2026-12-13"]);
  assert.deepEqual(analyser("le mois prochain", AUJ).mois, ["2026-12"]);
});

test("autour de / près de, et texte libre conservé", () => {
  const a = analyser("templiers près de Millau", AUJ);
  assert.deepEqual(a.autour, { lieu: "millau", km: 30 });
  assert.equal(a.reste, "templiers");
  const b = analyser("Trail des Templiers", AUJ);
  assert.deepEqual(b.pastilles, []);
  assert.equal(b.reste, "templiers");
});
