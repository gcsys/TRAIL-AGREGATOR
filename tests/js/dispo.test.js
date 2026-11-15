const test = require("node:test");
const assert = require("node:assert/strict");
require("./charger")("dispo.js");
const D = globalThis.Dispo;

// réglage de test : une semaine sur deux, celle du samedi 8 mai 2027 prise (lundi 3 -> dimanche 9)
D.set({ on: true, ref: "2027-05-08", every: 2, hide: true, marks: {} });

test("semaine de référence prise en entier, la suivante libre, puis alternance", () => {
  for (const d of ["2027-05-03", "2027-05-05", "2027-05-07", "2027-05-08", "2027-05-09"]) assert.ok(D.blocked(d), d);
  assert.ok(!D.blocked("2027-05-10"));
  assert.ok(!D.blocked("2027-05-14")); // vendredi d'une semaine libre
  assert.ok(D.blocked("2027-05-21")); // vendredi d'une semaine prise
  assert.ok(D.blocked("2027-04-20")); // avant la référence aussi
});

test("changement d'heure sans effet (fin octobre)", () => {
  // 3 mai + 24 semaines = 18 octobre (prise) ; semaine du 25 (changement d'heure le 31) libre
  assert.ok(D.blocked("2027-10-23"));
  assert.ok(!D.blocked("2027-10-31"));
});

test("statut d'une course", () => {
  assert.equal(D.status({ date: "2027-05-15", date_confirmee: true }), "ok");
  assert.equal(D.status({ date: "2027-05-08", date_confirmee: true }), "busy");
  assert.equal(D.status({ date: "2027-05-06", date_confirmee: true }), "busy"); // un jeudi
  assert.equal(D.status({ date: "2027-05", date_confirmee: false }), "unsure");
  assert.equal(D.status({ date: "2027-05-15", date_confirmee: false }), "unsure");
});

test("indicateur coupé : pas de statut", () => {
  D.set({ on: false });
  assert.equal(D.status({ date: "2027-05-08", date_confirmee: true }), null);
  D.set({ on: true });
});

test("prochaines semaines prises (lundis)", () => {
  assert.deepEqual(D.next(3, new Date(2027, 4, 10)), ["2027-05-17", "2027-05-31", "2027-06-14"]);
  assert.deepEqual(D.next(1, new Date(2027, 4, 9)), ["2027-05-03"]); // semaine en cours comprise
});

// ----- Calendrier : coches par semaine -----
const base = () => D.clean({ on: true, every: 2, ref: "2027-05-08", marks: {} }, new Date(2027, 4, 1));

test("anciens réglages repris sur la semaine qui les contient", () => {
  const c = D.clean({ on: true, ref: "2027-05-08", every: 2, hide: true }, new Date(2027, 4, 1));
  assert.equal(c.ref, "2027-05-03");
  assert.deepEqual(c.marks, {});
  const v2 = D.clean({ every: 0, marks: { "2027-05-10": "week", "2027-05-17": "busy", "2027-05-24": "free" } }, new Date(2027, 4, 1));
  assert.deepEqual(v2.marks, { "2027-05-10": "busy", "2027-05-17": "busy", "2027-05-24": "free" });
  assert.ok(D.blockedIn(v2, "2027-05-12"));
});

test("toucher une semaine libre la bloque en entier, la retoucher la libère", () => {
  let c = D.toggleWeek(base(), "2027-05-13");
  assert.equal(c.marks["2027-05-10"], "busy");
  assert.ok(D.blockedIn(c, "2027-05-10"));
  assert.ok(D.blockedIn(c, "2027-05-14"));
  assert.ok(D.blockedIn(c, "2027-05-16"));
  c = D.toggleWeek(c, "2027-05-16"); // n'importe quel jour désigne la même semaine
  assert.deepEqual(c.marks, {});
  assert.ok(!D.blockedIn(c, "2027-05-14"));
});

test("libérer une semaine prise par le rythme", () => {
  const c = D.toggleWeek(base(), "2027-05-17");
  assert.equal(c.marks["2027-05-17"], "free");
  assert.ok(!D.blockedIn(c, "2027-05-21"));
  assert.ok(D.blockedIn(c, "2027-06-04")); // le rythme continue
  assert.deepEqual(D.week(c, "2027-05-22"), { busy: false, source: "mark", mark: "free" });
});

test("sans rythme : seules les coches comptent", () => {
  let c = D.clean({ every: 0, ref: null, marks: {} });
  assert.ok(!D.usable(c));
  c = D.toggleWeek(c, "2027-06-09");
  assert.ok(D.usable(c));
  assert.ok(D.blockedIn(c, "2027-06-07"));
  assert.ok(!D.blockedIn(c, "2027-06-14"));
});

test("coches de plus d'un an oubliées", () => {
  const c = D.clean({ every: 0, marks: { "2025-01-06": "busy", "2027-05-10": "busy" } }, new Date(2027, 4, 1));
  assert.deepEqual(c.marks, { "2027-05-10": "busy" });
});

test("calendrier d'un mois : une ligne par semaine, à toucher en entier", () => {
  const c = D.toggleWeek(base(), "2027-05-12");
  const h = D.calendarHtml(c, "2027-05", { today: "2027-05-04", count: (m) => (m === "2027-05-10" ? 3 : 0) });
  assert.equal((h.match(/class="dc-row/g) || []).length, 7); // 26 avril -> 6 juin (le 31 mai est un lundi)
  assert.match(h, /data-week="2027-05-03" aria-pressed="true"/);
  assert.match(h, /data-week="2027-05-10" aria-pressed="true"/);
  assert.match(h, /data-week="2027-05-24" aria-pressed="false"/);
  assert.match(h, /3 courses/);
  assert.match(h, /src-rythme/);
  assert.match(h, /data-week="2027-04-26" aria-pressed="false" disabled/); // semaine passée
});

test("libellés et bilan", () => {
  assert.equal(D.weekLabel("2027-05-12"), "10-16 mai");
  assert.equal(D.weekLabel("2027-07-28"), "26 juil.-1 août");
  assert.deepEqual(D.tally(base(), 4, new Date(2027, 4, 3)), { free: 2, busy: 2 });
});
