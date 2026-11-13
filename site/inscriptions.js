/* État des inscriptions sur la fiche d'une course (données : data/sources/inscriptions.csv, relevés
 * manuels ou contributions, publiés dans data/index.json sous « inscriptions »).
 * r.inscription = {statut, ouverture, mode, releve_le, prix} (champs présents seulement).
 * - Inscriptions.html(rows, esc, aujourdhui) : section de la fiche, ou "" sans aucun relevé.
 * Un relevé est daté ; au-delà de 30 jours, ou si l'ouverture annoncée est passée, il est signalé
 * « à vérifier ». */
(function (root) {
  const STATUTS = { a_venir: "Pas encore ouvertes", ouvertes: "Ouvertes", complet: "Complet", fermees: "Closes" };
  const MODES = { libre: "inscription libre", tirage: "tirage au sort", qualification: "sur qualification" };
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const jour = (d) => {
    const [y, m, j] = d.split("-").map(Number);
    return `${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${y}`;
  };
  const court = (d) => d.split("-").reverse().join("/");
  const ecart = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  const km = (v) => (v == null ? "?" : String(v).replace(".", ",")) + " km";
  const euros = (v) => String(v).replace(".", ",") + " €";

  function html(rows, esc = (s) => s, aujourdhui = new Date().toISOString().slice(0, 10)) {
    const avec = rows.filter((r) => r.inscription);
    if (!avec.length) return "";
    const i = avec.map((r) => r.inscription).sort((a, b) => (b.releve_le || "").localeCompare(a.releve_le || ""))[0];
    const parts = [];
    let p = i.statut ? `<span class="insc insc-${esc(i.statut)}">${esc(STATUTS[i.statut] || i.statut)}</span>` : "";
    if (i.mode) p += ` <span class="dim">${esc(MODES[i.mode] || i.mode)}</span>`;
    if (i.ouverture) {
      const passee = i.ouverture <= aujourdhui;
      if (!passee || i.statut !== "ouvertes")
        p += `${p ? "<br>" : ""}Ouverture ${passee ? "annoncée le" : "le"} <b>${esc(jour(i.ouverture))}</b>`;
    }
    if (p) parts.push(`<p>${p}</p>`);
    const prix = avec.filter((r) => r.inscription.prix != null);
    if (prix.length)
      parts.push(`<p>${prix.map((r) => `<span class="nw">${esc(km(r.distance_km))} : <b>${esc(euros(r.inscription.prix))}</b></span>`).join(" · ")}</p>`);
    const vieux = i.releve_le && ecart(i.releve_le, aujourdhui) > 30;
    const depasse = i.statut === "a_venir" && i.ouverture && i.ouverture <= aujourdhui;
    parts.push(`<p class="dlg-note">Relevé le ${esc(court(i.releve_le || ""))}${vieux || depasse ? ", <b>à vérifier</b> auprès de l'organisateur" : ""}.</p>`);
    return `<section class="fi-sec"><h4>Inscriptions</h4>${parts.join("")}</section>`;
  }

  root.Inscriptions = { html, STATUTS, MODES };
})(typeof window !== "undefined" ? window : globalThis);
