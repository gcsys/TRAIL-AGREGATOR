const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("./charger")("donnees.js");
const D = globalThis.Donnees;

test("arrondi du km-effort identique à Python (cas à mi-chemin vers le pair)", () => {
  assert.equal(D.kmEffort(10, 325), 13.2); // Python : round(13.25, 1) = 13.2
  assert.equal(D.kmEffort(7, 125), 8.2);
  assert.equal(D.kmEffort(10, 335), 13.3); // 13,35 vaut 13,3499… en binaire : 13,3, comme Python
  assert.equal(D.kmEffort(20, 1000), 30);
  assert.equal(D.kmEffort(null, 1000), null);
  assert.equal(D.kmEffort(20, null), null);
});

test("catégories estimées", () => {
  assert.equal(D.utmbCategory(19.9), null);
  assert.equal(D.utmbCategory(45), "50K");
  assert.equal(D.utmbCategory(155), "100M");
  assert.equal(D.itraPoints(24.9), 0);
  assert.equal(D.itraPoints(210), 6);
});

test("décodage d'un index en colonnes", () => {
  const index = {
    count: 2, flags: ["date_confirmee", "utmb_world_series", "nocturne"],
    dicts: { nom: ["Trail A"], departement_code: ["12", ""], region_code: ["76", ""] },
    cols: { id: ["a", "b"], nom: [0, 0], date: ["2027-05-16", ""], distance_km: [20, 10], denivele_pos_m: [1000, null],
      departement_code: [0, 1], region_code: [0, 1], flags: [0b101, 0] },
  };
  const [a, b] = D.decode(index, new Map([["12", "Aveyron"]]), new Map([["76", "Occitanie"]]));
  assert.deepEqual(
    { nom: a.nom, conf: a.date_confirmee, ws: a.utmb_world_series, nuit: a.nocturne, ke: a.km_effort, utmb: a.utmb_index, dep: a.departement, reg: a.region },
    { nom: "Trail A", conf: true, ws: false, nuit: true, ke: 30, utmb: "20K", dep: "Aveyron", reg: "Occitanie" }
  );
  assert.equal(b.date, null);
  assert.equal(b.departement_code, null);
  assert.equal(b.km_effort, null);
});

test("l'index publié redonne races.json (champs calculés compris)", () => {
  const dir = path.join(__dirname, "..", "..", "site");
  const j = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const names = (f) => new Map(j(f).features.map((x) => [x.properties.code, x.properties.nom]));
  const races = j("data/races.json").races;
  const dec = D.decode(j("data/index.json"), names("geo/departements.geojson"), names("geo/regions.geojson"));
  assert.equal(dec.length, races.length);
  const champs = ["id", "nom", "date", "distance_km", "denivele_pos_m", "km_effort", "utmb_index", "itra_points_estimes", "departement", "region", "nocturne", "date_confirmee"];
  races.forEach((r, i) => champs.forEach((k) => assert.equal(dec[i][k] ?? null, r[k] ?? null, `${r.id} ${k}`)));
});
