/* Comptes Agregatrail : appels à l'API PHP (dossier api/, hébergement OVH) et
 * état de connexion. Sans API (GitHub Pages, hors ligne), Session.me() renvoie null :
 * le site garde alors son fonctionnement sans compte et les liens GitHub d'origine.
 * Les fonctions locales (listes, semaines libres) ne dépendent jamais de ce fichier. */
(function (root) {
  const script = typeof document !== "undefined" ? document.currentScript : null;
  // Chemin de la racine du site, déduit de l'adresse de ce script (fonctionne depuis compte/, admin/…).
  const base = script ? new URL(".", script.src).href : "./";

  async function api(chemin, data, { timeout = 15000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const form = typeof FormData !== "undefined" && data instanceof FormData;
    const opts = { method: data ? "POST" : "GET", credentials: "same-origin", signal: ctl.signal, headers: { "X-Agregatrail": "1" } };
    if (data) {
      opts.body = form ? data : JSON.stringify(data);
      if (!form) opts.headers["Content-Type"] = "application/json";
    }
    let r, j;
    try {
      r = await fetch(base + "api/" + chemin, opts);
      j = await r.json();
    } catch (e) {
      const err = new Error("Le service des comptes ne répond pas. Réessayez dans un instant.");
      err.status = 0;
      throw err;
    } finally {
      clearTimeout(t);
    }
    if (!r.ok) {
      const err = new Error(j.erreur || "Une erreur est survenue.");
      err.status = r.status;
      throw err;
    }
    return j;
  }

  let moi = null;
  /* { connecte, utilisateur } ou null si l'API n'existe pas (site statique). */
  function me(rafraichir = false) {
    if (!moi || rafraichir) moi = api("auth.php?action=me", null, { timeout: 6000 }).catch((e) => (e.status ? { connecte: false, utilisateur: null } : null));
    return moi;
  }

  /* En-tête de la page d'accueil : « Ajouter une course » mène au formulaire du site
   * et un lien « Se connecter » / « Mon compte » apparaît quand l'API répond. */
  async function entete() {
    const nav = document.querySelector(".site-header .nav");
    if (!nav) return;
    const etat = await me();
    if (!etat) return;
    const ajout = nav.querySelector(".add-race");
    if (ajout) {
      ajout.href = base + "ajouter/";
      ajout.removeAttribute("target");
      ajout.removeAttribute("rel");
    }
    const u = etat.utilisateur;
    const lien = document.createElement("a");
    lien.className = "nav-link nav-compte";
    lien.href = base + (u && u.admin ? "admin/" : "compte/");
    const txt = u ? (u.admin ? "Administration" : "Mon compte") : "Se connecter";
    lien.setAttribute("aria-label", txt);
    lien.innerHTML = '<svg aria-hidden="true"><use href="#i-user"/></svg><span class="nl-txt"></span>';
    lien.querySelector(".nl-txt").textContent = txt;
    nav.insertBefore(lien, ajout || null);
  }

  root.Session = { api, me, base, entete };
  if (typeof document !== "undefined" && document.querySelector(".site-header .nav")) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", entete);
    else entete();
  }
})(typeof window !== "undefined" ? window : globalThis);
