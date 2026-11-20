/* Page Administration : validation des courses proposées, membres, import/export CSV. */
(async function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const msg = (t, ok = true) => {
    $("#msg").className = "msg " + (ok ? "ok" : "err");
    $("#msg").textContent = t || "";
  };
  const dateFr = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : d || "");

  const etat = await Session.me();
  $("#chargement").hidden = true;
  if (!etat || !etat.utilisateur || !etat.utilisateur.admin) return ($("#refus").hidden = false);
  $("#admin").hidden = false;

  let vue = "attente";
  const onglets = [...document.querySelectorAll("[data-vue]")];
  onglets.forEach((b) => (b.onclick = () => montrer(b.dataset.vue)));
  function montrer(v) {
    vue = v;
    onglets.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.vue === v)));
    $("#v-courses").hidden = !["attente", "publiee", "refusee"].includes(v);
    $("#v-membres").hidden = v !== "membres";
    $("#v-donnees").hidden = v !== "donnees";
    msg("");
    if (!$("#v-courses").hidden) chargerCourses();
    if (v === "membres") chargerMembres();
  }

  // ----- Courses -----
  const CHAMPS = [["nom", "Nom"], ["course", "Format"], ["date", "Date", "date"], ["ville", "Commune"], ["code_postal", "Code postal"],
    ["distance_km", "Distance (km)"], ["denivele_pos_m", "D+ (m)"], ["heure_depart", "Heure"], ["site_web", "Site officiel"],
    ["lien_inscription", "Inscription"], ["organisateur", "Organisateur"]];

  async function chargerCourses() {
    const zone = $("#v-courses");
    zone.innerHTML = '<p class="note">Chargement…</p>';
    let r;
    try {
      r = await Session.api(`admin.php?action=liste&statut=${vue}`);
    } catch (e) {
      return (zone.innerHTML = `<p class="msg err">${esc(e.message)}</p>`);
    }
    ["attente", "publiee", "refusee"].forEach((s) => ($("#n-" + s).textContent = r.comptes[s] || 0));
    if (!r.courses.length) return (zone.innerHTML = `<p class="note">${vue === "attente" ? "Rien à valider. 👍" : "Aucune course."}</p>`);
    const groupes = new Map();
    r.courses.forEach((c) => {
      if (!groupes.has(c.groupe)) groupes.set(c.groupe, []);
      groupes.get(c.groupe).push(c);
    });
    const byId = new Map(r.courses.map((c) => [String(c.id), c]));
    zone.innerHTML = [...groupes.values()]
      .map((fs) => {
        const c = fs[0];
        const ids = fs.map((f) => f.id).join(",");
        const liens = [c.site_web && `<a href="${esc(c.site_web)}" target="_blank" rel="noopener nofollow">site officiel</a>`,
          c.lien_inscription && `<a href="${esc(c.lien_inscription)}" target="_blank" rel="noopener nofollow">inscription</a>`,
          c.lat != null && `<a href="https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=12/${c.lat}/${c.lon}" target="_blank" rel="noopener">voir le lieu</a>`].filter(Boolean).join(" · ");
        return `<div class="ev" data-ids="${ids}">
          <h3>${esc(c.nom)} <span class="statut ${esc(c.statut)}">${esc(c.statut)}</span></h3>
          <div class="meta">${esc(dateFr(c.date))}${c.heure_depart ? " à " + esc(c.heure_depart) : ""}${c.date_confirmee == 0 ? " (date à confirmer)" : ""}
            · ${esc(c.ville)} ${esc(c.code_postal)}${c.lat == null ? " · <b>sans coordonnées</b> (placée au prochain build)" : ""}
            · ${c.origine === "import" ? "import" : "par " + esc(c.membre || "?") + " &lt;" + esc(c.membre_email || "") + "&gt;"}, le ${esc((c.cree_le || "").slice(0, 10))}</div>
          ${liens ? `<div class="meta">${liens}</div>` : ""}
          ${c.organisateur ? `<div class="meta">Organisateur : ${esc(c.organisateur)}</div>` : ""}
          <div class="formats">${fs.map((f) => `<div class="fmt"><b>${esc(f.course || "Format")}</b> ${esc(f.distance_km)} km${f.denivele_pos_m != null ? " · " + esc(f.denivele_pos_m) + " m D+" : " · D+ inconnu"}${f.prix_eur != null ? " · " + esc(f.prix_eur) + " €" : ""}${f.nocturne == 1 ? " · nocturne" : ""}
            <button type="button" class="linkish edit" data-edit="${f.id}">Modifier</button></div>`).join("")}</div>
          ${c.notes ? `<p class="note">Remarque : ${esc(c.notes)}</p>` : ""}
          ${c.note_admin ? `<p class="note">Note admin : ${esc(c.note_admin)}</p>` : ""}
          <input class="note-admin" placeholder="Motif (envoyé au membre si refus)" aria-label="Motif">
          <div class="actions">
            ${c.statut !== "publiee" ? `<button type="button" class="btn primaire" data-dec="publier">Publier</button>` : ""}
            ${c.statut !== "refusee" ? `<button type="button" class="btn" data-dec="refuser">Refuser</button>` : ""}
            <button type="button" class="btn danger" data-dec="supprimer">Supprimer</button>
          </div></div>`;
      })
      .join("");

    zone.querySelectorAll("[data-dec]").forEach((b) =>
      (b.onclick = async () => {
        const ev = b.closest(".ev");
        const decision = b.dataset.dec;
        if (decision === "supprimer" && b.dataset.confirme !== "1") {
          b.dataset.confirme = "1";
          b.textContent = "Confirmer la suppression";
          return;
        }
        b.disabled = true;
        try {
          await Session.api("admin.php?action=moderer", { ids: ev.dataset.ids.split(",").map(Number), decision, note: $(".note-admin", ev).value });
          msg(decision === "publier" ? "Course publiée, le membre est prévenu." : decision === "refuser" ? "Course refusée, le membre est prévenu." : "Course supprimée.");
          chargerCourses();
        } catch (e) {
          msg(e.message, false);
          b.disabled = false;
        }
      })
    );
    zone.querySelectorAll("[data-edit]").forEach((b) =>
      (b.onclick = () => {
        const c = byId.get(b.dataset.edit);
        const fmt = b.closest(".fmt");
        if (fmt.nextElementSibling?.matches("form.modif")) return fmt.nextElementSibling.remove();
        const f = document.createElement("form");
        f.className = "modif";
        f.innerHTML = `<div class="grille">${CHAMPS.map(([k, l, t]) => `<div><label>${l}<input name="${k}" type="${t || "text"}" value="${esc(c[k] ?? "")}"></label></div>`).join("")}</div>
          <div class="actions"><button class="btn primaire">Enregistrer</button></div>`;
        f.onsubmit = async (e) => {
          e.preventDefault();
          try {
            await Session.api("admin.php?action=modifier", { id: c.id, ...Object.fromEntries(new FormData(f)) });
            msg("Modification enregistrée.");
            chargerCourses();
          } catch (err) {
            msg(err.message, false);
          }
        };
        fmt.after(f);
      })
    );
  }

  // ----- Membres -----
  async function chargerMembres() {
    const tb = $("#membres");
    try {
      const { utilisateurs } = await Session.api("admin.php?action=utilisateurs");
      tb.innerHTML = utilisateurs
        .map((u) => `<tr><td><b>${esc(u.nom)}</b><br><span class="note">${esc(u.email)}</span></td><td>${esc((u.cree_le || "").slice(0, 10))}</td>
          <td>${esc(u.courses)}</td><td>${u.role === "admin" ? "admin" : u.bloque == 1 ? "suspendu" : u.verifie_le ? "actif" : "e-mail non confirmé"}</td>
          <td>${u.role === "admin" ? "" : `<button type="button" class="linkish" data-bloq="${u.id}" data-val="${u.bloque == 1 ? 0 : 1}">${u.bloque == 1 ? "Réactiver" : "Suspendre"}</button>`}</td></tr>`)
        .join("");
      tb.querySelectorAll("[data-bloq]").forEach((b) =>
        (b.onclick = async () => {
          await Session.api("admin.php?action=bloquer", { id: Number(b.dataset.bloq), bloque: Number(b.dataset.val) }).catch((e) => msg(e.message, false));
          chargerMembres();
        })
      );
    } catch (e) {
      msg(e.message, false);
    }
  }

  // ----- Import -----
  $("#f-import").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const b = $("button", f);
    b.disabled = true;
    $("#import-res").innerHTML = "";
    try {
      const fd = new FormData(f);
      if (!f.essai.checked) fd.delete("essai");
      const r = await Session.api("admin.php?action=import", fd, { timeout: 120000 });
      $("#import-res").innerHTML = `<div class="msg ok">${r.essai ? "Simulation : " : ""}${r.ajoutees} ajoutée(s), ${r.mises_a_jour} mise(s) à jour, ${r.ignorees} ignorée(s).
        ${r.essai ? "Décochez « Simuler seulement » pour enregistrer." : ""}</div>${r.erreurs.length ? `<ul class="note">${r.erreurs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
      if (!r.essai) chargerCourses();
    } catch (err) {
      $("#import-res").innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    } finally {
      b.disabled = false;
    }
  });

  montrer("attente");
})();
