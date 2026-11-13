/* Recherche en langage simple : « trail de 20 à 30 km en mai à moins d'1 h de Lyon ».
 * Langage.analyser(texte, aujourdhui) -> { kmMin, kmMax, dMin, dMax, mois: [AAAA-MM], du, au, profils: [],
 * nuit, autour: {lieu, km | minutes}, reste, pastilles: [libellés] }. Seuls les champs reconnus sont
 * présents ; « reste » est le texte non reconnu (recherche par nom ou commune). De simples règles, sans
 * service externe. Aucune dépendance au DOM. */
(function (root) {
  const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
  const MOIS_AFF = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const SAISONS = { printemps: [3, 4, 5], ete: [6, 7, 8], automne: [9, 10, 11], hiver: [12, 1, 2] };
  const PROFILS = { roul: "roulant", plat: "roulant", vall: "vallonne", mont: "montagne" };
  const sansAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const n = (s) => Number(String(s).replace(",", "."));
  const pad = (x) => String(x).padStart(2, "0");
  const iso = (d) => d.toISOString().slice(0, 10);

  /* Prochaine occurrence d'un mois (1-12) à partir d'aujourd'hui (le mois en cours compte). */
  const prochain = (m, auj, an) => {
    const [y, mo] = auj.split("-").map(Number);
    return `${an || (m >= mo ? y : y + 1)}-${pad(m)}`;
  };

  function analyser(texte, aujourdhui = iso(new Date())) {
    let t = " " + sansAccent(texte || "").replace(/[’']/g, "'").replace(/\s+/g, " ") + " ";
    const out = { pastilles: [] };
    const prendre = (re, f) => {
      const m = t.match(re);
      if (!m) return false;
      t = t.replace(m[0], " ");
      f(m);
      return true;
    };
    const km = (a, b) => {
      if (a != null) out.kmMin = a;
      if (b != null) out.kmMax = b;
      out.pastilles.push(a != null && b != null ? `${a}–${b} km` : a != null ? `${a} km et plus` : `jusqu'à ${b} km`);
    };
    const NB = "(\\d+(?:[.,]\\d+)?)";

    // Autour d'un lieu : « à moins d'1 h de Lyon », « à 50 km de Gap », « autour de Millau », « près de Nîmes »
    const LIEU = "([a-z][a-z' -]*?)(?= (?:en|au|aux|le|la|les|pour|avec|cet?|cette|dans|entre|de \\d|moins|plus|sur|du|d'ici)\\b| ?$| \\d)";
    prendre(new RegExp(` (?:a )?(?:moins d'?(?:une? )?|max(?:imum)? )?(\\d+(?:[.,]\\d+)?|une?) ?(h|heures?|min(?:utes)?|km) (?:de route )?(?:de|d'|autour de|depuis) ?${LIEU}`), (m) => {
      const v = m[1].startsWith("u") ? 1 : n(m[1]);
      const lieu = m[3].trim();
      if (m[2] === "km") out.autour = { lieu, km: v };
      else out.autour = { lieu, minutes: m[2].startsWith("h") ? Math.round(v * 60) : Math.round(v) };
      out.pastilles.push(`${out.autour.km ? `${v} km` : out.autour.minutes >= 60 ? `${out.autour.minutes / 60} h de route` : `${out.autour.minutes} min de route`} autour de ${lieu}`);
    }) ||
      prendre(new RegExp(` (?:autour|pres|proche) d(?:e |')${LIEU}`), (m) => {
        out.autour = { lieu: m[1].trim(), km: 30 };
        out.pastilles.push(`30 km autour de ${out.autour.lieu}`);
      });

    // Dénivelé avant les distances (« 1000 m d+ » ne doit pas être lu comme des km)
    prendre(new RegExp(` (?:(moins|plus) de |entre ${NB} et )?${NB} ?m ?(?:de )?(?:d\\+|dplus|denivele(?: positif)?)`), (m) => {
      const v = n(m[3]);
      if (m[2]) (out.dMin = n(m[2])), (out.dMax = v);
      else if (m[1] === "plus") out.dMin = v;
      else out.dMax = v;
      out.pastilles.push(out.dMin != null && out.dMax != null ? `${out.dMin}–${out.dMax} m D+` : out.dMin != null ? `${out.dMin} m D+ et plus` : `jusqu'à ${out.dMax} m D+`);
    });

    // Distance
    prendre(new RegExp(` (?:entre |de )${NB} (?:et|a) ${NB} ?km`), (m) => km(n(m[1]), n(m[2]))) ||
      prendre(new RegExp(` ${NB} ?(?:-|a) ?${NB} ?km`), (m) => km(n(m[1]), n(m[2]))) ||
      prendre(new RegExp(` (?:moins de|max(?:imum)?|jusqu'a) ${NB} ?km`), (m) => km(null, n(m[1]))) ||
      prendre(new RegExp(` (?:plus de|au moins|min(?:imum)?) ${NB} ?km`), (m) => km(n(m[1]), null)) ||
      prendre(new RegExp(` (?:d'environ |environ |vers |autour de )?${NB} ?km`), (m) => {
        const v = n(m[1]);
        km(Math.round(v * 0.85), Math.round(v * 1.15));
      }) ||
      prendre(/ (?:semi[- ]marathon|semi) /, () => km(18, 25)) ||
      prendre(/ marathon /, () => km(38, 46)) ||
      prendre(/ ultras? /, () => km(80, null));

    // Période
    const mois = [];
    prendre(/ (?:ce|le) (?:week-?end|we) /, () => {
      const d = new Date(aujourdhui + "T00:00:00Z");
      const dow = d.getUTCDay();
      const sam = new Date(d.getTime() + ((6 - dow + 7) % 7) * 864e5 - (dow === 0 ? 864e5 : 0));
      out.du = dow === 0 ? aujourdhui : iso(sam);
      out.au = iso(new Date(sam.getTime() + 864e5));
      out.pastilles.push("ce week-end");
    }) ||
      prendre(/ (?:dans les|d'ici|sous) (\d+) (jours|semaines|mois) /, (m) => {
        const k = Number(m[1]) * (m[2] === "jours" ? 1 : m[2] === "semaines" ? 7 : 30.5);
        out.du = aujourdhui;
        out.au = iso(new Date(Date.parse(aujourdhui) + Math.round(k) * 864e5));
        out.pastilles.push(`d'ici ${m[1]} ${m[2]}`);
      }) ||
      prendre(/ (?:le )?mois prochain /, () => {
        const [y, mo] = aujourdhui.split("-").map(Number);
        mois.push(mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`);
        out.pastilles.push("le mois prochain");
      });
    for (const [s, ms] of Object.entries(SAISONS))
      prendre(new RegExp(` (?:(?:au|en|cet|cette|l')\\s?)?${s} (?:(20\\d\\d) )?`), (m) => {
        ms.forEach((x) => mois.push(prochain(x, aujourdhui, m[1] && Number(m[1]))));
        out.pastilles.push(`${s === "ete" ? "été" : s}${m[1] ? " " + m[1] : ""}`);
      });
    let encore = true;
    while (encore)
      encore = prendre(new RegExp(` (?:en |de |d'|et |ou |, ?)?(${MOIS.join("|")}) (?:(20\\d\\d) )?`), (m) => {
        const i = MOIS.indexOf(m[1]) + 1;
        const ym = prochain(i, aujourdhui, m[2] && Number(m[2]));
        mois.push(ym);
        out.pastilles.push(`${MOIS_AFF[i - 1]} ${ym.slice(0, 4)}`);
      });
    if (mois.length) out.mois = [...new Set(mois)].sort();

    // Profil et nuit
    const profils = new Set();
    let p = true;
    while (p) p = prendre(/ (roulante?s?|plate?s?|vallonnee?s?|montagnes?|montagneu(?:x|se)) /, (m) => profils.add(PROFILS[m[1].slice(0, 4)]));
    if (profils.size) {
      out.profils = [...profils];
      out.pastilles.push(out.profils.map((x) => (x === "vallonne" ? "vallonné" : x)).join(", "));
    }
    if (prendre(/ (?:de nuit|nocturnes?|en nocturne) /, () => {})) {
      out.nuit = true;
      out.pastilles.push("de nuit");
    }

    out.reste = t.replace(/ (?:un|une|des|les?|la|trail|trails|course|courses|pour|avec|qui|en|de|d'|du|a|au|et|ou|entre|je|cherche|veux|voudrais|faire)(?= )/g, " ").replace(/\s+/g, " ").trim();
    return out;
  }

  root.Langage = { analyser };
})(typeof window !== "undefined" ? window : globalThis);
