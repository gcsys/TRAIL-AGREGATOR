/* Sortie à plusieurs : sur une liste partagée, chacun indique son format et son dossard.
 * Sans serveur : l'état voyage dans le lien de partage (favoris.js), chacun renvoie le lien mis à jour.
 * - Groupe.normaliser(g) : nettoie un état reçu d'un lien ({membres: [{n, c: {idFormat: dossard}, t}]}).
 * - Groupe.choisir(g, nom, id, dossard) / Groupe.retirer(g, nom, id) : modifications locales, horodatées par personne.
 * - Groupe.fusionner(a, b) : réunit deux versions du même groupe ; pour chaque personne, la version
 *   la plus récente gagne. Une personne retirée reste comme « pierre tombale » (c vide) pour que
 *   le retrait se propage aussi.
 * - Groupe.html(rows, g, esc, {edition}) : section affichée au-dessus de la liste.
 * Aucune dépendance au DOM. */
(function (root) {
  const MAX_MEMBRES = 30;
  const nomCle = (s) => String(s || "").trim().toLowerCase();
  const propre = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

  function normaliser(g) {
    const out = { membres: [] };
    const vus = new Set();
    for (const m of (g && Array.isArray(g.membres) ? g.membres : []).slice(0, MAX_MEMBRES * 2)) {
      const n = propre(m && m.n, 30);
      if (!n || vus.has(nomCle(n))) continue;
      vus.add(nomCle(n));
      const c = {};
      Object.entries((m && typeof m.c === "object" && m.c) || {}).slice(0, 20).forEach(([id, d]) => (c[propre(id, 120)] = propre(d, 12)));
      out.membres.push({ n, c, t: Number(m.t) || 0 });
    }
    return out;
  }

  const trouver = (g, nom) => g.membres.find((m) => nomCle(m.n) === nomCle(nom));

  function choisir(g, nom, id, dossard = "", t = Date.now()) {
    nom = propre(nom, 30);
    if (!nom || !id) return g;
    let m = trouver(g, nom);
    if (!m) {
      if (g.membres.filter((x) => Object.keys(x.c).length).length >= MAX_MEMBRES) return g;
      g.membres.push((m = { n: nom, c: {}, t }));
    }
    m.c[id] = propre(dossard, 12);
    m.t = Math.max(t, m.t + 1);
    return g;
  }

  function retirer(g, nom, id, t = Date.now()) {
    const m = trouver(g, nom);
    if (!m) return g;
    if (id) delete m.c[id];
    else m.c = {};
    m.t = Math.max(t, m.t + 1);
    return g;
  }

  function fusionner(a, b) {
    const par = new Map();
    for (const m of [...normaliser(a).membres, ...normaliser(b).membres]) {
      const k = nomCle(m.n), p = par.get(k);
      if (!p || m.t > p.t) par.set(k, m);
    }
    return { membres: [...par.values()] };
  }

  /* Pierres tombales de plus de 60 jours : inutile de les faire voyager plus longtemps. */
  function compacter(g, maintenant = Date.now()) {
    return { membres: g.membres.filter((m) => Object.keys(m.c).length || maintenant - m.t < 60 * 864e5) };
  }

  const actifs = (g) => g.membres.filter((m) => Object.keys(m.c).length);

  /* Pour chaque format de la liste, les personnes qui y vont ; et les choix devenus orphelins
   * (format retiré de la liste). */
  function repartition(rows, g) {
    const ids = new Set(rows.map((r) => r.id));
    const par = new Map(rows.map((r) => [r.id, []]));
    const orphelins = [];
    for (const m of actifs(g))
      for (const [id, d] of Object.entries(m.c)) {
        if (ids.has(id)) par.get(id).push({ n: m.n, d });
        else orphelins.push({ n: m.n, id });
      }
    par.forEach((l) => l.sort((x, y) => x.n.localeCompare(y.n, "fr")));
    return { par, orphelins };
  }

  const km = (v) => (v == null ? "" : `${String(v).replace(".", ",")} km`);

  function html(rows, g, esc = (s) => s, { edition = true } = {}) {
    const tri = rows.slice().sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")) || (a.distance_km ?? 0) - (b.distance_km ?? 0));
    const { par, orphelins } = repartition(tri, g);
    const n = actifs(g).length;
    const lignes = tri.map((r) => {
      const qui = par.get(r.id);
      const puces = qui.map((p) => `<span class="gp-puce">${esc(p.n)}${p.d ? ` <span class="gp-dos">n° ${esc(p.d)}</span>` : ""}${edition ? `<button type="button" class="gp-x" data-gp-retirer="${esc(p.n)}" data-gp-id="${esc(r.id)}" aria-label="Retirer ${esc(p.n)} de ce format" title="Retirer">×</button>` : ""}</span>`).join("");
      return `<li class="gp-format${qui.length ? "" : " vide"}">
        <span class="gp-nom">${esc(r.nom)} <span class="dim">${esc(r.course || km(r.distance_km))}</span></span>
        <span class="gp-qui">${puces || `<span class="dim">Personne pour l'instant</span>`}</span></li>`;
    });
    const options = tri.map((r) => `<option value="${esc(r.id)}">${esc(r.nom)}${r.distance_km != null ? ` · ${esc(km(r.distance_km))}` : ""}</option>`).join("");
    const form = edition && tri.length
      ? `<form class="gp-form" autocomplete="off">
          <label>Prénom<input name="nom" required maxlength="30" list="gp-noms" placeholder="Qui ?"></label>
          <datalist id="gp-noms">${actifs(g).map((m) => `<option value="${esc(m.n)}">`).join("")}</datalist>
          <label>Format<select name="id">${options}</select></label>
          <label>Dossard<input name="dossard" maxlength="12" inputmode="numeric" placeholder="facultatif"></label>
          <button class="btn primary" type="submit">Ajouter</button></form>`
      : "";
    const perdus = orphelins.length ? `<p class="dlg-note">${orphelins.length} choix sur des formats qui ne sont plus dans la liste : ${esc(orphelins.map((o) => o.n).join(", "))}.</p>` : "";
    return `<section class="groupe"><div class="sz-head"><h2>Sortie à plusieurs</h2>
      <span class="dim">${n ? `${n} personne${n > 1 ? "s" : ""}` : "Personne encore"}</span></div>
      ${form}<ul class="gp-liste">${lignes.join("")}</ul>${perdus}
      <p class="dlg-note">${edition ? "Les choix sont enregistrés dans ce navigateur. Pour les transmettre, partagez la liste : prénoms et dossards sont dans le lien, envoyez-le seulement au groupe. Quand quelqu'un vous renvoie son lien, ouvrez-le et choisissez « Mettre à jour ma liste » : pour chaque personne, la modification la plus récente l'emporte." : "Enregistrez la liste pour ajouter votre format et votre dossard, puis renvoyez le lien au groupe."}</p></section>`;
  }

  root.Groupe = { normaliser, choisir, retirer, fusionner, compacter, actifs, repartition, html, MAX_MEMBRES };
})(typeof window !== "undefined" ? window : globalThis);
