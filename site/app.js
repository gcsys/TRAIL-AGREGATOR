/* Trail Agrégateur : carte + sélection de zones + tableau filtrable. */
(async function () {
  const $ = (s) => document.querySelector(s);
  const state = {
    base: [], // courses telles que publiées dans data/races.json
    races: [], // courses affichées (corrections personnelles appliquées)
    byId: new Map(),
    absent: [], // favoris introuvables dans la base actuelle (instantanés)
    view: null, // null | { kind: "list", id } | { kind: "shared", data, resolved }
    selDeps: new Set(),
    selRegs: new Set(),
    shapes: [], // GeoJSON Feature<Polygon> dessinés
    sort: { k: "date", dir: 1 },
    clickLayer: "departements",
  };

  // ---------- Carte ----------
  const map = L.map("map", { zoomSnap: 0.5, preferCanvas: true }).setView([46.6, 2.4], 5.5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const baseStyle = { color: "#2f7d4f", weight: 1, fillOpacity: 0.04 };
  const selStyle = { color: "#e07a1f", weight: 2, fillOpacity: 0.25, fillColor: "#e07a1f" };

  const [depsGeo, regsGeo, data] = await Promise.all([
    fetch("geo/departements.geojson").then((r) => r.json()),
    fetch("geo/regions.geojson").then((r) => r.json()),
    fetch("data/races.json").then((r) => r.json()),
  ]);
  state.base = data.races;
  const baseById = new Map(state.base.map((r) => [r.id, r]));
  // (Re)calcule les courses affichées à partir de la base + corrections locales.
  function rebuild() {
    state.absent = Favoris.reconcile(baseById, state.base);
    const ed = Favoris.edits();
    state.races = state.base.map((r) => Favoris.apply(r, ed[r.id]));
    state.byId = new Map(state.races.map((r) => [r.id, r]));
    state.absent = state.absent.map((r) => Favoris.apply(r, ed[r.id]));
    state.absent.forEach((r) => state.byId.set(r.id, r));
  }
  rebuild();
  $("#meta").textContent = `${data.count.toLocaleString("fr-FR")} courses · màj ${new Date(data.generated_at).toLocaleDateString("fr-FR")}`;

  function adminLayer(geo, set) {
    return L.geoJSON(geo, {
      style: (f) => (set.has(f.properties.code) ? selStyle : baseStyle),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(`${f.properties.nom} (${f.properties.code})`, { sticky: true });
        layer.on("click", () => {
          if (drawing) return;
          const c = f.properties.code;
          set.has(c) ? set.delete(c) : set.add(c);
          layer.setStyle(set.has(c) ? selStyle : baseStyle);
          refresh();
        });
      },
    });
  }
  const layers = {
    departements: adminLayer(depsGeo, state.selDeps),
    regions: adminLayer(regsGeo, state.selRegs),
  };
  layers.departements.addTo(map);

  document.querySelectorAll("[data-layer]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-layer]").forEach((x) => x.classList.toggle("active", x === b));
      Object.values(layers).forEach((l) => map.removeLayer(l));
      state.clickLayer = b.dataset.layer;
      if (layers[b.dataset.layer]) layers[b.dataset.layer].addTo(map).bringToBack();
    })
  );

  // ---------- Dessin ----------
  const drawn = new L.FeatureGroup().addTo(map);
  let drawing = false;
  function addShape(feature, layer) {
    state.shapes.push(feature);
    layer.setStyle && layer.setStyle(selStyle);
    layer.on("click", () => {
      if (drawing) return;
      drawn.removeLayer(layer);
      state.shapes = state.shapes.filter((s) => s !== feature);
      refresh();
    });
    layer.bindTooltip("Cliquer pour supprimer ce périmètre");
    drawn.addLayer(layer);
    refresh();
  }

  map.on(L.Draw.Event.CREATED, (e) => {
    drawing = false;
    let feature;
    if (e.layerType === "circle") {
      const c = e.layer.getLatLng();
      feature = turf.circle([c.lng, c.lat], e.layer.getRadius() / 1000, { steps: 64, units: "kilometers" });
    } else {
      feature = e.layer.toGeoJSON();
    }
    addShape(feature, e.layer);
  });
  map.on(L.Draw.Event.DRAWSTOP, () => {
    document.body.classList.remove("drawing-active");
    document.querySelectorAll(".seg .drawing").forEach((b) => b.classList.remove("drawing"));
    setTimeout(() => (drawing = false), 50);
  });

  // Géolocalisation
  $("#locate").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => map.setView([p.coords.latitude, p.coords.longitude], 9),
      () => alert("Position indisponible."),
      { timeout: 8000 }
    );
  });

  const drawers = {
    "#draw-poly": () => new L.Draw.Polygon(map, { shapeOptions: selStyle, allowIntersection: false }),
    "#draw-rect": () => new L.Draw.Rectangle(map, { shapeOptions: selStyle }),
    "#draw-circle": () => new L.Draw.Circle(map, { shapeOptions: selStyle }),
  };
  Object.entries(drawers).forEach(([sel, make]) =>
    $(sel).addEventListener("click", () => {
      drawing = true;
      $(sel).classList.add("drawing");
      document.body.classList.add("drawing-active");
      make().enable();
    })
  );

  // Main levée : maintenir le bouton et tracer
  $("#draw-free").addEventListener("click", () => {
    drawing = true;
    document.body.classList.add("freehand-active");
    map.dragging.disable();
    let pts = [];
    let line = null;
    const container = map.getContainer();
    const toLatLng = (ev) => {
      const t = ev.touches ? ev.touches[0] : ev;
      return map.mouseEventToLatLng(t);
    };
    const down = (ev) => {
      ev.preventDefault();
      pts = [toLatLng(ev)];
      line = L.polyline(pts, selStyle).addTo(map);
      container.addEventListener("mousemove", move);
      container.addEventListener("touchmove", move, { passive: false });
    };
    const move = (ev) => {
      ev.preventDefault();
      pts.push(toLatLng(ev));
      line.setLatLngs(pts);
    };
    const up = () => {
      container.removeEventListener("mousedown", down);
      container.removeEventListener("touchstart", down);
      container.removeEventListener("mousemove", move);
      container.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
      map.dragging.enable();
      document.body.classList.remove("freehand-active");
      if (line) map.removeLayer(line);
      setTimeout(() => (drawing = false), 50);
      if (pts.length < 3) return;
      const ring = pts.map((p) => [p.lng, p.lat]);
      ring.push(ring[0]);
      let feature = turf.simplify(turf.polygon([ring]), { tolerance: 0.005, highQuality: false });
      const layer = L.geoJSON(feature, { style: selStyle }).getLayers()[0];
      addShape(feature, layer);
    };
    container.addEventListener("mousedown", down);
    container.addEventListener("touchstart", down, { passive: false });
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
  });

  $("#clear-sel").addEventListener("click", () => {
    state.selDeps.clear();
    state.selRegs.clear();
    state.shapes = [];
    drawn.clearLayers();
    Object.values(layers).forEach((l) => l.setStyle(baseStyle));
    refresh();
  });

  // ---------- Marqueurs ----------
  const markers = L.layerGroup().addTo(map);
  const markerById = new Map();
  const css = getComputedStyle(document.documentElement);
  const distColor = (km) => {
    const v = km == null ? 0 : km;
    return css.getPropertyValue(v < 20 ? "--d1" : v < 42 ? "--d2" : v < 80 ? "--d3" : "--d4").trim();
  };
  const distVar = (km) => (km == null ? "--d1" : km < 20 ? "--d1" : km < 42 ? "--d2" : km < 80 ? "--d3" : "--d4");

  // ---------- Filtres ----------
  const num = (id) => {
    const v = $(id).value;
    return v === "" ? null : Number(v);
  };
  const filterIds = ["#f-q", "#f-from", "#f-to", "#f-km-min", "#f-km-max", "#f-d-min", "#f-d-max", "#f-ke-min", "#f-ke-max", "#f-utmb", "#f-ws", "#f-itra", "#f-type", "#f-night", "#f-dplus"];
  let qTimer;
  filterIds.forEach((id) =>
    $(id).addEventListener("input", () => {
      if (id === "#f-q") {
        clearTimeout(qTimer);
        qTimer = setTimeout(refresh, 150);
      } else refresh();
    })
  );
  const resetFilters = () => {
    filterIds.forEach((id) => ($(id).type === "checkbox" ? ($(id).checked = false) : ($(id).value = "")));
    refresh();
  };
  $("#reset-filters").addEventListener("click", resetFilters);

  // Puces rapides : elles écrivent dans les champs du panneau (source unique de vérité).
  const iso = (d) => d.toISOString().slice(0, 10);
  document.querySelectorAll(".chip:not(.dispo)").forEach((c) =>
    c.addEventListener("click", () => {
      const on = c.classList.contains("active");
      if (c.dataset.km) {
        const [a, b] = c.dataset.km.split("-");
        $("#f-km-min").value = on ? "" : a === "0" ? "" : a;
        $("#f-km-max").value = on ? "" : b || "";
      } else if (c.dataset.when) {
        const now = new Date();
        $("#f-from").value = on ? "" : iso(now);
        $("#f-to").value = on ? "" : iso(new Date(now.getTime() + c.dataset.when * 864e5));
      } else if (c.dataset.type) {
        $("#f-type").value = on ? "" : c.dataset.type;
      } else if ("night" in c.dataset) {
        $("#f-night").checked = !on;
      }
      refresh();
    })
  );
  function syncChips() {
    const kmMin = $("#f-km-min").value, kmMax = $("#f-km-max").value;
    document.querySelectorAll(".chip:not(.dispo)").forEach((c) => {
      let on = false;
      if (c.dataset.km) {
        const [a, b] = c.dataset.km.split("-");
        on = kmMin === (a === "0" ? "" : a) && kmMax === (b || "") && (kmMin || kmMax) !== "";
      } else if (c.dataset.when) {
        const now = new Date();
        on = $("#f-from").value === iso(now) && $("#f-to").value === iso(new Date(now.getTime() + c.dataset.when * 864e5));
      } else if (c.dataset.type) on = $("#f-type").value === c.dataset.type;
      else if ("night" in c.dataset) on = $("#f-night").checked;
      c.classList.toggle("active", on);
    });
    const n = filterIds.filter((id) => id !== "#f-q" && ($(id).type === "checkbox" ? $(id).checked : $(id).value !== "")).length;
    $("#filter-badge").textContent = n;
    $("#filter-badge").hidden = !n;
  }

  // Panneau « Filtres » (feuille en bas d'écran sur mobile)
  const mobile = window.matchMedia("(max-width: 700px)");
  const setMore = (open) => {
    $("#more-filters").hidden = !open;
    $("#toggle-more").setAttribute("aria-expanded", open);
    document.body.classList.toggle("sheet-open", open && mobile.matches);
  };
  $("#toggle-more").addEventListener("click", () => setMore($("#more-filters").hidden));
  $("#close-more").addEventListener("click", () => {
    setMore(false);
    $(".results").scrollIntoView({ behavior: "smooth" });
  });
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("sheet-open") && e.target === document.body) setMore(false);
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && setMore(false));
  mobile.addEventListener("change", () => setMore(false));

  function inZone(r) {
    const any = state.selDeps.size || state.selRegs.size || state.shapes.length;
    if (!any) return true;
    if (r.departement_code && state.selDeps.has(r.departement_code)) return true;
    if (r.region_code && state.selRegs.has(r.region_code)) return true;
    if (r.lat == null) return false;
    const pt = turf.point([r.lon, r.lat]);
    return state.shapes.some((s) => turf.booleanPointInPolygon(pt, s));
  }

  const between = (v, min, max) => (min == null || (v != null && v >= min)) && (max == null || (v != null && v <= max));

  function passes(r) {
    const q = $("#f-q").value.trim().toLowerCase();
    if (q && ![r.nom, r.course, r.ville, r.organisateur, r.departement].join(" ").toLowerCase().includes(q)) return false;
    const from = $("#f-from").value, to = $("#f-to").value;
    if (from && (!r.date || dateEnd(r.date) < from)) return false;
    if (to && (!r.date || dateStart(r.date) > to)) return false;
    if (!between(r.distance_km, num("#f-km-min"), num("#f-km-max"))) return false;
    if (!between(r.denivele_pos_m, num("#f-d-min"), num("#f-d-max"))) return false;
    if (!between(r.km_effort, num("#f-ke-min"), num("#f-ke-max"))) return false;
    const u = $("#f-utmb").value;
    if (u === "any" && !r.utmb_index) return false;
    if (u === "none" && r.utmb_index) return false;
    if (u && !["any", "none"].includes(u) && r.utmb_index !== u) return false;
    const ws = $("#f-ws").value;
    if (ws === "yes" && !r.utmb_world_series) return false;
    if (ws === "no" && r.utmb_world_series) return false;
    const itra = num("#f-itra");
    if (itra != null && (r.itra_points_estimes ?? -1) < itra) return false;
    if ($("#f-type").value && r.type !== $("#f-type").value) return false;
    if ($("#f-night").checked && !r.nocturne) return false;
    if ($("#f-dplus").checked && r.denivele_pos_m == null) return false;
    if (Dispo.hiding() && Dispo.status(r) === "busy") return false;
    return true;
  }

  // ---------- Formatage ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
  const toDate = (d) => new Date((d.length === 7 ? d + "-01" : d) + "T00:00");
  const fmtDate = (r) => {
    if (!r.date) return "—";
    if (r.date.length === 7) return toDate(r.date).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) + " ~";
    return (r.date_confirmee ? "" : "~") + toDate(r.date).toLocaleDateString("fr-FR");
  };
  const dateStart = (d) => (d.length === 7 ? d + "-01" : d);
  const dateEnd = (d) => (d.length === 7 ? d + "-31" : d);
  const fmtNum = (v) => (v == null ? "—" : Number(v).toLocaleString("fr-FR"));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // Pastille disponibilités (bêta) : rien quand l'indicateur est coupé.
  const dispoDot = (r) => {
    const st = Dispo.status(r);
    return st ? `<i class="dispo-dot ${st}" title="${Dispo.label[st]}" role="img" aria-label="${Dispo.label[st]}"></i>` : "";
  };

  function dateCell(r) {
    return dispoDot(r) + dateCellInner(r);
  }
  function dateCellInner(r) {
    if (!r.date) return `<span class="dim">Date inconnue</span>`;
    const d = toDate(r.date);
    if (r.date.length === 7)
      return `<span class="d-day">${cap(d.toLocaleDateString("fr-FR", { month: "short" }))} ${d.getFullYear()}</span><span class="d-sub">date à préciser</span>`;
    return `<span class="d-day">${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span><span class="d-sub">${d.getFullYear()}${r.date_confirmee ? "" : " · à confirmer"}</span>`;
  }
  function calBox(r) {
    const dot = dispoDot(r);
    return dot ? calBoxInner(r).replace(/<\/div>$/, dot + "</div>") : calBoxInner(r);
  }
  function calBoxInner(r) {
    if (!r.date) return `<div class="cal approx"><span class="m">?</span><span class="d">—</span><span class="y">&nbsp;</span></div>`;
    const d = toDate(r.date);
    const m = d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
    if (r.date.length === 7) return `<div class="cal approx" title="Date à préciser"><span class="m">${m}</span><span class="d">~</span><span class="y">${d.getFullYear()}</span></div>`;
    return `<div class="cal"><span class="m">${m}</span><span class="d">${d.getDate()}${r.date_confirmee ? "" : "<small>~</small>"}</span><span class="y">${d.getFullYear()}</span></div>`;
  }
  const linksHtml = (r) =>
    [
      safeUrl(r.site_web) && `<a href="${esc(r.site_web)}" target="_blank" rel="noopener">Site</a>`,
      safeUrl(r.lien_inscription) && `<a href="${esc(r.lien_inscription)}" target="_blank" rel="noopener">S'inscrire</a>`,
      safeUrl(r.source_url) && `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">Source</a>`,
    ].filter(Boolean).join("");
  const labelsHtml = (r) =>
    [
      r.utmb_index && `<span class="tag" title="Catégorie UTMB Index estimée">${esc(r.utmb_index)}</span>`,
      r.utmb_world_series && `<span class="tag ws">World Series</span>`,
      r.itra_points_estimes != null && `<span class="tag muted" title="Points ITRA estimés">ITRA ${r.itra_points_estimes}</span>`,
      r.type === "ultra" && `<span class="tag">Ultra</span>`,
      r.type === "kv" && `<span class="tag">KV</span>`,
      r.nocturne && `<span class="tag night">🌙 Nocturne</span>`,
    ].filter(Boolean).join(" ");
  // « 28 km » n'apporte rien à côté de la pastille distance : on ne garde que les intitulés parlants.
  const courseLabel = (r) => (/^\s*[\d.,]+\s*km\s*$/i.test(r.course || "") ? "" : r.course || "");
  const place = (r) => [r.ville, r.departement_code && `(${r.departement_code})`].filter(Boolean).join(" ");

  // ---------- Favoris : boutons ----------
  const favBtn = (r) => {
    const on = Favoris.isFav(r.id);
    return `<button type="button" class="fav-btn${on ? " on" : ""}" data-act="fav" data-rid="${esc(r.id)}" aria-pressed="${on}" title="${on ? "Dans mes listes" : "Ajouter à mes listes"}" aria-label="${on ? "Dans mes listes" : "Ajouter à mes listes"}">${on ? "★" : "☆"}</button>`;
  };
  const editBtn = (r) => `<button type="button" class="edit-btn" data-act="edit" data-rid="${esc(r.id)}" title="Compléter : D+, date, km, inscription">✎ Compléter</button>`;
  const editedTag = (r) =>
    (r._edited ? ` <span class="tag mine" title="Données corrigées par vous">✎ modifié</span>` : "") +
    (r._shared ? ` <span class="tag mine" title="Corrigé par l'auteur de la liste">✎ corrigé</span>` : "") +
    (r._absent ? ` <span class="tag muted" title="Cette course n'est plus dans la base : affichage de la dernière version connue">hors base</span>` : "");
  const notesHtml = (r) => (r.notes_perso ? `<div class="r-notes">📝 ${esc(r.notes_perso)}</div>` : "");

  const rowHtml = (r) => `<tr data-id="${esc(r.id)}"${r._absent ? ' class="absent"' : ""}>
      <td class="date">${dateCell(r)}</td>
      <td><div class="r-name-row">${favBtn(r)}<div><div class="r-name">${esc(r.nom)}${editedTag(r)}</div><div class="r-sub">${[courseLabel(r), r.organisateur].filter(Boolean).map(esc).join(" · ")}</div>${notesHtml(r)}</div></div></td>
      <td class="place">${esc(place(r))}<div class="r-sub">${esc(r.region || "")}</div></td>
      <td class="num"><span class="dist" style="--dc:var(${distVar(r.distance_km)})">${fmtNum(r.distance_km)}</span></td>
      <td class="num">${r.denivele_pos_m == null ? '<span class="dim">?</span>' : fmtNum(r.denivele_pos_m) + " m"}</td>
      <td class="num">${r.km_effort == null ? '<span class="dim">—</span>' : fmtNum(r.km_effort)}</td>
      <td>${labelsHtml(r) || '<span class="dim">—</span>'}</td>
      <td class="links">${linksHtml(r)}${editBtn(r)}</td>
    </tr>`;

  const popupHtml = (r) => {
    const links = linksHtml(r);
    return `<div class="pop-title">${favBtn(r)}<span>${esc(r.nom)}${editedTag(r)}</span></div>
      <div class="pop-sub">${dispoDot(r)}${[courseLabel(r), fmtDate(r)].filter(Boolean).map(esc).join(" · ")}<br>${esc(place(r))}</div>
      <div class="pop-stats"><span class="stat">${fmtNum(r.distance_km)}<small>km</small></span><span class="stat${r.denivele_pos_m == null ? " unknown" : ""}">${r.denivele_pos_m == null ? "D+ ?" : fmtNum(r.denivele_pos_m) + "<small>m D+</small>"}</span>${labelsHtml(r)}</div>
      <div class="pop-links">${links}${editBtn(r)}</div>`;
  };

  const cardHtml = (r) => {
    const links = linksHtml(r);
    const labels = labelsHtml(r);
    return `<li class="card${r._absent ? " absent" : ""}" data-id="${esc(r.id)}">
      ${calBox(r)}
      <div class="card-body">
        <div class="card-top"><div class="r-name">${esc(r.nom)}${editedTag(r)}</div>${favBtn(r)}</div>
        <div class="where">${[courseLabel(r), place(r)].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="stats">
          <span class="stat"><span class="dist" style="--dc:var(${distVar(r.distance_km)})">${fmtNum(r.distance_km)}</span><small>km</small></span>
          ${r.denivele_pos_m == null ? '<span class="stat unknown">D+ ?</span>' : `<span class="stat">${fmtNum(r.denivele_pos_m)}<small>m D+</small></span>`}
          ${r.km_effort == null ? "" : `<span class="stat">${fmtNum(r.km_effort)}<small>km-e</small></span>`}
          ${labels}
        </div>
        ${notesHtml(r)}
        <div class="links">${links}${editBtn(r)}</div>
      </div>
    </li>`;
  };

  // ---------- Tri ----------
  const syncSortUi = () => {
    const { k, dir } = state.sort;
    document.querySelectorAll("th[data-k]").forEach((th) => {
      th.classList.toggle("sorted-asc", th.dataset.k === k && dir === 1);
      th.classList.toggle("sorted-desc", th.dataset.k === k && dir === -1);
    });
    const v = `${k}:${dir}`;
    const sel = $("#sort-select");
    if (![...sel.options].some((o) => o.value === v)) {
      const o = new Option(`${document.querySelector(`th[data-k="${k}"]`)?.textContent || k} ${dir === 1 ? "↑" : "↓"}`, v);
      o.dataset.extra = "1";
      sel.querySelectorAll("[data-extra]").forEach((x) => x.remove());
      sel.add(o);
    }
    sel.value = v;
  };
  document.querySelectorAll("th[data-k]").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      state.sort = { k, dir: state.sort.k === k ? -state.sort.dir : 1 };
      refresh();
    })
  );
  $("#sort-select").addEventListener("change", (e) => {
    const [k, dir] = e.target.value.split(":");
    state.sort = { k, dir: Number(dir) };
    refresh();
  });

  // ---------- Rendu ----------
  const PAGE = 60;
  let current = [];
  let shown = 0;

  function renderMore(n = PAGE) {
    const slice = current.slice(shown, shown + n);
    $("#races tbody").insertAdjacentHTML("beforeend", slice.map(rowHtml).join(""));
    $("#cards").insertAdjacentHTML("beforeend", slice.map(cardHtml).join(""));
    shown += slice.length;
    const left = current.length - shown;
    $("#more").hidden = left <= 0;
    $("#more").textContent = `Afficher plus (${left.toLocaleString("fr-FR")} restantes)`;
  }
  $("#more").addEventListener("click", () => renderMore());

  // Courses de la liste affichée (liste perso ou liste partagée), filtres et zone ignorés.
  function viewRows() {
    const v = state.view;
    if (v.kind === "list") {
      const l = Favoris.get(v.id);
      return l ? l.ids.map((id) => state.byId.get(id)).filter(Boolean) : [];
    }
    const ed = Favoris.edits();
    return v.resolved
      .filter((x) => x.to)
      .map(({ from, to }) => {
        const r = state.byId.get(to);
        const se = v.data.edits[from];
        // Les corrections de l'auteur de la liste s'affichent si vous n'avez pas les vôtres.
        if (ed[to] || !se || !Object.keys(se).length) return r;
        return { ...Favoris.apply(r, se), _edited: false, _shared: true };
      });
  }

  function refresh(opts = {}) {
    const keep = opts.keep ? Math.max(shown, PAGE) : PAGE;
    const rows = state.view ? viewRows() : state.races.filter((r) => inZone(r) && passes(r));
    const { k, dir } = state.sort;
    rows.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "fr") : x - y) * dir;
    });
    current = rows;
    syncSortUi();
    syncChips();
    $("#count").textContent = rows.length.toLocaleString("fr-FR");
    $("#count-label").textContent = rows.length > 1 ? "courses" : "course";
    $(".count-inline").textContent = rows.length.toLocaleString("fr-FR");
    $("#empty").hidden = rows.length > 0;
    $("#empty").textContent = state.view
      ? "Cette liste est vide. Touchez l'étoile ☆ d'une course pour l'y ajouter."
      : "Aucune course ne correspond. Essayez d'élargir la zone ou les filtres.";
    $("#races tbody").innerHTML = "";
    $("#cards").innerHTML = "";
    shown = 0;
    renderMore(keep);
    renderBanner(rows);
    document.body.classList.toggle("list-view", !!state.view);

    markers.clearLayers();
    markerById.clear();
    rows.forEach((r) => {
      if (r.lat == null) return;
      const m = L.circleMarker([r.lat, r.lon], { radius: 6, color: "#fff", weight: 1.5, fillColor: distColor(r.distance_km), fillOpacity: 0.95 });
      m.bindPopup(() => popupHtml(r), { autoPanPaddingTopLeft: L.point(12, 110), maxWidth: 280 });
      markers.addLayer(m);
      markerById.set(r.id, m);
    });

    const parts = [];
    if (state.selRegs.size) parts.push(`${state.selRegs.size} région${state.selRegs.size > 1 ? "s" : ""}`);
    if (state.selDeps.size) parts.push(`${state.selDeps.size} département${state.selDeps.size > 1 ? "s" : ""}`);
    if (state.shapes.length) parts.push(`${state.shapes.length} zone${state.shapes.length > 1 ? "s" : ""} dessinée${state.shapes.length > 1 ? "s" : ""}`);
    $(".map-status").classList.toggle("has-sel", parts.length > 0);
    $("#clear-sel").hidden = !parts.length;
    $("#selection-summary").textContent = parts.length
      ? `Zone : ${parts.join(" + ")}`
      : "Touchez un département ou dessinez une zone pour filtrer.";
  }

  // Clic sur une course : centrer la carte dessus
  const focusRace = (e) => {
    const el = e.target.closest("[data-id]");
    if (!el || e.target.closest("a, button")) return;
    const m = markerById.get(el.dataset.id);
    if (m) {
      $(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 10));
      m.openPopup();
    }
  };
  $("#races tbody").addEventListener("click", focusRace);
  $("#cards").addEventListener("click", focusRace);

  // Bouton « retour à la carte »
  const io = new IntersectionObserver(([e]) => ($("#to-top").hidden = e.isIntersecting), { threshold: 0 });
  io.observe($("#map"));
  $("#to-top").addEventListener("click", () => $(".map-card").scrollIntoView({ behavior: "smooth" }));

  // ---------- Disponibilités (bêta) ----------
  function syncDispoUi() {
    const on = Dispo.active();
    $("#dispo-toggle").classList.toggle("active", on);
    $("#dispo-toggle").setAttribute("aria-pressed", on);
    document.body.classList.toggle("dispo-on", on);
  }
  const fmtWe = (iso) => {
    const d = new Date(iso + "T00:00");
    const e = new Date(d.getTime() + 864e5);
    return `${d.getDate()}${d.getMonth() === e.getMonth() ? "" : " " + d.toLocaleDateString("fr-FR", { month: "short" })}-${e.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  };
  function dispoPreview() {
    const ref = $("#dispo-ref").value, every = Number($("#dispo-every").value);
    if (!ref) return ($("#dispo-preview").textContent = "Choisissez une date pour voir les prochains week-ends concernés.");
    const keep = Dispo.config();
    Dispo.set({ ref, every });
    const nx = Dispo.next(4);
    Dispo.set({ ref: keep.ref, every: keep.every });
    $("#dispo-preview").textContent = "Prochains week-ends indisponibles : " + nx.map(fmtWe).join(", ") + ", etc.";
  }
  function openDispo() {
    const c = Dispo.config();
    $("#dispo-ref").value = c.ref || "";
    $("#dispo-every").value = String(c.every || 2);
    $("#dispo-hide").checked = !!c.hide;
    dispoPreview();
    $("#dlg-dispo").returnValue = "";
    openDlg("#dlg-dispo");
  }
  ["#dispo-ref", "#dispo-every"].forEach((id) => $(id).addEventListener("input", dispoPreview));
  $("#dlg-dispo").addEventListener("close", () => {
    if ($("#dlg-dispo").returnValue !== "save" || !$("#dispo-ref").value) return;
    Dispo.set({ ref: $("#dispo-ref").value, every: $("#dispo-every").value, hide: $("#dispo-hide").checked, on: true });
    syncDispoUi();
    refresh({ keep: true });
    toast("Indicateur de disponibilité activé");
  });
  $("#dispo-toggle").addEventListener("click", () => {
    if (!Dispo.ready()) return openDispo(); // premier usage : on règle d'abord
    Dispo.set({ on: !Dispo.config().on });
    syncDispoUi();
    refresh({ keep: true });
  });
  $("#dispo-settings").addEventListener("click", openDispo);
  syncDispoUi();

  // ---------- Export ----------
  $("#export").addEventListener("click", () => {
    const cols = ["date", "nom", "course", "ville", "code_postal", "departement", "region", "distance_km", "denivele_pos_m", "km_effort", "utmb_index", "utmb_world_series", "itra_points_estimes", "type", "nocturne", "organisateur", "site_web", "lien_inscription"];
    const csv = [cols.join(";")]
      .concat(current.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(";")))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "trails.csv";
    a.click();
  });

  // ---------- Favoris : listes, corrections, partage ----------
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 2600);
  };
  const plural = (n, w) => `${n.toLocaleString("fr-FR")} ${w}${n > 1 ? "s" : ""}`;
  const openDlg = (id) => {
    const d = $(id);
    if (!d.open) d.showModal();
  };

  function syncFavUi() {
    const n = Favoris.lists().length;
    $("#lists-badge").textContent = n;
    $("#lists-badge").hidden = !n;
    // Étoiles déjà affichées (tableau, cartes, popup ouverte)
    document.querySelectorAll('[data-act="fav"]').forEach((b) => {
      const on = Favoris.isFav(b.dataset.rid);
      b.classList.toggle("on", on);
      b.textContent = on ? "★" : "☆";
      b.setAttribute("aria-pressed", on);
      b.title = on ? "Dans mes listes" : "Ajouter à mes listes";
      b.setAttribute("aria-label", b.title);
    });
  }

  function fitTo(rows) {
    const pts = rows.filter((r) => r.lat != null).map((r) => [r.lat, r.lon]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 11 });
  }

  function setView(v) {
    state.view = v;
    refresh();
    if (v) {
      fitTo(current);
      $(".results").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Bandeau au-dessus des résultats quand on consulte une liste
  function renderBanner(rows) {
    const v = state.view;
    $("#list-banner").hidden = !v;
    if (!v) return;
    if (v.kind === "list") {
      const l = Favoris.get(v.id);
      if (!l) return setView(null);
      $("#lb-kicker").textContent = "★ Ma liste";
      $("#lb-name").textContent = l.name;
      $("#lb-note").textContent = `${plural(rows.length, "course")} · filtres et zone ignorés`;
      $("#lb-actions").innerHTML = `
        <button class="btn" data-lb="share">Partager</button>
        <button class="btn ghost" data-lb="rename">Renommer</button>
        <button class="btn ghost danger-text" data-lb="delete">Supprimer</button>
        <button class="btn ghost" data-lb="close" aria-label="Revenir à toutes les courses">✕ Toutes les courses</button>`;
    } else {
      const lost = v.resolved.filter((x) => !x.to).length;
      $("#lb-kicker").textContent = "🔗 Liste partagée";
      $("#lb-name").textContent = v.data.name;
      $("#lb-note").textContent = plural(rows.length, "course") + (lost ? ` · ${plural(lost, "course")} introuvable${lost > 1 ? "s" : ""} dans la base` : "");
      $("#lb-actions").innerHTML = `
        <button class="btn primary" data-lb="import">★ Enregistrer dans mes listes</button>
        <button class="btn ghost" data-lb="close">✕ Fermer</button>`;
    }
  }

  $("#lb-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lb]");
    if (!b) return;
    const v = state.view;
    const act = b.dataset.lb;
    if (act === "close") {
      if (v?.kind === "shared") clearHash();
      setView(null);
    } else if (act === "share") shareList(v.id);
    else if (act === "rename") renameList(v.id);
    else if (act === "delete") deleteList(v.id);
    else if (act === "import") {
      const l = Favoris.importShared(v.data, v.resolved, state.byId);
      clearHash();
      rebuild();
      syncFavUi();
      setView({ kind: "list", id: l.id });
      toast(`Liste « ${l.name} » enregistrée`);
    }
  });

  function renameList(id) {
    const l = Favoris.get(id);
    const name = prompt("Nouveau nom de la liste :", l.name);
    if (!name || !name.trim()) return;
    Favoris.rename(id, name);
    refresh({ keep: true });
    renderListsDlg();
  }
  function deleteList(id) {
    const l = Favoris.get(id);
    if (!confirm(`Supprimer la liste « ${l.name} » (${plural(l.ids.length, "course")}) ?`)) return;
    Favoris.remove(id);
    if (state.view?.id === id) state.view = null;
    syncFavUi();
    refresh({ keep: true });
    renderListsDlg();
  }

  // ----- Dialogue « Ajouter à mes listes » -----
  let favRace = null;
  function renderFavDlg() {
    const r = favRace;
    $("#fav-title").textContent = r.nom;
    $("#fav-sub").textContent = [courseLabel(r) || (r.distance_km != null ? fmtNum(r.distance_km) + " km" : ""), fmtDate(r), place(r)].filter(Boolean).join(" · ");
    $("#fav-lists").innerHTML = Favoris.lists()
      .map(
        (l) => `<li><label><input type="checkbox" data-lid="${esc(l.id)}"${Favoris.has(l.id, r.id) ? " checked" : ""}>
          <span>${esc(l.name)}</span><small>${plural(l.ids.length, "course")}</small></label></li>`
      )
      .join("");
  }
  function openFav(id) {
    favRace = state.byId.get(id);
    if (!favRace) return;
    // Première utilisation : une liste « Favoris » prête à cocher.
    if (!Favoris.lists().length) {
      const l = Favoris.create("Favoris");
      Favoris.toggle(l.id, favRace);
      syncFavUi();
    }
    renderFavDlg();
    openDlg("#dlg-fav");
  }
  $("#fav-lists").addEventListener("change", (e) => {
    const lid = e.target.dataset.lid;
    if (!lid) return;
    Favoris.toggle(lid, favRace);
    renderFavDlg();
    syncFavUi();
  });
  const createFrom = (input, after) => {
    const name = $(input).value.trim();
    if (!name) return $(input).focus();
    const l = Favoris.create(name);
    $(input).value = "";
    after(l);
    syncFavUi();
  };
  $("#fav-new-btn").addEventListener("click", () =>
    createFrom("#fav-new", (l) => {
      Favoris.toggle(l.id, favRace);
      renderFavDlg();
    })
  );
  $("#fav-new").addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), $("#fav-new-btn").click()));
  $("#fav-edit").addEventListener("click", () => {
    $("#dlg-fav").close();
    openEdit(favRace.id);
  });
  $("#dlg-fav").addEventListener("close", () => {
    if (state.view?.kind === "list") refresh({ keep: true });
  });

  // ----- Dialogue « Mes listes » -----
  function renderListsDlg() {
    const ls = Favoris.lists();
    $("#lists-empty").hidden = ls.length > 0;
    $("#lists-list").innerHTML = ls
      .map((l) => {
        const rs = l.ids.map((id) => state.byId.get(id)).filter(Boolean);
        const dates = rs.map((r) => r.date).filter(Boolean).sort();
        const next = dates.find((d) => dateEnd(d) >= iso(new Date()));
        const nextRace = next && rs.find((r) => r.date === next);
        return `<li data-lid="${esc(l.id)}">
          <button type="button" class="ll-open" data-ll="open">
            <span class="ll-name">${esc(l.name)}</span>
            <span class="ll-meta">${plural(l.ids.length, "course")}${nextRace ? ` · prochaine : ${esc(nextRace.nom)} (${esc(fmtDate(nextRace))})` : ""}</span>
          </button>
          <span class="ll-actions">
            <button type="button" class="icon-btn" data-ll="share" title="Partager" aria-label="Partager">🔗</button>
            <button type="button" class="icon-btn" data-ll="rename" title="Renommer" aria-label="Renommer">✎</button>
            <button type="button" class="icon-btn" data-ll="delete" title="Supprimer" aria-label="Supprimer">🗑</button>
          </span>
        </li>`;
      })
      .join("");
  }
  $("#open-lists").addEventListener("click", () => {
    renderListsDlg();
    openDlg("#dlg-lists");
  });
  $("#lists-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ll]");
    if (!b) return;
    const id = b.closest("[data-lid]").dataset.lid;
    const act = b.dataset.ll;
    if (act === "open") {
      $("#dlg-lists").close();
      setView({ kind: "list", id });
    } else if (act === "share") shareList(id);
    else if (act === "rename") renameList(id);
    else if (act === "delete") deleteList(id);
  });
  $("#lists-new-btn").addEventListener("click", () => createFrom("#lists-new", renderListsDlg));
  $("#lists-new").addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), $("#lists-new-btn").click()));

  // ----- Partage -----
  async function shareList(id) {
    const l = Favoris.get(id);
    const url = `${location.origin}${location.pathname}#liste=${await Favoris.encode(l, state.byId)}`;
    $("#share-title").textContent = `${l.name} · ${plural(l.ids.length, "course")}`;
    $("#share-url").value = url;
    $("#share-status").textContent = "";
    $("#share-copy").textContent = navigator.share && mobile.matches ? "Partager" : "Copier";
    openDlg("#dlg-share");
    $("#share-url").select();
  }
  $("#share-copy").addEventListener("click", async () => {
    const url = $("#share-url").value;
    if (navigator.share && mobile.matches) {
      try {
        await navigator.share({ title: `Trails : ${$("#share-title").textContent}`, url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      $("#share-status").textContent = "Lien copié dans le presse-papiers.";
    } catch (e) {
      $("#share-url").select();
      document.execCommand("copy");
      $("#share-status").textContent = "Lien copié.";
    }
  });

  function clearHash() {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  async function openSharedFromHash() {
    const m = location.hash.match(/^#liste=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    try {
      const data = await Favoris.decode(m[1]);
      const resolved = Favoris.resolveShared(data, state.byId, state.races);
      setView({ kind: "shared", data, resolved });
      return true;
    } catch (e) {
      console.warn(e);
      toast("Lien de liste illisible ou incomplet.");
      clearHash();
      return false;
    }
  }
  window.addEventListener("hashchange", openSharedFromHash);

  // ----- Dialogue « Compléter la course » -----
  let editId = null;
  const showOrig = (sel, label, v) => ($(sel).textContent = v == null || v === "" ? "" : `Base : ${label(v)}`);
  function openEdit(id) {
    const r = state.byId.get(id);
    if (!r) return;
    editId = id;
    const o = r._orig || state.base.find((x) => x.id === id) || r;
    const e = Favoris.editOf(id) || {};
    $("#edit-title").textContent = r.nom;
    $("#edit-sub").textContent = [courseLabel(o), place(o)].filter(Boolean).join(" · ");
    const isoDate = (d) => (d && d.length === 10 ? d : "");
    $("#e-date").value = e.date ?? isoDate(o.date);
    $("#e-confirmee").checked = e.date_confirmee ?? (e.date ? true : !!o.date_confirmee);
    $("#e-km").value = e.distance_km ?? o.distance_km ?? "";
    $("#e-dplus").value = e.denivele_pos_m ?? o.denivele_pos_m ?? "";
    $("#e-inscription").value = e.lien_inscription ?? o.lien_inscription ?? "";
    $("#e-site").value = e.site_web ?? o.site_web ?? "";
    $("#e-notes").value = e.notes_perso ?? "";
    showOrig("#o-date", () => fmtDate(o), o.date);
    showOrig("#o-km", (v) => fmtNum(v) + " km", o.distance_km);
    $("#o-dplus").textContent = o.denivele_pos_m == null ? "Inconnu dans la base" : `Base : ${fmtNum(o.denivele_pos_m)} m`;
    showOrig("#o-inscription", (v) => v, o.lien_inscription);
    showOrig("#o-site", (v) => v, o.site_web);
    $("#edit-reset").hidden = !Favoris.editOf(id);
    $("#dlg-edit").returnValue = "";
    openDlg("#dlg-edit");
  }

  // Ne garde que les champs qui diffèrent de la base.
  function readEdit() {
    const r = state.byId.get(editId);
    const o = r._orig || r;
    const out = {};
    const numOrNull = (v) => (v === "" ? null : Number(v));
    const date = $("#e-date").value;
    if (date && date !== o.date) out.date = date;
    const conf = $("#e-confirmee").checked;
    if (conf !== !!o.date_confirmee || out.date) out.date_confirmee = conf;
    const km = numOrNull($("#e-km").value);
    if (km != null && km !== o.distance_km) out.distance_km = km;
    const d = numOrNull($("#e-dplus").value);
    if (d != null && d !== o.denivele_pos_m) out.denivele_pos_m = Math.round(d);
    const ins = $("#e-inscription").value.trim();
    if (ins && ins !== o.lien_inscription) out.lien_inscription = ins;
    const site = $("#e-site").value.trim();
    if (site && site !== o.site_web) out.site_web = site;
    const notes = $("#e-notes").value.trim();
    if (notes) out.notes_perso = notes;
    return out;
  }

  // Saisir une date précise vaut confirmation (décochable).
  $("#e-date").addEventListener("change", () => $("#e-date").value && ($("#e-confirmee").checked = true));
  $("#dlg-edit").addEventListener("close", () => {
    if ($("#dlg-edit").returnValue !== "save" || !editId) return;
    const patch = readEdit();
    Favoris.setEdit(editId, patch);
    afterEdit(Object.keys(patch).length ? "Course mise à jour" : "Aucune modification");
  });
  $("#edit-reset").addEventListener("click", () => {
    if (!confirm("Supprimer vos corrections et revenir aux données de la base ?")) return;
    Favoris.clearEdit(editId);
    $("#dlg-edit").close("reset");
    afterEdit("Données d'origine rétablies");
  });
  function afterEdit(msg) {
    rebuild();
    const r = state.byId.get(editId);
    if (r) Favoris.refreshSnap(r), Favoris.saveSnapsNow();
    map.closePopup();
    refresh({ keep: true });
    toast(msg);
  }

  // « Proposer à la base » : formulaire d'issue GitHub pré-rempli
  $("#edit-propose").addEventListener("click", () => {
    const r = state.byId.get(editId);
    const o = r._orig || r;
    const v = (sel) => $(sel).value.trim();
    const km = v("#e-km") || o.distance_km || "";
    const dplus = v("#e-dplus") || o.denivele_pos_m || "";
    const p = new URLSearchParams({
      template: "completer-course.yml",
      title: `[Course] ${o.nom}${courseLabel(o) ? " – " + courseLabel(o) : ""} (${o.ville})`,
      nom: o.nom,
      ville: o.ville,
      date: v("#e-date") || (o.date && o.date.length === 10 ? o.date : ""),
      formats: `${km} ; ${dplus}`,
      site: v("#e-inscription") || v("#e-site") || o.site_web || "",
      source: `Correction depuis Trail Agrégateur (id ${o.id}). Source : `,
    });
    window.open(`https://github.com/gcsys/TRAIL-AGREGATOR/issues/new?${p}`, "_blank", "noopener");
  });

  // Délégation : étoiles et boutons « Compléter » (tableau, cartes, popups)
  const onAct = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.act === "fav") openFav(b.dataset.rid);
    else if (b.dataset.act === "edit") openEdit(b.dataset.rid);
  };
  document.addEventListener("click", onAct);
  // Leaflet bloque la propagation des clics hors des popups : on écoute sur la popup elle-même.
  map.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (el && !el.dataset.actBound) {
      el.dataset.actBound = "1";
      el.addEventListener("click", onAct);
    }
  });

  syncFavUi();

  if (!(await openSharedFromHash())) {
    refresh();
    const pts = state.races.filter((r) => r.lat != null).map((r) => [r.lat, r.lon]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 9 });
  }
})();
