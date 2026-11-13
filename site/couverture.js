/* Couverture par région : combien de courses le site connaît dans chaque région, et d'où elles viennent.
 * Occitanie, PACA et Auvergne-Rhône-Alpes sont couvertes par toutes les sources (calendriers publics,
 * RunTrail, GoTrail, DATAtourisme) ; ailleurs, seules DATAtourisme et quelques ajouts manuels alimentent
 * la base, donc la couverture y est partielle.
 * - Couverture.calculer(evenements, regName) : [{code, nom, n, complete}] (n = événements à venir).
 * - Couverture.resume(lignes) / Couverture.html(lignes, esc) : phrase d'accueil et tableau du dialogue. */
(function (root) {
  const COMPLETES = ["76", "93", "84"];
  const COURT = { "93": "PACA" };

  function calculer(evenements, regName) {
    const n = new Map([...regName.keys()].map((c) => [c, 0]));
    for (const rows of evenements) {
      const c = rows[0] && rows[0].region_code;
      if (c && n.has(c)) n.set(c, n.get(c) + 1);
    }
    return [...n]
      .filter(([c, k]) => k > 0 || /^\d\d$/.test(c) && Number(c) >= 11) // régions de métropole, même vides
      .map(([code, k]) => ({ code, nom: regName.get(code), n: k, complete: COMPLETES.includes(code) }))
      .sort((a, b) => b.complete - a.complete || b.n - a.n || a.nom.localeCompare(b.nom, "fr"));
  }

  function resume(lignes) {
    const comp = COMPLETES.map((c) => lignes.find((l) => l.code === c)).filter(Boolean).map((l) => COURT[l.code] || l.nom);
    if (!comp.length) return "";
    const liste = comp.length > 1 ? `${comp.slice(0, -1).join(", ")} et ${comp[comp.length - 1]}` : comp[0];
    return `Couverture complète en ${liste}, partielle ailleurs`;
  }

  function html(lignes, esc = (s) => s) {
    const max = Math.max(1, ...lignes.map((l) => l.n));
    const li = (l) =>
      `<li><span class="couv-nom">${esc(l.nom)}</span><span class="couv-n">${l.n.toLocaleString("fr-FR")}</span>` +
      `<span class="tag${l.complete ? "" : " muted"}">${l.complete ? "complète" : "partielle"}</span>` +
      `<span class="couv-barre" style="--p:${Math.round((l.n / max) * 100)}%" aria-hidden="true"></span></li>`;
    return `<ul class="couv" aria-label="Courses à venir par région">${lignes.map(li).join("")}</ul>`;
  }

  root.Couverture = { calculer, resume, html, COMPLETES };
})(typeof window !== "undefined" ? window : globalThis);
