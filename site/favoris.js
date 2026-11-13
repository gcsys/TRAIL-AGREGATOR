/* Favoris : listes de courses et corrections personnelles, stockées dans le navigateur.
 * Aucune dépendance au DOM : ce module ne fait que lire/écrire localStorage et
 * encoder/décoder les liens de partage. */
(function (root) {
  const K_LISTS = "ta.lists.v1";
  const K_EDITS = "ta.edits.v1";
  const K_SNAPS = "ta.snaps.v1";

  // Champs qu'un utilisateur peut corriger.
  const EDITABLE = ["date", "date_confirmee", "distance_km", "denivele_pos_m", "lien_inscription", "site_web", "notes_perso"];

  const mem = {};
  const store = {
    get(k, def) {
      try {
        const v = root.localStorage.getItem(k);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return k in mem ? mem[k] : def;
      }
    },
    set(k, v) {
      mem[k] = v;
      try {
        root.localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* navigation privée / stockage plein : on garde en mémoire */
      }
    },
  };

  let lists = store.get(K_LISTS, []);
  let edits = store.get(K_EDITS, {});
  let snaps = store.get(K_SNAPS, {});
  const saveLists = () => store.set(K_LISTS, lists);
  const saveEdits = () => store.set(K_EDITS, edits);
  const saveSnaps = () => store.set(K_SNAPS, snaps);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  // Clé de rapprochement quand l'identifiant d'une course change d'une mise à jour à l'autre.
  const matchKey = (nom, ville, km) => `${norm(nom)}|${norm(ville)}|${km == null ? "" : Math.round(km)}`;

  // Petit instantané pour continuer d'afficher une course qui aurait disparu de la base.
  const SNAP_FIELDS = ["id", "nom", "course", "date", "date_confirmee", "ville", "lat", "lon", "distance_km", "denivele_pos_m", "km_effort", "type", "nocturne", "organisateur", "site_web", "lien_inscription", "source_url", "departement_code", "departement", "region_code", "region"];
  const snapshot = (r) => Object.fromEntries(SNAP_FIELDS.map((k) => [k, r[k] ?? null]));

  function uniqueName(name) {
    const base = name.trim() || "Ma liste";
    let n = base, i = 2;
    while (lists.some((l) => l.name.toLowerCase() === n.toLowerCase())) n = `${base} (${i++})`;
    return n;
  }

  const F = {
    EDITABLE,
    matchKey,

    // ----- Listes -----
    lists: () => lists,
    get: (id) => lists.find((l) => l.id === id),
    create(name, ids = []) {
      const l = { id: uid(), name: uniqueName(name), ids: [...new Set(ids)], created: new Date().toISOString() };
      lists.push(l);
      saveLists();
      return l;
    },
    rename(id, name) {
      const l = F.get(id);
      if (!l || !name.trim()) return;
      l.name = name.trim() === l.name ? l.name : uniqueName(name);
      saveLists();
    },
    remove(id) {
      lists = lists.filter((l) => l.id !== id);
      saveLists();
      F.gcSnaps();
    },
    toggle(listId, race) {
      const l = F.get(listId);
      if (!l) return false;
      const i = l.ids.indexOf(race.id);
      if (i >= 0) l.ids.splice(i, 1);
      else {
        l.ids.push(race.id);
        snaps[race.id] = snapshot(race);
        saveSnaps();
      }
      saveLists();
      if (i >= 0) F.gcSnaps();
      return i < 0;
    },
    // ----- Saison (planificateur, site/saison.js) : {on, objectif, seuil} gardés avec la liste -----
    saison: (listId) => F.get(listId)?.saison || null,
    setSaison(listId, patch) {
      const l = F.get(listId);
      if (!l) return null;
      l.saison = { on: true, objectif: null, seuil: 3, ...(l.saison || {}), ...patch };
      saveLists();
      return l.saison;
    },
    // ----- Sortie à plusieurs (site/groupe.js) : {on, gid, membres} gardés avec la liste et transmis par le lien -----
    groupe: (listId) => F.get(listId)?.groupe || null,
    setGroupe(listId, patch) {
      const l = F.get(listId);
      if (!l) return null;
      l.groupe = { on: true, gid: uid() + uid(), membres: [], ...(l.groupe || {}), ...patch };
      saveLists();
      return l.groupe;
    },
    // La liste locale qui suit ce groupe (même identifiant de groupe), pour la mettre à jour plutôt que la dupliquer.
    listeDuGroupe: (gid) => (gid ? lists.find((l) => l.groupe?.gid === gid) : null) || null,
    has: (listId, raceId) => !!F.get(listId)?.ids.includes(raceId),
    isFav: (raceId) => lists.some((l) => l.ids.includes(raceId)),
    favCount: () => new Set(lists.flatMap((l) => l.ids)).size,
    gcSnaps() {
      const used = new Set(lists.flatMap((l) => l.ids));
      let changed = false;
      for (const k of Object.keys(snaps)) if (!used.has(k)) (delete snaps[k], (changed = true));
      if (changed) saveSnaps();
    },

    /* Après une mise à jour des données, certains identifiants peuvent avoir changé
     * (date précisée, nom corrigé…). On rattache les favoris par nom + commune + km,
     * et l'on renvoie les courses introuvables (instantanés) pour les afficher quand même. */
    reconcile(byId, races) {
      const missing = new Set(lists.flatMap((l) => l.ids).filter((id) => !byId.has(id)));
      if (!missing.size) return [];
      const index = new Map();
      races.forEach((r) => {
        const k = matchKey(r.nom, r.ville, r.distance_km);
        if (!index.has(k)) index.set(k, r.id);
      });
      const remap = new Map();
      missing.forEach((id) => {
        const s = snaps[id];
        const to = s && index.get(matchKey(s.nom, s.ville, s.distance_km));
        if (to) remap.set(id, to);
      });
      if (remap.size) {
        lists.forEach((l) => (l.ids = [...new Set(l.ids.map((id) => remap.get(id) || id))]));
        remap.forEach((to, from) => {
          if (edits[from] && !edits[to]) edits[to] = edits[from];
          delete edits[from];
          snaps[to] = snapshot(byId.get(to));
          delete snaps[from];
        });
        saveLists();
        saveEdits();
        saveSnaps();
      }
      return [...missing].filter((id) => !remap.has(id) && snaps[id]).map((id) => ({ ...snaps[id], _absent: true }));
    },
    refreshSnap(race) {
      if (snaps[race.id]) snaps[race.id] = snapshot(race);
    },
    saveSnapsNow: saveSnaps,

    // ----- Corrections -----
    edits: () => edits,
    editOf: (id) => edits[id],
    setEdit(id, patch) {
      const clean = {};
      EDITABLE.forEach((k) => {
        if (patch[k] !== undefined && patch[k] !== null && patch[k] !== "") clean[k] = patch[k];
      });
      if (Object.keys(clean).length) edits[id] = { ...clean, _ts: new Date().toISOString() };
      else delete edits[id];
      saveEdits();
    },
    clearEdit(id) {
      delete edits[id];
      saveEdits();
    },

    /* Applique une correction à une course. Les champs dérivés (km-effort,
     * catégorie UTMB, points ITRA) sont recalculés comme dans scripts/build_db.py. */
    apply(r, e) {
      if (!e) return r;
      const o = { ...r, _orig: r, _edited: true };
      EDITABLE.forEach((k) => {
        if (e[k] !== undefined) o[k] = e[k];
      });
      if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date_confirmee === undefined) o.date_confirmee = true;
      const km = o.distance_km, d = o.denivele_pos_m;
      if ("distance_km" in e || "denivele_pos_m" in e) {
        o.km_effort = root.Donnees ? root.Donnees.kmEffort(km, d) : km != null && d != null ? Math.round((km + d / 100) * 10) / 10 : null;
        o.utmb_index = F.utmbCategory(o.km_effort);
        o.itra_points_estimes = F.itraPoints(o.km_effort);
      }
      return o;
    },
    utmbCategory(ke) {
      if (ke == null || ke < 20) return null;
      return ke < 45 ? "20K" : ke < 75 ? "50K" : ke < 155 ? "100K" : "100M";
    },
    itraPoints(ke) {
      if (ke == null) return null;
      for (const [lim, pts] of [[25, 0], [45, 1], [75, 2], [115, 3], [155, 4], [210, 5]]) if (ke < lim) return pts;
      return 6;
    },

    // ----- Partage par URL -----
    /* Format : #liste=<v><base64url>, v = "z" (JSON compressé deflate) ou "j" (JSON brut).
     * Contenu : { n: nom, i: [ids], e: {id: corrections}, s: {id: [nom, ville, km]} } */
    async encode(list, byId) {
      const e = {}, s = {};
      list.ids.forEach((id) => {
        if (edits[id]) {
          const { _ts, notes_perso, ...rest } = edits[id]; // les notes perso restent privées
          if (Object.keys(rest).length) e[id] = rest;
        }
        const r = byId.get(id) || snaps[id];
        if (r) s[id] = [r.nom, r.ville, r.distance_km];
      });
      const payload = { n: list.name, i: list.ids };
      if (Object.keys(e).length) payload.e = e;
      payload.s = s;
      const g = list.groupe;
      if (g && g.gid && (g.on || g.membres?.length)) {
        const m = root.Groupe ? root.Groupe.compacter(g).membres : g.membres;
        payload.g = { u: g.gid, m: m.map((x) => [x.n, x.c, x.t]) };
      }
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      if (root.CompressionStream) {
        try {
          const z = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
          return "z" + b64url(new Uint8Array(z));
        } catch (err) {
          /* repli sur le JSON brut */
        }
      }
      return "j" + b64url(bytes);
    },
    async decode(str) {
      const kind = str[0];
      let bytes = unb64url(str.slice(1));
      if (kind === "z") {
        bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      } else if (kind !== "j") throw new Error("format inconnu");
      const p = JSON.parse(new TextDecoder().decode(bytes));
      if (!p || !Array.isArray(p.i)) throw new Error("liste invalide");
      const e = {};
      Object.entries(p.e || {}).forEach(([id, v]) => {
        const clean = {};
        EDITABLE.forEach((k) => v && v[k] != null && (clean[k] = v[k]));
        e[id] = clean;
      });
      let groupe = null;
      if (p.g && typeof p.g === "object" && Array.isArray(p.g.m)) {
        const membres = p.g.m.map((x) => (Array.isArray(x) ? { n: x[0], c: x[1], t: x[2] } : x));
        groupe = { gid: String(p.g.u || "").slice(0, 40), ...(root.Groupe ? root.Groupe.normaliser({ membres }) : { membres: [] }) };
      }
      return { name: String(p.n || "Liste partagée").slice(0, 60), ids: p.i.map(String), edits: e, hints: p.s || {}, groupe };
    },

    /* Les choix du groupe portent les identifiants de l'auteur du lien : on les traduit vers la base locale. */
    remapGroupe(membres, resolved) {
      const to = new Map(resolved.filter((x) => x.to).map((x) => [x.from, x.to]));
      return (membres || []).map((m) => ({ ...m, c: Object.fromEntries(Object.entries(m.c).map(([id, d]) => [to.get(id) || id, d])) }));
    },

    /* Résout les identifiants d'une liste partagée contre la base locale. */
    resolveShared(shared, byId, races) {
      let index = null;
      return shared.ids
        .map((id) => {
          if (byId.has(id)) return id;
          const h = shared.hints[id];
          if (!h) return null;
          index = index || new Map(races.map((r) => [matchKey(r.nom, r.ville, r.distance_km), r.id]));
          return index.get(matchKey(h[0], h[1], h[2])) || null;
        })
        .map((to, k) => ({ from: shared.ids[k], to }));
    },

    /* Enregistre une liste partagée chez soi. Les corrections locales existantes gardent la priorité.
     * Si la liste suit déjà ce groupe (sortie à plusieurs), elle est mise à jour au lieu d'être dupliquée :
     * courses ajoutées, choix du groupe fusionnés personne par personne. */
    importShared(shared, resolved, byId) {
      const ids = resolved.filter((x) => x.to).map((x) => x.to);
      const g = shared.groupe && { ...shared.groupe, membres: F.remapGroupe(shared.groupe.membres, resolved) };
      let l = g && F.listeDuGroupe(g.gid);
      if (l) {
        l.ids = [...new Set([...l.ids, ...ids])];
        l.groupe = { ...l.groupe, on: true, membres: root.Groupe ? root.Groupe.fusionner(l.groupe, g).membres : g.membres };
        saveLists();
      } else {
        l = F.create(shared.name, ids);
        if (g && g.gid) {
          l.groupe = { on: true, gid: g.gid, membres: g.membres };
          saveLists();
        }
      }
      resolved.forEach(({ from, to }) => {
        if (!to) return;
        const r = byId.get(to);
        if (r) snaps[to] = snapshot(r);
        const e = shared.edits[from];
        if (e && Object.keys(e).length && !edits[to]) edits[to] = { ...e, _ts: new Date().toISOString() };
      });
      saveSnaps();
      saveEdits();
      return l;
    },
  };

  function b64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64url(s) {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  root.Favoris = F;
})(typeof window !== "undefined" ? window : globalThis);
