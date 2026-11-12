const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("similaires.js");
const S = globalThis.Similaires;

const c = (id, o) => ({ id, nom: id, ville: "X", date: "2027-05-16", distance_km: 30, denivele_pos_m: 1200, departement_code: "12", region_code: "76", ...o });
const evKey = (r) => r.nom;
const ref = c("ref");

test("la course elle-même est exclue, une ligne par événement", () => {
  const races = [ref, c("ref", { distance_km: 12 }), c("a"), c("a", { distance_km: 15 }), c("b", { distance_km: 60 })];
  const res = S.proches(ref, races, evKey);
  assert.deepEqual(res.map((x) => x.race.nom), ["a", "b"]);
  assert.equal(res[0].race.distance_km, 30); // le format le plus proche de l'événement a
});

test("ordre : distance, puis profil, période et lieu", () => {
  const races = [
    ref,
    c("loin-en-km", { distance_km: 60 }),
    c("plat", { denivele_pos_m: 150 }),
    c("automne", { date: "2027-10-17" }),
    c("autre-region", { departement_code: "05", region_code: "93" }),
    c("jumeau"),
  ];
  const ordre = S.proches(ref, races, evKey, { n: 10 }).map((x) => x.race.nom);
  assert.equal(ordre[0], "jumeau");
  assert.equal(ordre.at(-1), "loin-en-km");
});

test("période sur un cercle : fin décembre proche de début janvier", () => {
  const hiver = c("ref", { date: "2026-12-28" });
  const a = S.score(hiver, c("janvier", { date: "2027-01-04" })).parts.periode;
  const b = S.score(hiver, c("novembre", { date: "2026-11-28" })).parts.periode;
  assert.ok(a < b);
});

test("D+ inconnu : pénalité fixe, pas d'exclusion", () => {
  const res = S.proches(ref, [ref, c("sans-dplus", { denivele_pos_m: null })], evKey);
  assert.equal(res.length, 1);
});

test("autre date : au moins 4 semaines d'écart, la période ne compte plus", () => {
  const races = [ref, c("meme-week-end", { date: "2027-05-15" }), c("juin", { date: "2027-06-20" }), c("septembre", { date: "2027-09-12" })];
  const res = S.proches(ref, races, evKey, { autreDate: true });
  assert.deepEqual(res.map((x) => x.race.nom).sort(), ["juin", "septembre"]);
});

test("raisons lisibles", () => {
  assert.deepEqual(S.raisons(ref, c("x", { date: "2027-05-23" })), ["distance proche", "même profil", "même période", "même département"]);
  assert.deepEqual(S.raisons(ref, c("y", { distance_km: 50, denivele_pos_m: 0, date: "2027-09-01", departement_code: "34" })), ["même région"]);
});

test("sans distance : rien à comparer", () => {
  assert.deepEqual(S.proches(c("ref", { distance_km: null }), [c("a")], evKey), []);
});
