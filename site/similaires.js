/* Courses qui ressemblent : calculé dans le navigateur, sans service externe.
 * Score de distance entre deux formats (plus petit = plus proche) :
 *   - distance : écart relatif (log), poids 3 ;
 *   - profil : écart de D+ par km, rapporté à 25 m/km, poids 1,5 (pénalité fixe si un D+ manque) ;
 *   - période : écart de jour dans l'année (sur un cercle), rapporté à 30 jours, poids 1 ;
 *   - lieu : 0 même département, 0,4 même région, 1 sinon.
 * Une seule ligne par événement (son format le plus proche), jamais l'événement lui-même. */
(function (root) {
  const DAY = 864e5;
  const P = { km: 3, profil: 1.5, profilInconnu: 1, periode: 1, lieu: 1 };

  const jour = (d) => {
    if (!d) return null;
    const [y, m, j] = d.split("-").map(Number);
    const t = Date.UTC(y, m - 1, j || 15); // date au mois près : milieu du mois
    return { t, doy: Math.floor((t - Date.UTC(y, 0, 1)) / DAY) };
  };
  const ecartJours = (a, b) => {
    const d = Math.abs(a - b) % 365;
    return Math.min(d, 365 - d);
  };
  const ratio = (r) => (r.denivele_pos_m != null && r.distance_km ? r.denivele_pos_m / r.distance_km : null);

  /* Détail du score d'un candidat c par rapport à la référence r. null si incomparable. */
  function score(r, c, { periode = true } = {}) {
    if (!r.distance_km || !c.distance_km) return null;
    const parts = {};
    parts.km = Math.abs(Math.log(c.distance_km / r.distance_km)) * P.km;
    const ra = ratio(r), rc = ratio(c);
    parts.profil = ra != null && rc != null ? (Math.abs(ra - rc) / 25) * P.profil : P.profilInconnu;
    const ja = jour(r.date), jc = jour(c.date);
    parts.periode = periode ? (ja && jc ? (ecartJours(ja.doy, jc.doy) / 30) * P.periode : P.periode) : 0;
    parts.lieu = r.departement_code && r.departement_code === c.departement_code ? 0 : r.region_code && r.region_code === c.region_code ? 0.4 : 1;
    parts.lieu *= P.lieu;
    return { total: parts.km + parts.profil + parts.periode + parts.lieu, parts };
  }

  /* Raisons lisibles, pour expliquer le rapprochement. */
  function raisons(r, c) {
    const out = [];
    if (r.distance_km && c.distance_km && Math.abs(c.distance_km - r.distance_km) <= Math.max(2, 0.1 * r.distance_km)) out.push("distance proche");
    const ra = ratio(r), rc = ratio(c);
    if (ra != null && rc != null && Math.abs(ra - rc) <= 10) out.push("même profil");
    const ja = jour(r.date), jc = jour(c.date);
    if (ja && jc && ecartJours(ja.doy, jc.doy) <= 21) out.push("même période");
    if (r.departement_code && r.departement_code === c.departement_code) out.push("même département");
    else if (r.region_code && r.region_code === c.region_code) out.push("même région");
    return out;
  }

  /* Courses proches de r parmi races. evKey : identifiant d'événement.
   * autreDate : même profil sans tenir compte de la période, au moins `ecartMin` jours d'écart. */
  function proches(r, races, evKey, { n = 5, autreDate = false, ecartMin = 28 } = {}) {
    const self = evKey(r);
    const ja = jour(r.date);
    const best = new Map();
    for (const c of races) {
      const k = evKey(c);
      if (k === self) continue;
      if (autreDate) {
        const jc = jour(c.date);
        if (!ja || !jc || Math.abs(jc.t - ja.t) < ecartMin * DAY) continue;
      }
      const s = score(r, c, { periode: !autreDate });
      if (!s) continue;
      const prev = best.get(k);
      if (!prev || s.total < prev.score) best.set(k, { race: c, score: s.total });
    }
    return [...best.values()]
      .sort((a, b) => a.score - b.score)
      .slice(0, n)
      .map((x) => ({ ...x, raisons: raisons(r, x.race) }));
  }

  root.Similaires = { score, raisons, proches, ratio };
})(typeof window !== "undefined" ? window : globalThis);
