/* Infos pratiques sur la fiche d'une course : de simples liens de recherche, sans API ni clé.
 * - Itinéraire : OpenStreetMap et Google Maps, vers le point de départ (ou la commune si les coordonnées
 *   manquent), depuis le centre de recherche choisi s'il y en a un.
 * - Hébergement : Booking pour la nuit précédant la course quand le jour est connu, et carte des
 *   hébergements autour du départ (OpenStreetMap / Google Maps).
 * - Covoiturage : recherche BlaBlaCar vers la commune, le jour de la course.
 * Aucun lien affilié. Pratique.liens(r, origine) renvoie une liste {groupe, texte, url} ;
 * Pratique.html(r, origine, esc) la section de la fiche. */
(function (root) {
  const veille = (d) => {
    const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - 864e5);
    return t.toISOString().slice(0, 10);
  };
  const lieu = (r) => [r.ville, r.code_postal || r.departement_code].filter(Boolean).join(" ");

  function liens(r, origine) {
    const q = encodeURIComponent;
    const coord = r.lat != null && r.lon != null ? `${(+r.lat).toFixed(5)},${(+r.lon).toFixed(5)}` : "";
    const dest = coord || lieu(r);
    const orig = origine && origine.lat != null ? `${(+origine.lat).toFixed(5)},${(+origine.lon).toFixed(5)}` : "";
    const jour = r.date && r.date.length === 10 ? r.date : "";
    const out = [];
    out.push({ groupe: "Itinéraire", texte: "OpenStreetMap",
      url: coord ? `https://www.openstreetmap.org/directions?route=${q(orig)}%3B${q(coord)}#map=12/${coord.replace(",", "/")}`
                 : `https://www.openstreetmap.org/search?query=${q(dest)}` });
    out.push({ groupe: "Itinéraire", texte: "Google Maps",
      url: `https://www.google.com/maps/dir/?api=1&destination=${q(dest)}${orig ? `&origin=${q(orig)}` : ""}` });
    out.push({ groupe: "Hébergement", texte: jour ? "Booking, nuit de la veille" : "Booking",
      url: `https://www.booking.com/searchresults.fr.html?ss=${q(r.ville || lieu(r))}${jour ? `&checkin=${veille(jour)}&checkout=${jour}` : ""}&group_adults=1` });
    out.push({ groupe: "Hébergement", texte: "Autour du départ",
      url: coord ? `https://www.google.com/maps/search/h%C3%A9bergement/@${coord},13z` : `https://www.google.com/maps/search/${q("hébergement " + lieu(r))}` });
    out.push({ groupe: "Covoiturage", texte: "BlaBlaCar",
      url: `https://www.blablacar.fr/search?tn=${q(r.ville || dest)}${jour ? `&db=${jour}` : ""}` });
    return out;
  }

  function html(r, origine, esc = (s) => s) {
    const groupes = new Map();
    for (const l of liens(r, origine)) {
      if (!groupes.has(l.groupe)) groupes.set(l.groupe, []);
      groupes.get(l.groupe).push(`<a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.texte)}</a>`);
    }
    const lignes = [...groupes].map(([g, a]) => `<li><span class="dim">${esc(g)}</span><span class="pr-l">${a.join("")}</span></li>`).join("");
    return `<section class="fi-sec"><h4>Infos pratiques</h4><ul class="pratique">${lignes}</ul>` +
      `<p class="dlg-note">Liens de recherche vers des sites externes, sans partenariat ni commission.</p></section>`;
  }

  root.Pratique = { liens, html, veille };
})(typeof window !== "undefined" ? window : globalThis);
