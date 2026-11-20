const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("donnees.js", "session.js");
const D = globalThis.Donnees;

const base = [{ id: "trail-x", nom: "Trail des Crêtes", date: "2027-05-16", distance_km: 25 }];
const ligne = (o) => ({ id: "membre-1", nom: "Trail du Test", course: "12 km", date: "2027-06-01", date_confirmee: "true", ville: "Millau",
  code_postal: "12100", departement: "12", lat: "44.1", lon: "3.08", distance_km: "12", denivele_pos_m: "450", type: "trail",
  nocturne: "false", prix_eur: "", notes: "", heure_depart: "09:00", ...o });

test("courses ajoutées : converties au format de la base, champs calculés compris", () => {
  const [r] = D.fromMembres([ligne()], base, new Map([["12", "Aveyron"]]), new Map([["76", "Occitanie"]]), () => ({ dep: "12", reg: "76" }));
  assert.equal(r.id, "membre-1");
  assert.equal(r.distance_km, 12);
  assert.equal(r.denivele_pos_m, 450);
  assert.equal(r.km_effort, 16.5);
  assert.equal(r.departement, "Aveyron");
  assert.equal(r.region, "Occitanie");
  assert.equal(r.date_confirmee, true);
  assert.equal(r.nocturne, false);
  assert.equal(r.heure_depart, "09:00");
  assert.equal(r.membre, true);
});

test("courses ajoutées : écartées si déjà dans la base ou sans coordonnées", () => {
  const rows = [ligne({ id: "membre-2", nom: "Trail des Cretes", date: "2027-05-16", distance_km: "25" }), ligne({ id: "membre-3", lat: "" }),
    ligne({ id: "trail-x" })];
  assert.deepEqual(D.fromMembres(rows, base), []);
  assert.deepEqual(D.fromMembres(null, base), []);
});

test("session : sans page ni API, le module se charge sans rien modifier", () => {
  assert.equal(typeof globalThis.Session.api, "function");
  assert.equal(typeof globalThis.Session.me, "function");
});
