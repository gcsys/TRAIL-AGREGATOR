/* Disponibilités (bêta) : week-ends indisponibles qui reviennent à intervalle régulier.
 * Le réglage reste dans ce navigateur (rien n'est publié ni partagé).
 * Pastille par course :
 *   vert   = date confirmée, hors week-end indisponible
 *   orange = date non confirmée (ou seulement le mois)
 *   rouge  = date confirmée, tombe un week-end indisponible
 * Aucune dépendance au DOM. */
(function (root) {
  const KEY = "ta.dispo.v1";
  const DAY = 864e5;

  const read = () => {
    try {
      return JSON.parse(root.localStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  };
  let cfg = { on: false, ref: "", every: 2, hide: false, ...read() };
  const save = () => {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (e) {
      /* navigation privée : réglage gardé le temps de la visite */
    }
  };

  const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  // Jour en UTC pour que les changements d'heure ne décalent pas le calcul.
  const utc = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  // Samedi du week-end d'une date (samedi ou dimanche), sinon null.
  const saturdayOf = (iso) => {
    const t = utc(iso);
    const dow = new Date(t).getUTCDay();
    return dow === 6 ? t : dow === 0 ? t - DAY : null;
  };
  // Samedi de la semaine de la date de référence (on accepte un samedi ou un dimanche).
  const refSaturday = (iso) => {
    const t = utc(iso);
    const dow = new Date(t).getUTCDay();
    return t - ((dow + 1) % 7) * DAY;
  };

  const D = {
    config: () => ({ ...cfg }),
    ready: () => isIso(cfg.ref),
    active: () => cfg.on && isIso(cfg.ref),
    hiding: () => D.active() && cfg.hide,
    set(patch) {
      cfg = { ...cfg, ...patch };
      cfg.every = Math.max(1, Math.min(8, Math.round(Number(cfg.every) || 2)));
      save();
    },

    /* La date (AAAA-MM-JJ) tombe-t-elle un week-end indisponible ? */
    blocked(iso) {
      if (!isIso(iso) || !isIso(cfg.ref)) return false;
      const sat = saturdayOf(iso);
      if (sat == null) return false;
      const weeks = Math.round((sat - refSaturday(cfg.ref)) / (7 * DAY));
      return ((weeks % cfg.every) + cfg.every) % cfg.every === 0;
    },

    /* "ok" | "unsure" | "busy" pour une course, null si l'indicateur est coupé. */
    status(r) {
      if (!D.active()) return null;
      if (!r.date_confirmee || !isIso(r.date)) return "unsure";
      return D.blocked(r.date) ? "busy" : "ok";
    },
    label: {
      ok: "Date confirmée, week-end disponible",
      unsure: "Date à confirmer",
      busy: "Date confirmée, week-end indisponible",
    },

    /* Prochains week-ends indisponibles (samedis ISO) pour l'aperçu du réglage. */
    next(n = 4, from = new Date()) {
      if (!isIso(cfg.ref)) return [];
      const today = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
      const step = 7 * DAY * cfg.every;
      const ref = refSaturday(cfg.ref);
      let t = ref + Math.ceil((today - ref - DAY) / step) * step; // inclut le week-end en cours
      const out = [];
      for (let i = 0; i < n; i++, t += step) out.push(new Date(t).toISOString().slice(0, 10));
      return out;
    },
  };

  root.Dispo = D;
})(typeof window !== "undefined" ? window : globalThis);
