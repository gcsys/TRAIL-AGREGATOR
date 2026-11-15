const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("dispo.js");
const D = globalThis.Dispo;

// réglage de test : un week-end sur deux à partir du samedi 8 mai 2027 (indisponible)
D.set({ on: true, ref: "2027-05-08", every: 2, hide: true });

test("week-end de référence indisponible, le suivant libre, puis alternance", () => {
  assert.ok(D.blocked("2027-05-08"));
  assert.ok(D.blocked("2027-05-09")); // dimanche du même week-end
  assert.ok(!D.blocked("2027-05-15"));
  assert.ok(D.blocked("2027-05-22"));
  assert.ok(D.blocked("2027-04-24")); // avant la référence aussi
});

test("un jour de semaine n'est jamais bloqué", () => assert.ok(!D.blocked("2027-05-10")));

test("changement d'heure sans effet (fin octobre)", () => {
  // 8 mai + 24 semaines = 23 octobre (bloqué) ; 30/31 octobre = changement d'heure (libre)
  assert.ok(D.blocked("2027-10-23"));
  assert.ok(!D.blocked("2027-10-31"));
});

test("statut d'une course", () => {
  assert.equal(D.status({ date: "2027-05-15", date_confirmee: true }), "ok");
  assert.equal(D.status({ date: "2027-05-08", date_confirmee: true }), "busy");
  assert.equal(D.status({ date: "2027-05", date_confirmee: false }), "unsure");
  assert.equal(D.status({ date: "2027-05-15", date_confirmee: false }), "unsure");
});

test("indicateur coupé : pas de statut", () => {
  D.set({ on: false });
  assert.equal(D.status({ date: "2027-05-08", date_confirmee: true }), null);
  D.set({ on: true });
});

test("prochains week-ends indisponibles", () => {
  assert.deepEqual(D.next(3, new Date(2027, 4, 10)), ["2027-05-22", "2027-06-05", "2027-06-19"]);
});

// ----- Calendrier : coches et semaines entières -----
const base = () => D.clean({ on: true, every: 2, ref: "2027-05-08", marks: {} }, new Date(2027, 4, 1));

test("ancien réglage (ref + every) repris comme rythme", () => {
  const c = D.clean({ on: true, ref: "2027-05-08", every: 2, hide: true });
  assert.deepEqual(c.marks, {});
  assert.ok(D.blockedIn(c, "2027-05-22"));
});

test("toucher un week-end libre le bloque, le retoucher le libère", () => {
  let c = D.toggleWeekend(base(), "2027-05-15");
  assert.equal(c.marks["2027-05-10"], "busy");
  assert.ok(D.blockedIn(c, "2027-05-16"));
  c = D.toggleWeekend(c, "2027-05-16"); // le dimanche désigne le même week-end
  assert.deepEqual(c.marks, {});
  assert.ok(!D.blockedIn(c, "2027-05-15"));
});

test("libérer un week-end pris par le rythme", () => {
  const c = D.toggleWeekend(base(), "2027-05-22");
  assert.equal(c.marks["2027-05-17"], "free");
  assert.ok(!D.blockedIn(c, "2027-05-22"));
  assert.ok(D.blockedIn(c, "2027-06-05")); // le rythme continue
  assert.deepEqual(D.weekend(c, "2027-05-22"), { busy: false, source: "mark", mark: "free" });
});

test("semaine entière : tous les jours bloqués, puis retour à la normale", () => {
  let c = D.toggleWeek(base(), "2027-05-12");
  assert.ok(D.blockedIn(c, "2027-05-10"));
  assert.ok(D.blockedIn(c, "2027-05-13"));
  assert.ok(D.blockedIn(c, "2027-05-16"));
  assert.ok(!D.blockedIn(c, "2027-05-17"));
  c = D.toggleWeek(c, "2027-05-10");
  assert.ok(!D.blockedIn(c, "2027-05-13"));
});

test("sans rythme : seules les coches comptent", () => {
  let c = D.clean({ every: 0, ref: null, marks: {} });
  assert.ok(!D.usable(c));
  c = D.toggleWeekend(c, "2027-06-12");
  assert.ok(D.usable(c));
  assert.ok(D.blockedIn(c, "2027-06-12"));
  assert.ok(!D.blockedIn(c, "2027-06-19"));
});

test("coches de plus d'un an oubliées", () => {
  const c = D.clean({ every: 0, marks: { "2025-01-06": "busy", "2027-05-10": "week" } }, new Date(2027, 4, 1));
  assert.deepEqual(c.marks, { "2027-05-10": "week" });
});

test("calendrier d'un mois : une ligne par semaine, week-end en une case", () => {
  const c = D.toggleWeek(base(), "2027-05-17");
  const h = D.calendarHtml(c, "2027-05", { today: "2027-05-01", count: (s) => (s === "2027-05-15" ? 3 : 0) });
  assert.equal((h.match(/class="dc-row/g) || []).length, 7); // 26 avril -> 6 juin (le 31 mai est un lundi)
  assert.match(h, /data-we="2027-05-08" aria-pressed="true"/);
  assert.match(h, /data-we="2027-05-15" aria-pressed="false"/);
  assert.match(h, /3 courses/);
  assert.match(h, /data-week="2027-05-17" aria-pressed="true"/);
  assert.match(h, /src-rythme/);
});

test("libellés et bilan", () => {
  assert.equal(D.weLabel("2027-05-15"), "15-16 mai");
  assert.equal(D.weLabel("2027-07-31"), "31 juil.-1 août");
  assert.deepEqual(D.tally(base(), 4, new Date(2027, 4, 3)), { free: 2, busy: 2 });
});
