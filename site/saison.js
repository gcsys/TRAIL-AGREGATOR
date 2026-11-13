/* Planificateur de saison : une liste de courses devient une saison, avec une course objectif.
 * - Saison.analyser(rows, {objectif, seuil}) : courses triées par date, écart en semaines avec la
 *   précédente, alerte quand l'écart est sous le seuil (semaines, réglable), rôle de chaque course
 *   (« préparation » avant l'objectif, « objectif », « après » ensuite) et semaines restantes avant l'objectif.
 * - Saison.html(analyse, esc) : section affichée au-dessus de la liste.
 * Les écarts ne se calculent qu'entre jours connus ; une course datée au mois seulement est signalée.
 * Réglages par liste (objectif, seuil) gardés avec la liste (favoris.js). Aucune dépendance au DOM. */
(function (root) {
  const DAY = 864e5;
  const SEUIL = 3;
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const jour = (d) => {
    const [y, m, j] = d.split("-").map(Number);
    return j ? `${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${y}` : `${MOIS[m - 1]} ${y}`;
  };
  const semaines = (a, b) => (Date.parse(b) - Date.parse(a)) / (7 * DAY);
  /* « 3 semaines », « 2 semaines et 6 jours », « 5 jours » : jamais d'arrondi qui masquerait un écart trop court */
  const fmt = (w) => {
    const jours = Math.round(w * 7), s = Math.floor(jours / 7), j = jours % 7;
    const S = s ? `${s} semaine${s > 1 ? "s" : ""}` : "", J = j ? `${j} jour${j > 1 ? "s" : ""}` : "";
    return [S, J].filter(Boolean).join(" et ") || "0 jour";
  };
  const km = (v) => (v == null ? "? km" : `${String(v).replace(".", ",")} km`);

  function analyser(rows, { objectif = null, seuil = SEUIL } = {}) {
    const items = rows
      .filter((r) => r.date)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || (a.distance_km ?? 0) - (b.distance_km ?? 0))
      .map((r) => ({ r, exact: r.date.length === 10 }));
    const obj = items.find((x) => x.r.id === objectif) || null;
    let prec = null;
    let nAlertes = 0;
    for (const x of items) {
      x.role = !obj ? null : x === obj ? "objectif" : x.r.date < obj.r.date ? "preparation" : "apres";
      if (obj && x.exact && obj.exact && x.role === "preparation") x.avant = semaines(x.r.date, obj.r.date);
      if (prec && x.exact && prec.exact) {
        x.ecart = semaines(prec.r.date, x.r.date);
        x.alerte = x.ecart < seuil && x.r.date !== prec.r.date ? true : x.r.date === prec.r.date ? "meme-jour" : false;
        if (x.alerte) nAlertes++;
      }
      if (x.exact) prec = x;
    }
    return { items, objectif: obj, seuil, nAlertes, sansDate: rows.filter((r) => !r.date).length };
  }

  function html(a, esc = (s) => s) {
    if (!a.items.length) return "";
    const lignes = [];
    for (const x of a.items) {
      if (x.ecart != null) {
        const cls = x.alerte ? "sz-gap alerte" : "sz-gap";
        const txt = x.alerte === "meme-jour" ? "Même jour que la précédente : un seul des deux formats est possible"
          : x.alerte ? `${fmt(x.ecart)} seulement : sous votre seuil de ${a.seuil} semaine${a.seuil > 1 ? "s" : ""}`
          : `${fmt(x.ecart)} d'écart`;
        lignes.push(`<li class="${cls}"><span>${esc(txt)}</span></li>`);
      } else if (!x.exact) lignes.push(`<li class="sz-gap"><span class="dim">Jour à préciser : écart non calculé</span></li>`);
      const r = x.r;
      const tag = x.role === "objectif" ? `<span class="tag sz-obj">objectif</span>`
        : x.role === "preparation" ? `<span class="tag muted">préparation${x.avant != null ? ` · J-${Math.round(x.avant * 7)}` : ""}</span>`
        : x.role === "apres" ? `<span class="tag muted">après l'objectif</span>` : "";
      lignes.push(`<li class="sz-course${x.role === "objectif" ? " obj" : ""}">
        <span class="sz-date">${esc(jour(r.date))}</span>
        <span class="sz-nom"><button type="button" class="link" data-act="fiche" data-key="${esc(r._key || "")}" data-rid="${esc(r.id)}">${esc(r.nom)}</button>
          <span class="dim">${esc(km(r.distance_km))}${r.denivele_pos_m != null ? ` · ${esc(String(r.denivele_pos_m))} m D+` : ""}</span> ${tag}</span>
        <button type="button" class="btn ghost sz-set" data-sz-obj="${x.role === "objectif" ? "" : esc(r.id)}">${x.role === "objectif" ? "Retirer l'objectif" : "Objectif"}</button>
      </li>`);
    }
    const resume = [];
    if (a.objectif) {
      const prepa = a.items.filter((x) => x.role === "preparation").length;
      resume.push(`Objectif : <b>${esc(a.objectif.r.nom)}</b> (${esc(jour(a.objectif.r.date))}), ${prepa} course${prepa > 1 ? "s" : ""} de préparation.`);
    } else resume.push("Choisissez votre course objectif : les autres se rangent en préparation ou après.");
    resume.push(a.nAlertes ? `<b>${a.nAlertes} écart${a.nAlertes > 1 ? "s" : ""} trop court${a.nAlertes > 1 ? "s" : ""}</b>.` : "Aucun écart sous le seuil.");
    if (a.sansDate) resume.push(`${a.sansDate} course${a.sansDate > 1 ? "s" : ""} sans date.`);
    const options = [1, 2, 3, 4, 5, 6, 8].map((w) => `<option value="${w}"${w === a.seuil ? " selected" : ""}>${w} semaine${w > 1 ? "s" : ""}</option>`).join("");
    return `<section class="saison"><div class="sz-head"><h3>Ma saison</h3>
      <label>Écart minimum <select id="sz-seuil">${options}</select></label></div>
      <p class="sz-resume">${resume.join(" ")}</p><ol class="sz-liste">${lignes.join("")}</ol>
      <p class="dlg-note">Écart entre les dates de course, en semaines. Le seuil est un repère personnel, pas une règle médicale.</p></section>`;
  }

  root.Saison = { analyser, html, SEUIL };
})(typeof window !== "undefined" ? window : globalThis);
