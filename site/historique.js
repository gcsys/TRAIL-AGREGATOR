/* Historique des éditions, sur la fiche d'une course (données : data/historique.json, généré au build
 * par scripts/historique.py). Clé : « nom|ville » de la course, tels qu'écrits dans la base.
 * - Historique.charger() : fichier chargé une fois, à la première fiche ouverte.
 * - Historique.html(info, esc) : section de la fiche, ou "" s'il n'y a rien à dire.
 * Habitude et date estimée sont des estimations, affichées comme telles. */
(function (root) {
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

  const jour = (d) => {
    const [y, m, j] = d.split("-").map(Number);
    if (!j) return `${MOIS[m - 1]} ${y}`;
    return `${JOURS[new Date(Date.UTC(y, m - 1, j)).getUTCDay()]} ${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${y}`;
  };
  const court = (d) => {
    const [, m, j] = d.split("-").map(Number);
    return j ? `${j === 1 ? "1er" : j} ${MOIS[m - 1]}` : MOIS[m - 1];
  };
  const releve = (d) => d.split("-").reverse().join("/");
  const kms = (f) => (f && f.length ? f.map((k) => `${String(k).replace(".", ",")} km`).join(", ") : "formats inconnus");

  function html(info, esc = (s) => s) {
    if (!info) return "";
    const parts = [];
    for (const c of info.changements || [])
      parts.push(`<p class="hist-chg"><b>Date modifiée</b> : annoncée le ${esc(court(c.avant))}, désormais le ${esc(court(c.apres))} <span class="dim">(relevé le ${esc(releve(c.le))})</span></p>`);
    if (info.habitude) {
      const n = info.n > 1 ? `d'après ${info.n} éditions` : "d'après l'édition précédente";
      let p = `Habituellement le <b>${esc(info.habitude)}</b> <span class="tag muted">estimation</span> <span class="dim">(${n})</span>`;
      if (info.estimation_texte) p += `<br>Date probable de cette édition : <b>${esc(info.estimation_texte)}</b>, à confirmer par l'organisateur.`;
      if (info.inhabituelle) p += `<br>Cette année, la date ne suit pas cette habitude.`;
      parts.push(`<p>${p}</p>`);
    }
    if (info.precedentes && info.precedentes.length)
      parts.push(`<ul class="hist">${info.precedentes.slice().reverse().map(([d, f]) => `<li><span>${esc(jour(d))}</span><span class="dim">${esc(kms(f))}</span></li>`).join("")}</ul>`);
    if (!parts.length) return "";
    return `<section class="fi-sec"><h4>Éditions</h4>${parts.join("")}</section>`;
  }

  let promesse = null;
  function charger(fetchFn = root.fetch && root.fetch.bind(root)) {
    if (!promesse)
      promesse = fetchFn("data/historique.json")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    return promesse;
  }

  root.Historique = { html, charger, jour };
})(typeof window !== "undefined" ? window : globalThis);
