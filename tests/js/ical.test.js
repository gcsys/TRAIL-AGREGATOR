const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("ical.js");
const I = globalThis.Ical;

const r = (o) => ({ id: "t-26", nom: "Trail des Templiers", ville: "Millau", departement_code: "12", date: "2027-10-24", date_confirmee: true,
  distance_km: 26, denivele_pos_m: 1200, lat: 44.1, lon: 3.08, site_web: "https://www.festival-des-templiers.com", ...o });
const maintenant = new Date(Date.UTC(2026, 10, 12, 14, 0, 0));

test("structure du calendrier et d'un événement", () => {
  const { texte, exportees } = I.construire([r()], { nom: "Objectifs 2027", maintenant });
  assert.equal(exportees, 1);
  assert.ok(texte.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(texte.endsWith("END:VCALENDAR\r\n"));
  for (const l of ["UID:t-26@agregatrail", "DTSTAMP:20261112T140000Z", "DTSTART;VALUE=DATE:20271024", "DTEND;VALUE=DATE:20271025",
    "SUMMARY:Trail des Templiers – 26 km", "LOCATION:Millau (12)", "GEO:44.1;3.08", "X-WR-CALNAME:Objectifs 2027"])
    assert.ok(texte.includes(l + "\r\n"), l);
});

test("fin de mois et fin d'année pour DTEND", () => {
  assert.ok(I.construire([r({ date: "2027-12-31" })]).texte.includes("DTEND;VALUE=DATE:20280101"));
});

test("heure de départ et date à confirmer dans le titre", () => {
  const { texte } = I.construire([r({ heure_depart: "07:30", date_confirmee: false })]);
  assert.ok(texte.includes("SUMMARY:Trail des Templiers – 26 km · départ 7 h 30 (date à confirmer)"));
});

test("dates au mois près écartées", () => {
  const { exportees, ecartees, texte } = I.construire([r(), r({ id: "x", date: "2027-05" }), r({ id: "y", date: null })]);
  assert.equal(exportees, 1);
  assert.deepEqual(ecartees.map((x) => x.id), ["x", "y"]);
  assert.equal(texte.match(/BEGIN:VEVENT/g).length, 1);
});

test("échappement des caractères spéciaux", () => {
  const { texte } = I.construire([r({ nom: "Trail, nuit; et \\ retour" })]);
  assert.ok(texte.includes("SUMMARY:Trail\\, nuit\; et \\\\ retour"));
});

test("lignes pliées à 75 octets sans couper un caractère accentué", () => {
  const longue = "DESCRIPTION:" + "é".repeat(100);
  const plie = I.plier(longue);
  const lignes = plie.split("\r\n");
  assert.ok(lignes.length > 1);
  lignes.forEach((l) => assert.ok(Buffer.byteLength(l) <= 75, l));
  assert.equal(lignes.map((l, i) => (i ? l.slice(1) : l)).join(""), longue);
});

test("nom de fichier", () => {
  assert.equal(I.fichier("Objectifs 2027 !"), "objectifs-2027.ics");
  assert.equal(I.fichier(""), "agregatrail.ics");
});
