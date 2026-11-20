/* Données des courses : lecture de l'index léger (data/index.json) et du détail
 * par région (data/detail/<code>.json), produits par scripts/site_data.py.
 * Les champs calculés (km-effort, UTMB, ITRA estimés) sont recalculés ici avec
 * les mêmes règles que scripts/build_db.py. Aucune dépendance au DOM. */
(function (root) {
  const OTHER = "autres";

  /* Arrondi à 1 décimale identique au round() de Python : les cas exactement à mi-chemin
   * (13,25) vont au chiffre pair (13,2), là où Math.round donnerait 13,3. */
  const round1 = (x) => {
    const exact = x.toFixed(20);
    if (/\.\d50*$/.test(exact)) {
      const lo = Math.floor(x * 10);
      return (lo % 2 === 0 ? lo : lo + 1) / 10;
    }
    return Number(x.toFixed(1));
  };
  const kmEffort = (km, d) => (km != null && d != null ? round1(km + d / 100) : null);
  const utmbCategory = (ke) => (ke == null || ke < 20 ? null : ke < 45 ? "20K" : ke < 75 ? "50K" : ke < 155 ? "100K" : "100M");
  const itraPoints = (ke) => {
    if (ke == null) return null;
    for (const [lim, pts] of [[25, 0], [45, 1], [75, 2], [115, 3], [155, 4], [210, 5]]) if (ke < lim) return pts;
    return 6;
  };

  /* Index en colonnes -> tableau de courses au même format que l'ancien races.json
   * (hors champs secondaires). depName / regName : Map code -> nom. */
  function decode(index, depName = new Map(), regName = new Map()) {
    const { cols, dicts, flags, count } = index;
    const inscr = index.inscriptions || {};
    const fields = Object.keys(cols).filter((f) => f !== "flags");
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const r = {};
      for (const f of fields) {
        const v = cols[f][i];
        r[f] = dicts[f] ? dicts[f][v] : v;
      }
      flags.forEach((k, b) => (r[k] = !!((cols.flags[i] >> b) & 1)));
      r.date = r.date || null;
      r.departement_code = r.departement_code || null;
      r.region_code = r.region_code || null;
      r.km_effort = kmEffort(r.distance_km, r.denivele_pos_m);
      r.utmb_index = utmbCategory(r.km_effort);
      r.itra_points_estimes = itraPoints(r.km_effort);
      r.departement = depName.get(r.departement_code) || null;
      r.region = regName.get(r.region_code) || null;
      r.inscription = inscr[r.id] || null; // état des inscriptions relevé (rare), prix compris
      out[i] = r;
    }
    return out;
  }

  // ----- Détail à la demande -----
  const cache = new Map(); // code région -> Promise<{id: {...}}>
  function loadRegion(code, base = "data/") {
    const k = code || OTHER;
    if (!cache.has(k))
      cache.set(
        k,
        fetch(`${base}detail/${encodeURIComponent(k)}.json`)
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => {
            cache.delete(k); // réessai possible plus tard
            return {};
          })
      );
    return cache.get(k);
  }

  /* Complète les courses avec leurs champs secondaires (code postal, heure de départ…).
   * Ne charge que les régions concernées ; renvoie les mêmes objets, modifiés. */
  async function withDetails(races, fields) {
    const codes = [...new Set(races.map((r) => r.region_code || OTHER))];
    const parts = await Promise.all(codes.map((c) => loadRegion(c)));
    const byId = Object.assign({}, ...parts);
    races.forEach((r) => {
      const d = byId[r.id] || {};
      fields.forEach((f) => {
        if (r[f] === undefined) r[f] = d[f] ?? null;
      });
    });
    return races;
  }

  /* Courses ajoutées sur le site et validées (API PHP, api/courses.php?action=publiees) ->
   * mêmes objets que decode(). Elles s'affichent tout de suite, avant d'entrer dans la base
   * au build suivant. locate(lon, lat) -> { dep, reg } (codes) ; les courses sans coordonnées
   * ou déjà présentes dans la base (même nom, date et distance) sont écartées. */
  function fromMembres(rows, base, depName = new Map(), regName = new Map(), locate = () => ({})) {
    const n = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const cle = (r) => `${n(r.nom)}|${r.date || ""}|${Number(r.distance_km)}`;
    const connues = new Set(base.map(cle));
    const ids = new Set(base.map((r) => r.id));
    const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
    const vrai = (v) => v === true || v === "true" || v === "1" || v === 1;
    const out = [];
    for (const m of rows || []) {
      const lat = num(m.lat), lon = num(m.lon), km = num(m.distance_km);
      if (lat == null || lon == null || km == null || !m.nom || ids.has(m.id) || connues.has(cle(m))) continue;
      const loc = locate(lon, lat) || {};
      const dep = loc.dep || m.departement || null;
      const d = num(m.denivele_pos_m);
      const ke = kmEffort(km, d);
      out.push({
        id: m.id, nom: m.nom, course: m.course || "", date: m.date || null, ville: m.ville || "", lat, lon,
        distance_km: km, denivele_pos_m: d, type: m.type || "trail", organisateur: m.organisateur || "",
        site_web: m.site_web || "", lien_inscription: m.lien_inscription || "", source_url: "",
        departement_code: dep, region_code: loc.reg || null,
        date_confirmee: vrai(m.date_confirmee), utmb_world_series: false, nocturne: vrai(m.nocturne),
        km_effort: ke, utmb_index: utmbCategory(ke), itra_points_estimes: itraPoints(ke),
        departement: depName.get(dep) || null, region: regName.get(loc.reg) || null, inscription: null,
        // champs secondaires déjà connus : withDetails ne les cherche pas dans data/detail/
        code_postal: m.code_postal || "", heure_depart: m.heure_depart || "", participants_max: null,
        prix_eur: num(m.prix_eur), notes: m.notes || "", source: "membres", membre: true,
      });
    }
    return out;
  }

  root.Donnees = { decode, withDetails, fromMembres, round1, kmEffort, utmbCategory, itraPoints };
})(typeof window !== "undefined" ? window : globalThis);
