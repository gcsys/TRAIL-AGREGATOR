/* Comparateur : deux à quatre formats côte à côte (distance, D+, D+/km, km-effort, date, trajet, prix,
 * temps estimé). La sélection (ids de formats) est gardée dans ce navigateur (clé ta.cmp.v1).
 * - Comparateur.basculer(id) / a(id) / ids() / vider() / retirer(id)
 * - Comparateur.lignes(rows, opts) : [{libelle, valeurs[], meilleur?}] ; Comparateur.html(rows, opts, esc).
 * opts : {trajet(r) -> texte|null, temps(r) -> texte|null, chrono: libellé du chrono ou ""}.
 * Les valeurs calculées (D+/km, km-effort, trajet, temps) sont marquées comme telles. */
(function (root) {
  const KEY = "ta.cmp.v1";
  const MAX = 4;
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  let sel = [];
  try {
    sel = (JSON.parse(root.localStorage.getItem(KEY)) || []).filter((x) => typeof x === "string").slice(0, MAX);
  } catch (e) {
    sel = [];
  }
  const save = () => {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(sel));
    } catch (e) {
      /* navigation privée : gardé le temps de la visite */
    }
  };

  const num = (v, d = 0) => (v == null ? null : Number(v.toFixed(d)).toLocaleString("fr-FR"));
  const dateTxt = (d) => {
    if (!d) return "date inconnue";
    const [y, m, j] = d.split("-").map(Number);
    if (!j) return `${MOIS[m - 1]} ${y}, jour à préciser`;
    return `${JOURS[new Date(Date.UTC(y, m - 1, j)).getUTCDay()]} ${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${y}`;
  };
  const dpkm = (r) => (r.distance_km && r.denivele_pos_m != null ? r.denivele_pos_m / r.distance_km : null);
  const prix = (r) => (r.inscription && r.inscription.prix != null ? r.inscription.prix : r.prix_eur ?? null);

  function lignes(rows, { trajet = () => null, temps = () => null } = {}) {
    const L = (libelle, f, opts = {}) => ({ libelle, valeurs: rows.map(f), ...opts });
    const out = [
      L("Date", (r) => dateTxt(r.date) + (r.date && r.date.length === 10 && !r.date_confirmee ? " (à confirmer)" : "")),
      L("Lieu", (r) => [r.ville, r.departement_code && `(${r.departement_code})`].filter(Boolean).join(" ")),
      L("Distance", (r) => (r.distance_km == null ? "?" : `${num(r.distance_km, 1)} km`)),
      L("D+", (r) => (r.denivele_pos_m == null ? "inconnu" : `${num(r.denivele_pos_m)} m`)),
      L("D+ par km", (r) => (dpkm(r) == null ? "–" : `${num(dpkm(r))} m/km`), { calcule: true }),
      L("Km-effort", (r) => (r.km_effort == null ? "–" : num(r.km_effort, 1)), { calcule: true }),
      L("Trajet", (r) => trajet(r) || "–", { calcule: true }),
      L("Prix", (r) => (prix(r) == null ? "–" : `${String(prix(r)).replace(".", ",")} €`)),
      L("Temps estimé", (r) => temps(r) || "–", { calcule: true }),
    ];
    return out.filter((l) => l.libelle !== "Trajet" && l.libelle !== "Temps estimé" && l.libelle !== "Prix" ? true : l.valeurs.some((v) => v !== "–"));
  }

  function html(rows, opts = {}, esc = (s) => s) {
    if (!rows.length) return `<p class="dlg-note">Aucun format sélectionné.</p>`;
    const tete = rows.map((r) =>
      `<th scope="col"><button type="button" class="link" data-act="fiche" data-key="${esc(opts.cle ? opts.cle(r) : "")}" data-rid="${esc(r.id)}">${esc(r.nom)}</button>` +
      `${r.course && r.course !== r.nom ? `<span class="dim">${esc(r.course)}</span>` : ""}` +
      `<button type="button" class="cmp-x" data-cmp-retirer="${esc(r.id)}" aria-label="Retirer ${esc(r.nom)} de la comparaison">×</button></th>`).join("");
    const corps = lignes(rows, opts).map((l) =>
      `<tr><th scope="row">${esc(l.libelle)}${l.calcule ? ` <span class="tag muted">calcul</span>` : ""}</th>${l.valeurs.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("");
    const notes = [];
    if (!lignes(rows, opts).some((l) => l.libelle === "Trajet"))
      notes.push("Choisissez un point de départ avec « Rayon » pour comparer les trajets.");
    if (!lignes(rows, opts).some((l) => l.libelle === "Temps estimé"))
      notes.push("Indiquez un chrono de référence sur une fiche pour comparer les temps estimés.");
    else if (opts.chrono) notes.push(`Temps estimés d'après votre référence : ${opts.chrono}.`);
    return `<div class="cmp-wrap"><table class="cmp"><thead><tr><th></th>${tete}</tr></thead><tbody>${corps}</tbody></table></div>` +
      (notes.length ? `<p class="dlg-note">${notes.map(esc).join(" ")}</p>` : "");
  }

  root.Comparateur = {
    MAX,
    ids: () => sel.slice(),
    a: (id) => sel.includes(id),
    /* true si ajouté, false si retiré, null si la sélection est pleine */
    basculer(id) {
      if (sel.includes(id)) return (sel = sel.filter((x) => x !== id)), save(), false;
      if (sel.length >= MAX) return null;
      sel.push(id);
      save();
      return true;
    },
    retirer(id) {
      sel = sel.filter((x) => x !== id);
      save();
    },
    vider() {
      sel = [];
      save();
    },
    lignes, html, dateTxt,
  };
})(typeof window !== "undefined" ? window : globalThis);
