/* Favoris : listes de courses et corrections personnelles, stockées dans le navigateur.
 * Aucune dépendance au DOM : ce module ne fait que lire/écrire localStorage et
 * encoder/décoder les liens de partage. */
(function (root) {
  const K_LISTS = "ta.lists.v1";
  const K_EDITS = "ta.edits.v1";
  const K_SNAPS = "ta.snaps.v1";
  const K_MOD = "ta.favmod.v1"; // date de la dernière modification des listes ou corrections
  const K_BACKUP = "ta.backup.v1"; // date de la dernière sauvegarde dans un fichier
  const PREFIX = "ta."; // toutes les préférences du site commencent ainsi
  const FORMAT = "agregatrail-sauvegarde";

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
  const touch = () => store.set(K_MOD, new Date().toISOString());
  const saveLists = () => (store.set(K_LISTS, lists), touch());
  const saveEdits = () => (store.set(K_EDITS, edits), touch());
  const reload = () => {
    lists = store.get(K_LISTS, []);
    edits = store.get(K_EDITS, {});
    snaps = store.get(K_SNAPS, {});
  };
  /* Un autre onglet (par exemple une ancienne version du site restée ouverte) a modifié les listes :
   * on relit le stockage, sinon sa prochaine écriture écraserait ce que l'autre onglet vient d'enregistrer. */
  if (root.addEventListener) {
    root.addEventListener("storage", (e) => {
      if (e.key !== null && ![K_LISTS, K_EDITS, K_SNAPS].includes(e.key)) return;
      reload();
      if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent("favoris:change"));
    });
  }
  // Valeurs brutes (texte), telles que chaque module du site les écrit.
  const rawGet = (k) => {
    try {
      const v = root.localStorage.getItem(k);
      if (v != null) return v;
    } catch (e) {
      /* stockage indisponible */
    }
    return k in mem ? JSON.stringify(mem[k]) : null;
  };
  const rawSet = (k, v) => {
    try {
      root.localStorage.setItem(k, v);
    } catch (e) {
      /* stockage indisponible */
    }
  };
  // Toutes les clés du site présentes dans ce navigateur (ou en mémoire si le stockage est indisponible).
  const siteKeys = () => {
    const out = new Set(Object.keys(mem).filter((k) => k.startsWith(PREFIX)));
    try {
      for (let i = 0; i < root.localStorage.length; i++) {
        const k = root.localStorage.key(i);
        if (k && k.startsWith(PREFIX)) out.add(k);
      }
    } catch (e) {
      /* stockage indisponible */
    }
    return [...out].sort();
  };
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
    reload,

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

    // ----- Sauvegarde dans un fichier -----
    /* Le navigateur peut effacer les données d'un site (manque de place, Safari après 7 jours sans visite,
     * navigateur intégré d'une autre application…). Le fichier de sauvegarde contient tout ce que le site
     * garde dans ce navigateur : listes, corrections, réglages (semaines libres, estimation de temps…). */
    exportAll() {
      const donnees = {};
      siteKeys()
        .filter((k) => k !== K_BACKUP)
        .forEach((k) => {
          const v = rawGet(k);
          if (v !== null) donnees[k] = v;
        });
      // Chaque valeur est copiée telle quelle (texte), pour être restituée à l'identique.
      return { format: FORMAT, version: 1, exporte_le: new Date().toISOString(), donnees };
    },
    markBackup() {
      store.set(K_BACKUP, new Date().toISOString());
    },
    /* État de la sauvegarde : date du dernier fichier, et s'il y a eu des changements depuis. */
    backupStatus() {
      const at = store.get(K_BACKUP, null);
      const mod = store.get(K_MOD, null);
      const contenu = lists.length > 0 || Object.keys(edits).length > 0;
      return { at, changed: contenu && (!at || (mod && mod > at)) };
    },
    /* Restaure un fichier de sauvegarde sans rien perdre de ce qui existe déjà ici :
     * listes fusionnées (même liste : courses ajoutées ; autre liste : ajoutée, renommée si le nom est pris),
     * corrections locales prioritaires, autres réglages restaurés seulement s'ils manquent ici. */
    importAll(obj) {
      if (!obj || obj.format !== FORMAT || typeof obj.donnees !== "object" || !obj.donnees) throw new Error("fichier de sauvegarde invalide");
      const d = {};
      Object.entries(obj.donnees).forEach(([k, v]) => typeof v === "string" && (d[k] = v));
      const parse = (k, def) => {
        try {
          return k in d ? JSON.parse(d[k]) : def;
        } catch (e) {
          return def;
        }
      };
      const vide = !lists.length && !Object.keys(edits).length;
      const res = { ajoutees: 0, completees: 0, reglages: 0 };
      [].concat(parse(K_LISTS, [])).forEach((b) => {
        if (!b || typeof b.id !== "string" || !Array.isArray(b.ids)) return;
        const ids = b.ids.map(String);
        const l = F.get(b.id);
        if (l) {
          const avant = l.ids.length;
          l.ids = [...new Set([...l.ids, ...ids])];
          if (l.ids.length > avant) res.completees++;
          if (!l.saison && b.saison) l.saison = b.saison;
          if (!l.groupe && b.groupe) l.groupe = b.groupe;
        } else {
          lists.push({ ...b, name: uniqueName(String(b.name || "Ma liste").slice(0, 60)), ids: [...new Set(ids)] });
          res.ajoutees++;
        }
      });
      const fill = (dst, src) => src && typeof src === "object" && Object.entries(src).forEach(([k, v]) => !(k in dst) && (dst[k] = v));
      fill(edits, parse(K_EDITS, {}));
      fill(snaps, parse(K_SNAPS, {}));
      saveLists();
      saveEdits();
      saveSnaps();
      const present = new Set(siteKeys());
      Object.entries(d).forEach(([k, v]) => {
        if (!k.startsWith(PREFIX) || [K_LISTS, K_EDITS, K_SNAPS, K_MOD, K_BACKUP].includes(k) || present.has(k)) return;
        rawSet(k, v);
        res.reglages++;
      });
      // Restauré dans un navigateur vide : le contenu est celui du fichier, donc déjà sauvegardé.
      if (vide) F.markBackup();
      return res;
    },
    /* Demande au navigateur de ne pas effacer les données du site quand il manque de place.
     * Sans fenêtre de confirmation dans Chrome, Edge et Safari ; Firefox peut demander l'accord. */
    async protect() {
      const s = root.navigator && root.navigator.storage;
      if (!s || !s.persist) return null;
      try {
        return (await s.persisted()) || (await s.persist());
      } catch (e) {
        return null;
      }
    },

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
