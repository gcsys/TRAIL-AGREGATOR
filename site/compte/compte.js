/* Page Mon compte : connexion, inscription, mot de passe oublié, propositions du membre. */
(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const msg = (t, ok = true) => {
    $("#msg").className = "msg " + (ok ? "ok" : "err");
    $("#msg").textContent = t || "";
    if (t) $("#msg").scrollIntoView({ block: "nearest" });
  };
  const STATUTS = { attente: "En attente de validation", publiee: "Publiée", refusee: "Non retenue" };
  const dateFr = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : d);

  /* Envoi d'un formulaire : bouton désactivé pendant l'appel, erreurs affichées. */
  function brancher(form, action) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = form.querySelector("button:not([type=button])");
      b.disabled = true;
      msg("");
      try {
        await action(Object.fromEntries(new FormData(form)));
      } catch (err) {
        msg(err.message, false);
      } finally {
        b.disabled = false;
      }
    });
  }

  const p = new URLSearchParams(location.search);
  const etat = await Session.me();
  $("#chargement").hidden = true;
  if (!etat) {
    $("#indispo").hidden = false;
    return;
  }
  if (p.get("verifie")) msg("Adresse confirmée, votre compte est actif.");
  if (p.get("lien") === "invalide") msg("Ce lien de confirmation n'est plus valable. Connectez-vous ou recréez votre compte.", false);
  if (p.has("verifie") || p.has("lien")) history.replaceState(null, "", location.pathname);

  const jeton = p.get("reset");
  if (jeton) {
    $("#f-reset").hidden = false;
    brancher($("#f-reset"), async (d) => {
      await Session.api("auth.php?action=reset", { jeton, mdp: d.mdp });
      history.replaceState(null, "", location.pathname);
      location.reload();
    });
    return;
  }

  if (!etat.connecte) {
    $("#visiteur").hidden = false;
    const onglet = (nom) => {
      ["connexion", "inscription"].forEach((n) => {
        $("#t-" + n).setAttribute("aria-selected", String(n === nom));
        $("#f-" + n).hidden = n !== nom;
      });
      $("#f-oubli").hidden = true;
    };
    $("#t-connexion").onclick = () => onglet("connexion");
    $("#t-inscription").onclick = () => onglet("inscription");
    if (p.get("inscription")) onglet("inscription");
    $("#vers-oubli").onclick = () => {
      $("#f-connexion").hidden = true;
      $("#f-oubli").hidden = false;
      $("#o-email").value = $("#c-email").value;
      $("#o-email").focus();
    };
    $("#oubli-annuler").onclick = () => onglet("connexion");
    brancher($("#f-connexion"), async (d) => {
      await Session.api("auth.php?action=connexion", d);
      const retour = p.get("retour");
      if (retour && /^[a-z/]+$/.test(retour)) location.href = Session.base + retour;
      else location.reload();
    });
    brancher($("#f-inscription"), async (d) => {
      const r = await Session.api("auth.php?action=inscription", d);
      $("#f-inscription").reset();
      msg(r.message);
    });
    brancher($("#f-oubli"), async (d) => msg((await Session.api("auth.php?action=oubli", d)).message));
    return;
  }

  // Connecté
  const u = etat.utilisateur;
  $("#membre").hidden = false;
  $("#m-nom").textContent = u.nom;
  $("#m-email").textContent = u.email;
  $("#m-admin").hidden = !u.admin;
  $("#deconnexion").onclick = async () => {
    await Session.api("auth.php?action=deconnexion", {}).catch(() => {});
    location.reload();
  };
  try {
    const { courses } = await Session.api("courses.php?action=mes");
    if (!courses.length) return;
    const groupes = new Map();
    courses.forEach((c) => {
      if (!groupes.has(c.groupe)) groupes.set(c.groupe, []);
      groupes.get(c.groupe).push(c);
    });
    $("#mes").innerHTML = [...groupes.values()]
      .map((fs) => {
        const c = fs[0];
        const formats = fs.map((f) => `${esc(f.course || f.distance_km + " km")} : ${esc(f.distance_km)} km${f.denivele_pos_m != null ? ", " + esc(f.denivele_pos_m) + " m D+" : ""}`).join(" · ");
        return `<div class="ev"><h3>${esc(c.nom)} <span class="statut ${esc(c.statut)}">${esc(STATUTS[c.statut] || c.statut)}</span></h3>
          <div class="meta">${esc(dateFr(c.date))} · ${esc(c.ville)}</div><div>${formats}</div>
          ${c.note_admin ? `<p class="note">Note de l'administrateur : ${esc(c.note_admin)}</p>` : ""}</div>`;
      })
      .join("");
  } catch (e) {
    msg(e.message, false);
  }
})();
