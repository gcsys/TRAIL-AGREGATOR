/* Disponibilités (bêta) : les week-ends (ou semaines entières) où l'on n'est pas libre.
 * Deux façons de les indiquer, qui se combinent :
 *   - un rythme facultatif (« un week-end sur deux », sur trois, sur quatre) à partir d'un samedi ;
 *   - des coches sur un calendrier : un week-end indisponible, un week-end libre malgré le
 *     rythme, ou une semaine entière indisponible (du lundi au dimanche).
 * Le réglage reste dans ce navigateur (rien n'est publié ni partagé).
 * Pastille par course :
 *   vert   = date confirmée, hors période indisponible
 *   orange = date non confirmée (ou seulement le mois)
 *   rouge  = date confirmée, tombe un week-end ou une semaine indisponible
 * Aucune dépendance au DOM. Les fonctions pures prennent un réglage en paramètre, pour que
 * le calendrier du réglage travaille sur un brouillon sans toucher au réglage enregistré. */
(function (root) {
  const KEY = "ta.dispo.v1"; // même clé qu'avant : l'ancien réglage (ref + every) reste valable
  const DAY = 864e5;
  const WEEK = 7 * DAY;
  const MARKS = ["busy", "free", "week"];

  const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  // Jour en UTC pour que les changements d'heure ne décalent pas le calcul.
  const utc = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const dow = (t) => new Date(t).getUTCDay();
  const mondayOf = (isoDate) => {
    const t = utc(isoDate);
    return iso(t - ((dow(t) + 6) % 7) * DAY);
  };
  const saturdayOf = (isoDate) => iso(utc(mondayOf(isoDate)) + 5 * DAY);
  const todayIso = (from = new Date()) => iso(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));

  /* Réglage propre : rythme borné, coches valides, coches de plus d'un an supprimées. */
  function clean(c, now = new Date()) {
    const every = Math.max(0, Math.min(8, Math.round(Number(c.every) || 0)));
    const limit = iso(utc(todayIso(now)) - 400 * DAY);
    const marks = {};
    for (const [k, v] of Object.entries(c.marks || {}))
      if (isIso(k) && MARKS.includes(v) && k >= limit) marks[mondayOf(k)] = v;
    return { on: !!c.on, hide: c.hide !== false, every, ref: isIso(c.ref) ? c.ref : null, marks };
  }

  /* Le rythme seul dit-il que ce week-end (samedi ISO) est pris ? */
  function rhythmBusy(c, sat) {
    if (!c.every || !isIso(c.ref)) return false;
    const weeks = Math.round((utc(mondayOf(sat)) - utc(mondayOf(c.ref))) / WEEK);
    return ((weeks % c.every) + c.every) % c.every === 0;
  }

  /* État d'un week-end (n'importe quel jour de la semaine) :
   * {busy, source: "week" | "mark" | "rythme" | null, mark} */
  function weekend(c, day) {
    const mark = (c.marks || {})[mondayOf(day)] || null;
    if (mark === "week") return { busy: true, source: "week", mark };
    if (mark === "busy") return { busy: true, source: "mark", mark };
    if (mark === "free") return { busy: false, source: "mark", mark };
    const r = rhythmBusy(c, saturdayOf(day));
    return { busy: r, source: r ? "rythme" : null, mark };
  }

  /* La date (AAAA-MM-JJ) tombe-t-elle sur une période indisponible ? */
  function blockedIn(c, day) {
    if (!isIso(day)) return false;
    const w = weekend(c, day);
    if (w.source === "week") return true;
    const d = dow(utc(day));
    return (d === 6 || d === 0) && w.busy;
  }

  /* Toucher un week-end : il passe de libre à pris, ou l'inverse. On n'enregistre une coche
   * que si elle change quelque chose par rapport au rythme. Renvoie un nouveau réglage. */
  function toggleWeekend(c, day) {
    const mon = mondayOf(day), marks = { ...c.marks };
    const nowBusy = weekend(c, day).busy;
    const r = rhythmBusy(c, saturdayOf(day));
    delete marks[mon];
    if (!nowBusy !== r) marks[mon] = nowBusy ? "free" : "busy";
    return { ...c, marks };
  }

  /* Toucher une semaine : semaine entière indisponible, ou retour à l'état normal. */
  function toggleWeek(c, day) {
    const mon = mondayOf(day), marks = { ...c.marks };
    if (marks[mon] === "week") delete marks[mon];
    else marks[mon] = "week";
    return { ...c, marks };
  }

  /* Prochains week-ends indisponibles (samedis ISO), week-end en cours compris. */
  function nextIn(c, n = 4, from = new Date()) {
    const out = [];
    let t = utc(saturdayOf(todayIso(from)));
    for (let i = 0; i < 160 && out.length < n; i++, t += WEEK) if (weekend(c, iso(t)).busy) out.push(iso(t));
    return out;
  }

  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const dm = (t) => `${new Date(t).getUTCDate()} ${MOIS_C[new Date(t).getUTCMonth()]}`;

  /* « 14-15 nov. » ou « 31 oct.-1 nov. » pour un samedi ISO. */
  function weLabel(sat) {
    const s = utc(sat), d = s + DAY;
    return new Date(s).getUTCMonth() === new Date(d).getUTCMonth()
      ? `${new Date(s).getUTCDate()}-${dm(d)}`
      : `${dm(s)}-${dm(d)}`;
  }

  /* Calendrier du réglage pour un mois (AAAA-MM) : une ligne par semaine qui touche le mois,
   * un bouton « semaine », les cinq jours de semaine, puis le week-end en une seule grande case.
   * opts.count(samedi) : nombre de courses ce week-end (facultatif). */
  function calendarHtml(c, ym, { count = () => 0, today = todayIso() } = {}) {
    const [y, m] = ym.split("-").map(Number);
    const first = Date.UTC(y, m - 1, 1), last = Date.UTC(y, m, 0);
    const curMon = mondayOf(today);
    let t = utc(mondayOf(iso(first)));
    const rows = [];
    for (; t <= last; t += WEEK) {
      const mon = iso(t), sat = iso(t + 5 * DAY);
      const w = weekend(c, sat);
      const past = mon < curMon;
      const dis = past ? " disabled" : "";
      const days = [0, 1, 2, 3, 4].map((i) => {
        const d = t + i * DAY, out = new Date(d).getUTCMonth() !== m - 1;
        return `<span class="dc-day${out ? " out" : ""}${iso(d) === today ? " auj" : ""}" aria-hidden="true">${new Date(d).getUTCDate()}</span>`;
      }).join("");
      const n = count(sat);
      const etat = w.busy ? "busy" : "free";
      const src = w.source === "rythme" ? " src-rythme" : w.source === "week" ? " src-week" : w.mark ? " src-mark" : "";
      const quoi = w.source === "week" ? "semaine prise" : w.busy ? "pris" : "libre";
      const pourquoi = w.source === "rythme" ? " (rythme)" : "";
      const lbl = `Week-end du ${weLabel(sat)} : ${quoi}${pourquoi}${n ? `, ${n} course${n > 1 ? "s" : ""}` : ""}. Toucher pour ${w.busy ? "le libérer" : "le bloquer"}.`;
      rows.push(
        `<div class="dc-row${w.source === "week" ? " wk-on" : ""}${past ? " past" : ""}" role="group" aria-label="Semaine du ${dm(t)}">` +
          `<button type="button" class="dc-wk" data-week="${mon}" aria-pressed="${w.source === "week"}"${dis} title="Semaine entière indisponible" aria-label="Semaine entière du ${dm(t)} au ${dm(t + 6 * DAY)} indisponible">` +
          `<span aria-hidden="true">${w.source === "week" ? "✕" : "sem."}</span></button>` +
          days +
          `<button type="button" class="dc-we ${etat}${src}" data-we="${sat}" aria-pressed="${w.busy}"${w.source === "week" || past ? " disabled" : ""} aria-label="${lbl}">` +
          `<span class="dc-we-d">${new Date(t + 5 * DAY).getUTCDate()}<i>-</i>${new Date(t + 6 * DAY).getUTCDate()}</span>` +
          `<span class="dc-we-s"><i class="dc-ico" aria-hidden="true"></i>${quoi === "semaine prise" ? "pris" : quoi}${w.source === "rythme" ? '<i class="dc-rep" title="Vient du rythme">↻</i>' : ""}</span>` +
          (n ? `<small class="dc-n">${n} course${n > 1 ? "s" : ""}</small>` : "") +
          `</button></div>`
      );
    }
    return (
      `<div class="dc-head" aria-hidden="true"><span></span><span>lun.</span><span>mar.</span><span>mer.</span><span>jeu.</span><span>ven.</span><span>week-end</span></div>` +
      `<div class="dc-rows" data-ym="${ym}" aria-label="${MOIS[m - 1]} ${y}">${rows.join("")}</div>`
    );
  }
  const monthTitle = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return `${MOIS[m - 1]} ${y}`;
  };

  /* Bilan sur une période : {free, busy} week-ends à partir d'aujourd'hui, sur n semaines. */
  function tally(c, weeks = 13, from = new Date()) {
    let t = utc(saturdayOf(todayIso(from))), free = 0, busy = 0;
    for (let i = 0; i < weeks; i++, t += WEEK) weekend(c, iso(t)).busy ? busy++ : free++;
    return { free, busy };
  }

  /* Le réglage dit-il quelque chose ? (rythme ou au moins une coche « pris ») */
  const usable = (c) => (!!c.every && isIso(c.ref)) || Object.values(c.marks || {}).some((v) => v !== "free");

  const read = () => {
    try {
      return JSON.parse(root.localStorage.getItem(KEY)) || null;
    } catch (e) {
      return null;
    }
  };
  // Sans réglage enregistré : un week-end sur deux à partir du samedi ci-dessous.
  // Modifiable depuis le site (calendrier du réglage), sans toucher au code.
  const DEFAULT = { on: false, hide: true, every: 2, ref: "2027-05-08", marks: {} };
  const saved = read();
  // Ancien format (ref + every, sans coches) : repris tel quel comme rythme.
  let cfg = clean(saved ? { ...DEFAULT, ...saved, ref: saved.ref || DEFAULT.ref } : DEFAULT);
  const save = () => {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (e) {
      /* navigation privée : réglage gardé le temps de la visite */
    }
  };

  const D = {
    config: () => ({ ...cfg, marks: { ...cfg.marks } }),
    ready: () => usable(cfg),
    active: () => cfg.on && usable(cfg),
    hiding: () => D.active() && cfg.hide,
    set(patch) {
      cfg = clean({ ...cfg, ...patch });
      save();
    },
    blocked: (day) => blockedIn(cfg, day),

    /* "ok" | "unsure" | "busy" pour une course, null si l'indicateur est coupé. */
    status(r) {
      if (!D.active()) return null;
      if (!r.date_confirmee || !isIso(r.date)) return "unsure";
      return D.blocked(r.date) ? "busy" : "ok";
    },
    label: {
      ok: "Date confirmée, vous êtes disponible",
      unsure: "Date à confirmer",
      busy: "Date confirmée, vous n'êtes pas disponible",
    },
    next: (n, from) => nextIn(cfg, n, from),

    // Outils purs pour le calendrier du réglage (brouillon).
    clean, usable, weekend, blockedIn, toggleWeekend, toggleWeek, nextIn, rhythmBusy, mondayOf, saturdayOf, todayIso,
    calendarHtml, monthTitle, weLabel, tally,
  };

  root.Dispo = D;
})(typeof window !== "undefined" ? window : globalThis);
