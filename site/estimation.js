/* Estimation de temps sur un format, à partir d'un chrono de référence saisi par
 * l'utilisateur (10 km, semi, marathon, ou un trail déjà couru). Chrono stocké
 * dans ce navigateur seulement (localStorage). Toujours présenté comme une estimation.
 *
 * Méthode :
 *  1. effort = km-effort (km + D+/100) ; pour la route, km-effort = km ;
 *  2. formule de Riegel sur l'effort : T = Tref × (effort / effortRef)^1,06 ;
 *  3. facteur de terrain selon le profil (D+ par km), le trail étant plus lent que
 *     la route à km-effort égal : roulant ×1,05, vallonné ×1,12, montagne ×1,22 ;
 *     si la référence est un trail, on divise par le facteur de son propre profil ;
 *  4. fourchette asymétrique : -8 % / +15 % (ravitaillements, technicité, météo).
 * Sans D+ connu, pas d'estimation (le km-effort serait faux). */
(function (root) {
  const KEY = "ta.chrono.v1";
  const ROUTE = { "10k": 10, semi: 21.0975, marathon: 42.195 };
  const EXPOSANT = 1.06;
  const FOURCHETTE = [0.92, 1.15];

  const profil = (km, dplus) => {
    const r = dplus / km;
    return r < 25 ? "roulant" : r <= 50 ? "vallonne" : "montagne";
  };
  const TERRAIN = { route: 1, roulant: 1.05, vallonne: 1.12, montagne: 1.22 };

  /* "1:45:30", "45:30", "1h45", "1 h 45 min 30", "105" (minutes) -> secondes ; null si invalide. */
  function parseDuree(s) {
    s = String(s || "").trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
    m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|mn|m|')?)?\s*(?:(\d+)\s*(?:s|")?)?$/);
    if (m && (m[1] || m[2])) {
      if (!m[1] && !m[3] && /^\d+$/.test(s)) return +m[2] * 60; // nombre seul : minutes
      return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    }
    return null;
  }
  const pad = (n) => String(n).padStart(2, "0");
  /* secondes -> "3 h 05" ou "52 min" (arrondi à 5 min au-delà de 2 h, à la minute sinon) */
  function formatDuree(sec) {
    const pas = sec > 7200 ? 300 : 60;
    const t = Math.round(sec / pas) * pas;
    const h = Math.floor(t / 3600), mn = Math.round((t % 3600) / 60);
    return h ? `${h} h ${pad(mn)}` : `${mn} min`;
  }

  /* « 31 à 39 min », « 2 h 10 à 2 h 40 » */
  function fourchette(e) {
    const a = formatDuree(e.bas), b = formatDuree(e.haut);
    return / min$/.test(a) && / min$/.test(b) ? `${a.replace(" min", "")} à ${b}` : `${a} à ${b}`;
  }

  /* Effort et facteur de terrain d'une référence { type, temps, km, dplus }. null si incomplète. */
  function reference(ref) {
    if (!ref || !(ref.temps > 0)) return null;
    if (ROUTE[ref.type]) return { effort: ROUTE[ref.type], terrain: TERRAIN.route, temps: ref.temps };
    if (ref.type === "trail" && ref.km > 0 && ref.dplus >= 0)
      return { effort: ref.km + ref.dplus / 100, terrain: TERRAIN[profil(ref.km, ref.dplus)], temps: ref.temps };
    return null;
  }

  /* { bas, centre, haut } en secondes pour une course { distance_km, denivele_pos_m }, ou null. */
  function estimer(ref, r) {
    const R = reference(ref);
    if (!R || !r || !r.distance_km || r.denivele_pos_m == null) return null;
    const effort = r.distance_km + r.denivele_pos_m / 100;
    const terrain = TERRAIN[profil(r.distance_km, r.denivele_pos_m)];
    const centre = R.temps * Math.pow(effort / R.effort, EXPOSANT) * (terrain / R.terrain);
    return { bas: centre * FOURCHETTE[0], centre, haut: centre * FOURCHETTE[1] };
  }

  const lire = () => {
    try {
      return JSON.parse(root.localStorage.getItem(KEY)) || null;
    } catch (e) {
      return null;
    }
  };
  let courant = lire();
  const E = {
    parseDuree, formatDuree, fourchette, estimer, reference, ROUTE,
    chrono: () => courant,
    enregistrer(ref) {
      courant = reference(ref) ? { ...ref } : null;
      try {
        if (courant) root.localStorage.setItem(KEY, JSON.stringify(courant));
        else root.localStorage.removeItem(KEY);
      } catch (e) {
        /* navigation privée : gardé le temps de la visite */
      }
      return courant;
    },
    /* Libellé court de la référence : « 10 km en 45 min » */
    libelle(ref = courant) {
      if (!ref) return "";
      const quoi = { "10k": "10 km", semi: "semi-marathon", marathon: "marathon" }[ref.type] || `trail de ${ref.km} km et ${ref.dplus} m D+`;
      return `${quoi} en ${formatDuree(ref.temps)}`;
    },
  };
  root.Estimation = E;
})(typeof window !== "undefined" ? window : globalThis);
