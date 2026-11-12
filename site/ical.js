/* Export d'une liste de favoris au format iCalendar (.ics, RFC 5545), pour l'ajouter au
 * calendrier du téléphone. Généré dans le navigateur, sans service externe.
 * - un événement « journée entière » par format dont le jour est connu ;
 * - heure de départ (quand on la connaît) et « date à confirmer » dans le titre ;
 * - identifiant stable (UID) : réimporter la liste met à jour au lieu de dupliquer ;
 * - les dates connues seulement au mois près ne sont pas exportées (renvoyées à part). */
(function (root) {
  const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const octets = (s) => (enc ? enc.encode(s).length : s.length);

  /* Pliage des lignes à 75 octets (sans couper un caractère UTF-8). */
  function plier(ligne) {
    if (octets(ligne) <= 75) return ligne;
    const out = [];
    let cur = "", max = 75;
    for (const ch of ligne) {
      if (octets(cur + ch) > max) {
        out.push(cur);
        cur = "";
        max = 74; // les lignes suivantes commencent par une espace
      }
      cur += ch;
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  const jour = (iso) => iso.replace(/-/g, "");
  const lendemain = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, "");
  };
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fmtNum = (v) => Number(v).toLocaleString("fr-FR");
  const heure = (h) => (/^\d{1,2}:\d{2}/.test(h || "") ? h.replace(/^(\d{1,2}):(\d{2}).*/, (m, a, b) => `${+a} h ${b}`) : "");

  /* Texte du fichier et liste des courses écartées (date au mois près ou inconnue). */
  function construire(races, { nom = "Agregatrail", lien = "", maintenant = new Date() } = {}) {
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agregatrail//Favoris//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(nom)}`];
    const ecartees = [];
    for (const r of races) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        ecartees.push(r);
        continue;
      }
      const km = r.distance_km != null ? `${fmtNum(r.distance_km)} km` : "";
      const h = heure(r.heure_depart);
      const titre = [r.nom, km].filter(Boolean).join(" – ") + (h ? ` · départ ${h}` : "") + (r.date_confirmee ? "" : " (date à confirmer)");
      const url = [r.lien_inscription, r.site_web, r.source_url].find((u) => /^https?:\/\//i.test(u || ""));
      const desc = [
        [km, r.denivele_pos_m != null ? `${fmtNum(r.denivele_pos_m)} m D+` : "D+ inconnu"].filter(Boolean).join(" · "),
        h && `Départ : ${h}`,
        !r.date_confirmee && "Date à confirmer auprès de l'organisateur.",
        r.organisateur && `Organisateur : ${r.organisateur}`,
        r.lien_inscription && `Inscription : ${r.lien_inscription}`,
        r.site_web && `Site : ${r.site_web}`,
        lien && `Agregatrail : ${lien}`,
      ].filter(Boolean).join("\n");
      L.push(
        "BEGIN:VEVENT",
        `UID:${esc(r.id)}@agregatrail`,
        `DTSTAMP:${stamp(maintenant)}`,
        `DTSTART;VALUE=DATE:${jour(r.date)}`,
        `DTEND;VALUE=DATE:${lendemain(r.date)}`,
        `SUMMARY:${esc(titre)}`,
        `LOCATION:${esc([r.ville, r.departement_code && `(${r.departement_code})`].filter(Boolean).join(" "))}`,
        ...(r.lat != null && r.lon != null ? [`GEO:${r.lat};${r.lon}`] : []),
        ...(url ? [`URL:${url}`] : []),
        `DESCRIPTION:${esc(desc)}`,
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
    }
    L.push("END:VCALENDAR");
    return { texte: L.map(plier).join("\r\n") + "\r\n", ecartees, exportees: races.length - ecartees.length };
  }

  /* Nom de fichier lisible : « Objectifs 2027 » -> « objectifs-2027.ics » */
  const fichier = (nom) =>
    (String(nom || "agregatrail").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agregatrail") + ".ics";

  root.Ical = { construire, fichier, plier };
})(typeof window !== "undefined" ? window : globalThis);
