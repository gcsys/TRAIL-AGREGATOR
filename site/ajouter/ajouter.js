/* Page Ajouter une course : formulaire réservé aux membres connectés. */
(async function () {
  const $ = (s, el = document) => el.querySelector(s);
  const msg = (t, ok = true) => {
    $("#msg").className = "msg " + (ok ? "ok" : "err");
    $("#msg").textContent = t || "";
    if (t) $("#msg").scrollIntoView({ block: "nearest" });
  };
  const etat = await Session.me();
  $("#chargement").hidden = true;
  if (!etat) return ($("#indispo").hidden = false);
  if (!etat.connecte) return ($("#anonyme").hidden = false);

  const form = $("#form");
  form.hidden = false;
  $("#date").min = new Date().toISOString().slice(0, 10);

  // ----- Formats (au moins un) -----
  const liste = $("#formats");
  function numeroter() {
    const fs = [...liste.children];
    fs.forEach((f, i) => {
      $(".titre", f).textContent = fs.length > 1 ? `Format ${i + 1}` : "Format";
      $(".retirer", f).hidden = fs.length === 1;
    });
  }
  function ajouterFormat() {
    const f = $("#tpl-format").content.firstElementChild.cloneNode(true);
    $(".retirer", f).onclick = () => {
      f.remove();
      numeroter();
    };
    liste.appendChild(f);
    numeroter();
    return f;
  }
  $("#plus-format").onclick = () => $("input", ajouterFormat()).focus();
  ajouterFormat();

  // ----- Commune : suggestions de la Géoplateforme IGN (même service que la recherche de la carte) -----
  let lieu = null; // { ville, code_postal, lat, lon }
  const ville = $("#ville"), sugg = $("#sugg"), trouvee = $("#trouvee");
  async function communes(q) {
    const urls = [
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&type=municipality&limit=6`,
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&type=municipality&limit=6`,
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const j = await r.json();
        return (j.features || []).map((f) => ({
          ville: f.properties.city || f.properties.name,
          code_postal: f.properties.postcode || "",
          dep: (f.properties.context || "").split(",").slice(0, 2).join(",").trim(),
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
        }));
      } catch (e) {
        /* service suivant */
      }
    }
    return [];
  }
  let minuterie, demande = 0;
  ville.addEventListener("input", () => {
    lieu = null;
    trouvee.hidden = true;
    clearTimeout(minuterie);
    const q = ville.value.trim();
    if (q.length < 3) return (sugg.hidden = true);
    minuterie = setTimeout(async () => {
      const n = ++demande;
      const res = await communes(q);
      if (n !== demande) return;
      sugg.innerHTML = "";
      res.forEach((c) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        const depNom = (c.dep.split(",")[1] || "").trim();
        b.textContent = `${c.ville} (${[c.code_postal, depNom].filter(Boolean).join(", ")})`;
        b.onclick = () => {
          lieu = c;
          ville.value = c.ville;
          sugg.hidden = true;
          trouvee.hidden = false;
          trouvee.textContent = `✓ ${c.ville}, ${c.code_postal} : placée sur la carte.`;
        };
        li.appendChild(b);
        sugg.appendChild(li);
      });
      sugg.hidden = !res.length;
    }, 250);
  });
  ville.addEventListener("keydown", (e) => {
    if (e.key === "Escape") sugg.hidden = true;
    if (e.key === "ArrowDown" && !sugg.hidden) {
      e.preventDefault();
      $("button", sugg)?.focus();
    }
  });

  // ----- Envoi -----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg("");
    const d = Object.fromEntries(new FormData(form));
    delete d.course;
    delete d.distance_km;
    delete d.denivele_pos_m;
    delete d.prix_eur;
    d.nocturne = form.nocturne.checked ? 1 : 0;
    d.date_confirmee = form.date_confirmee.checked ? 1 : 0;
    if (lieu && lieu.ville === ville.value.trim()) Object.assign(d, { code_postal: lieu.code_postal, lat: lieu.lat, lon: lieu.lon });
    d.formats = [...liste.children].map((f) => Object.fromEntries(["course", "distance_km", "denivele_pos_m", "prix_eur"].map((k) => [k, $(`[name=${k}]`, f).value.trim()])));
    const manque = [];
    if (d.nom.trim().length < 3) manque.push("le nom");
    if (!d.date) manque.push("la date");
    if (!d.ville.trim()) manque.push("la commune");
    if (d.formats.some((f) => !(parseFloat(f.distance_km.replace(",", ".")) > 0))) manque.push("la distance de chaque format");
    if (manque.length) return msg("Indiquez " + manque.join(", ") + ".", false);
    const b = $("#envoyer");
    b.disabled = true;
    try {
      const r = await Session.api("courses.php?action=proposer", d);
      form.hidden = true;
      $("#merci").hidden = false;
      $("#merci-txt").textContent = r.message;
      window.scrollTo(0, 0);
    } catch (err) {
      msg(err.status === 401 ? "Votre session a expiré. Reconnectez-vous puis renvoyez la course." : err.message, false);
    } finally {
      b.disabled = false;
    }
  });
  $("#encore").onclick = () => {
    form.reset();
    liste.innerHTML = "";
    ajouterFormat();
    lieu = null;
    trouvee.hidden = true;
    $("#merci").hidden = true;
    form.hidden = false;
    $("#nom").focus();
  };
})();
