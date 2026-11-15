/* Disponibilités (bêta) : les semaines (du lundi au dimanche) où l'on n'est pas libre.
 * L'unité est la semaine entière : une course un mardi, un vendredi ou un dimanche d'une semaine
 * prise est indisponible. Deux façons de l'indiquer, qui se combinent :
 *   - un rythme facultatif (« une semaine sur deux », sur trois, sur quatre) à partir d'une semaine ;
 *   - des coches sur un calendrier : une semaine prise, ou une semaine libre malgré le rythme.
 * Le réglage reste dans ce navigateur (rien n'est publié ni partagé).
 * Pastille par course :
 *   vert   = date confirmée, semaine libre
 *   orange = date non confirmée (ou seulement le mois)
 *   rouge  = date confirmée, semaine prise
 * Aucune dépendance au DOM. Les fonctions pures prennent un réglage en paramètre, pour que
 * le calendrier du réglage travaille sur un brouillon sans toucher au réglage enregistré. */
(function (root) {
  const KEY = "ta.dispo.v1"; // même clé qu'avant : les anciens réglages restent valables
  const DAY = 864e5;
  const WEEK = 7 * DAY;

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
  const todayIso = (from = new Date()) => iso(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));

  /* Réglage propre : rythme borné, coches valides, coches de plus d'un an supprimées.
   * Anciennes coches : « week » (semaine entière) devient « busy ». La référence du rythme est
   * ramenée au lundi ; une ancienne référence (samedi) désigne donc la même semaine. */
  function clean(c, now = new Date()) {
    const every = Math.max(0, Math.min(8, Math.round(Number(c.every) || 0)));
    const limit = iso(utc(todayIso(now)) - 400 * DAY);
    const marks = {};
    for (const [k, v] of Object.entries(c.marks || {})) {
      const m = v === "week" ? "busy" : v;
      if (isIso(k) && (m === "busy" || m === "free") && k >= limit) marks[mondayOf(k)] = m;
    }
    return { on: !!c.on, hide: c.hide !== false, every, ref: isIso(c.ref) ? mondayOf(c.ref) : null, marks };
  }

  /* Le rythme seul dit-il que la semaine de ce jour est prise ? */
  function rhythmBusy(c, day) {
    if (!c.every || !isIso(c.ref)) return false;
    const weeks = Math.round((utc(mondayOf(day)) - utc(mondayOf(c.ref))) / WEEK);
    return ((weeks % c.every) + c.every) % c.every === 0;
  }

  /* État de la semaine d'un jour : {busy, source: "mark" | "rythme" | null, mark} */
  function week(c, day) {
    const mark = (c.marks || {})[mondayOf(day)] || null;
    if (mark === "busy") return { busy: true, source: "mark", mark };
    if (mark === "free") return { busy: false, source: "mark", mark };
    const r = rhythmBusy(c, day);
    return { busy: r, source: r ? "rythme" : null, mark };
  }

  /* La date (AAAA-MM-JJ) tombe-t-elle une semaine prise ? Tous les jours comptent. */
  const blockedIn = (c, day) => isIso(day) && week(c, day).busy;

  /* Toucher une semaine : elle passe de libre à prise, ou l'inverse. On n'enregistre une coche
   * que si elle change quelque chose par rapport au rythme. Renvoie un nouveau réglage. */
  function toggleWeek(c, day) {
    const mon = mondayOf(day), marks = { ...c.marks };
    const nowBusy = week(c, day).busy;
    delete marks[mon];
    if (!nowBusy !== rhythmBusy(c, day)) marks[mon] = nowBusy ? "free" : "busy";
    return { ...c, marks };
  }

  /* Prochaines semaines prises (lundis ISO), semaine en cours comprise. */
  function nextIn(c, n = 4, from = new Date()) {
    const out = [];
    let t = utc(mondayOf(todayIso(from)));
    for (let i = 0; i < 160 && out.length < n; i++, t += WEEK) if (week(c, iso(t)).busy) out.push(iso(t));
    return out;
  }

  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const dm = (t) => `${new Date(t).getUTCDate()} ${MOIS_C[new Date(t).getUTCMonth()]}`;

  /* « 9-15 nov. » ou « 30 nov.-6 déc. » pour la semaine d'un jour. */
  function weekLabel(day) {
    const s = utc(mondayOf(day)), e = s + 6 * DAY;
    return new Date(s).getUTCMonth() === new Date(e).getUTCMonth()
      ? `${new Date(s).getUTCDate()}-${dm(e)}`
      : `${dm(s)}-${dm(e)}`;
  }

  /* Calendrier du réglage pour un mois (AAAA-MM) : chaque semaine qui touche le mois est une
   * ligne à toucher (lundi -> dimanche), avec son état et le nombre de courses.
   * opts.count(lundi) : nombre de courses de la semaine (facultatif). */
  function calendarHtml(c, ym, { count = () => 0, today = todayIso() } = {}) {
    const [y, m] = ym.split("-").map(Number);
    const first = Date.UTC(y, m - 1, 1), last = Date.UTC(y, m, 0);
    const curMon = mondayOf(today);
    const rows = [];
    for (let t = utc(mondayOf(iso(first))); t <= last; t += WEEK) {
      const mon = iso(t), w = week(c, mon), past = mon < curMon, n = count(mon);
      const days = [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const d = t + i * DAY, out = new Date(d).getUTCMonth() !== m - 1;
        return `<span class="dc-day${i >= 5 ? " we" : ""}${out ? " out" : ""}${iso(d) === today ? " auj" : ""}">${new Date(d).getUTCDate()}</span>`;
      }).join("");
      const quoi = w.busy ? "prise" : "libre";
      const lbl = `Semaine du ${weekLabel(mon)} : ${quoi}${w.source === "rythme" ? " (rythme)" : ""}${n ? `, ${n} course${n > 1 ? "s" : ""}` : ""}.${past ? "" : ` Toucher pour la ${w.busy ? "libérer" : "bloquer"}.`}`;
      rows.push(
        `<button type="button" class="dc-row ${w.busy ? "busy" : "free"}${w.source === "rythme" ? " src-rythme" : ""}${past ? " past" : ""}" data-week="${mon}" aria-pressed="${w.busy}"${past ? " disabled" : ""} aria-label="${lbl}">` +
          `<span class="dc-days" aria-hidden="true">${days}</span>` +
          `<span class="dc-st" aria-hidden="true"><span class="dc-st-l"><i class="dc-ico"></i>${quoi}${w.source === "rythme" ? '<i class="dc-rep" title="Vient du rythme">↻</i>' : ""}</span>` +
          (n ? `<small class="dc-n">${n} course${n > 1 ? "s" : ""}</small>` : "") +
          `</span></button>`
      );
    }
    return (
      `<div class="dc-head" aria-hidden="true"><span class="dc-days"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span class="we">S</span><span class="we">D</span></span><span>semaine</span></div>` +
      `<div class="dc-rows" data-ym="${ym}" aria-label="${MOIS[m - 1]} ${y}">${rows.join("")}</div>`
    );
  }
  const monthTitle = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return `${MOIS[m - 1]} ${y}`;
  };

  /* Bilan : {free, busy} semaines à partir de la semaine en cours, sur n semaines. */
  function tally(c, weeks = 13, from = new Date()) {
    let t = utc(mondayOf(todayIso(from))), free = 0, busy = 0;
    for (let i = 0; i < weeks; i++, t += WEEK) week(c, iso(t)).busy ? busy++ : free++;
    return { free, busy };
  }

  /* Le réglage dit-il quelque chose ? (rythme ou au moins une semaine cochée prise) */
  const usable = (c) => (!!c.every && isIso(c.ref)) || Object.values(c.marks || {}).some((v) => v === "busy");

  const read = () => {
    try {
      return JSON.parse(root.localStorage.getItem(KEY)) || null;
    } catch (e) {
      return null;
    }
  };
  // Sans réglage enregistré : une semaine sur deux à partir de celle du samedi ci-dessous.
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
      ok: "Date confirmée, semaine libre",
      unsure: "Date à confirmer",
      busy: "Date confirmée, semaine prise",
    },
    next: (n, from) => nextIn(cfg, n, from),

    // Outils purs pour le calendrier du réglage (brouillon).
    clean, usable, week, blockedIn, toggleWeek, nextIn, rhythmBusy, mondayOf, todayIso,
    calendarHtml, monthTitle, weekLabel, tally,
  };

  root.Dispo = D;
})(typeof window !== "undefined" ? window : globalThis);
