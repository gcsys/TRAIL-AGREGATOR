/* Vue calendrier : les courses filtrées, mois par mois, dans une grille du lundi au dimanche.
 * - Calendrier.html(events, opts) : sections de mois, du premier au dernier mois qui a une course
 *   (24 au plus). Chaque jour liste ses courses (bouton « fiche ») ; sur petit écran, la grille montre
 *   le nombre de courses et un toucher sur le jour ouvre la liste du jour sous le mois.
 *   Les courses dont seul le mois est connu sont listées sous la grille (« jour à préciser »).
 * - opts.semaine(iso) : "busy" | "ok" | null pour un samedi ou un dimanche (week-ends dispo, dispo.js).
 * events : [{key, first: {nom, date, ville}, maxKm}] comme dans app.js. Aucune dépendance au DOM. */
(function (root) {
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
  const DAY = 864e5;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const moisSuivant = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  };

  /* Semaines (lundi -> dimanche) couvrant le mois ; null hors du mois. */
  function grille(ym) {
    const [y, m] = ym.split("-").map(Number);
    const debut = Date.UTC(y, m - 1, 1);
    const decal = (new Date(debut).getUTCDay() + 6) % 7;
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cases = Array(decal).fill(null);
    for (let j = 0; j < n; j++) cases.push(iso(debut + j * DAY));
    while (cases.length % 7) cases.push(null);
    const out = [];
    for (let i = 0; i < cases.length; i += 7) out.push(cases.slice(i, i + 7));
    return out;
  }

  /* {mois: [ym…], jours: Map(iso -> [ev]), flous: Map(ym -> [ev])} */
  function regrouper(events, max = 24) {
    const jours = new Map(), flous = new Map();
    let min = null, maxYm = null;
    for (const ev of events) {
      const d = ev.first && ev.first.date;
      if (!d) continue;
      const ym = d.slice(0, 7);
      if (d.length === 10) (jours.get(d) || jours.set(d, []).get(d)).push(ev);
      else (flous.get(ym) || flous.set(ym, []).get(ym)).push(ev);
      if (!min || ym < min) min = ym;
      if (!maxYm || ym > maxYm) maxYm = ym;
    }
    const mois = [];
    for (let ym = min; ym && ym <= maxYm && mois.length < max; ym = moisSuivant(ym)) mois.push(ym);
    return { mois, jours, flous, tronque: !!maxYm && mois.length === max && mois[max - 1] < maxYm };
  }

  function html(events, { esc = (s) => s, semaine = () => null, dc = () => "--d1", aujourdhui = iso(Date.now()) } = {}) {
    const { mois, jours, flous, tronque } = regrouper(events);
    if (!mois.length) return "";
    const btn = (ev) =>
      `<button type="button" class="cal-ev" data-act="fiche" data-key="${esc(ev.key)}" style="--c:var(${dc(ev.maxKm)})" title="${esc(ev.first.nom)} · ${esc(ev.first.ville || "")}">${esc(ev.first.nom)}</button>`;
    const sections = mois.map((ym) => {
      const [y, m] = ym.split("-").map(Number);
      let n = 0;
      const lignes = grille(ym).map((sem) => "<tr>" + sem.map((d, i) => {
        if (!d) return `<td class="vide"></td>`;
        const evs = jours.get(d) || [];
        n += evs.length;
        const we = i >= 5 ? semaine(d) : null;
        const cls = ["j", i >= 5 ? "we" : "", we ? `we-${we}` : "", d === aujourdhui ? "auj" : "", evs.length ? "a" : ""].filter(Boolean).join(" ");
        const titre = we === "busy" ? ' title="Week-end indisponible"' : we === "ok" ? ' title="Week-end disponible"' : "";
        return `<td class="${cls}"${titre}><button type="button" class="cal-num" data-jour="${d}"${evs.length ? "" : " disabled"} aria-label="${Number(d.slice(8))} ${MOIS[m - 1]}${evs.length ? ` : ${evs.length} course${evs.length > 1 ? "s" : ""}` : ""}">` +
          `<span>${Number(d.slice(8))}</span>${evs.length ? `<b class="cal-n">${evs.length}</b>` : ""}</button>` +
          `<div class="cal-evs">${evs.slice(0, 4).map(btn).join("")}${evs.length > 4 ? `<button type="button" class="cal-plus" data-jour="${d}">+${evs.length - 4}</button>` : ""}</div></td>`;
      }).join("") + "</tr>").join("");
      const fl = flous.get(ym) || [];
      n += fl.length;
      return `<section class="cal-mois" data-ym="${ym}"><h3>${MOIS[m - 1]} ${y} <span class="dim">${n ? `${n} course${n > 1 ? "s" : ""}` : "aucune course"}</span></h3>` +
        `<table class="cal"><thead><tr>${JOURS.map((j) => `<th>${j}</th>`).join("")}</tr></thead><tbody>${lignes}</tbody></table>` +
        `<div class="cal-jour" hidden></div>` +
        (fl.length ? `<p class="cal-flous"><span class="dim">Jour à préciser :</span> ${fl.map(btn).join("")}</p>` : "") + `</section>`;
    });
    return sections.join("") + (tronque ? `<p class="dlg-note">Calendrier limité à 24 mois : précisez les dates pour voir la suite.</p>` : "");
  }

  /* Liste d'un jour (sous la grille, au toucher d'un jour). */
  function jourHtml(events, d, esc = (s) => s, dc = () => "--d1") {
    const evs = events.filter((ev) => ev.first && ev.first.date === d);
    const [y, m, j] = d.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, j)).getUTCDay();
    const nom = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][t];
    return `<h4>${nom} ${j === 1 ? "1er" : j} ${MOIS[m - 1]}</h4><ul>${evs.map((ev) =>
      `<li><button type="button" class="link" data-act="fiche" data-key="${esc(ev.key)}"><i class="cal-dot" style="--c:var(${dc(ev.maxKm)})"></i>${esc(ev.first.nom)}</button> <span class="dim">${esc(ev.first.ville || "")}${ev.maxKm != null ? ` · ${esc(String(ev.minKm === ev.maxKm || ev.minKm == null ? ev.maxKm : `${ev.minKm}–${ev.maxKm}`).replace(/\./g, ","))} km` : ""}</span></li>`).join("")}</ul>`;
  }

  root.Calendrier = { grille, regrouper, html, jourHtml };
})(typeof window !== "undefined" ? window : globalThis);
