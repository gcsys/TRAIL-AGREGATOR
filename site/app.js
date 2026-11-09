/* Trail Agrégateur : carte + sélection de zones + tableau filtrable. */
(async function () {
  const $ = (s) => document.querySelector(s);
  const state = {
    races: [],
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
  state.races = data.races;
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
  document.querySelectorAll(".chip").forEach((c) =>
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
    document.querySelectorAll(".chip").forEach((c) => {
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

  function dateCell(r) {
    if (!r.date) return `<span class="dim">Date inconnue</span>`;
    const d = toDate(r.date);
    if (r.date.length === 7)
      return `<span class="d-day">${cap(d.toLocaleDateString("fr-FR", { month: "short" }))} ${d.getFullYear()}</span><span class="d-sub">date à préciser</span>`;
    return `<span class="d-day">${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span><span class="d-sub">${d.getFullYear()}${r.date_confirmee ? "" : " · à confirmer"}</span>`;
  }
  function calBox(r) {
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

  const rowHtml = (r) => `<tr data-id="${esc(r.id)}">
      <td class="date">${dateCell(r)}</td>
      <td><div class="r-name">${esc(r.nom)}</div><div class="r-sub">${[courseLabel(r), r.organisateur].filter(Boolean).map(esc).join(" · ")}</div></td>
      <td class="place">${esc(place(r))}<div class="r-sub">${esc(r.region || "")}</div></td>
      <td class="num"><span class="dist" style="--dc:var(${distVar(r.distance_km)})">${fmtNum(r.distance_km)}</span></td>
      <td class="num">${r.denivele_pos_m == null ? '<span class="dim">?</span>' : fmtNum(r.denivele_pos_m) + " m"}</td>
      <td class="num">${r.km_effort == null ? '<span class="dim">—</span>' : fmtNum(r.km_effort)}</td>
      <td>${labelsHtml(r) || '<span class="dim">—</span>'}</td>
      <td class="links">${linksHtml(r) || '<span class="dim">—</span>'}</td>
    </tr>`;

  const popupHtml = (r) => {
    const links = linksHtml(r);
    return `<div class="pop-title">${esc(r.nom)}</div>
      <div class="pop-sub">${[courseLabel(r), fmtDate(r)].filter(Boolean).map(esc).join(" · ")}<br>${esc(place(r))}</div>
      <div class="pop-stats"><span class="stat">${fmtNum(r.distance_km)}<small>km</small></span><span class="stat${r.denivele_pos_m == null ? " unknown" : ""}">${r.denivele_pos_m == null ? "D+ ?" : fmtNum(r.denivele_pos_m) + "<small>m D+</small>"}</span>${labelsHtml(r)}</div>
      ${links ? `<div class="pop-links">${links}</div>` : ""}`;
  };

  const cardHtml = (r) => {
    const links = linksHtml(r);
    const labels = labelsHtml(r);
    return `<li class="card" data-id="${esc(r.id)}">
      ${calBox(r)}
      <div class="card-body">
        <div class="r-name">${esc(r.nom)}</div>
        <div class="where">${[courseLabel(r), place(r)].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="stats">
          <span class="stat"><span class="dist" style="--dc:var(${distVar(r.distance_km)})">${fmtNum(r.distance_km)}</span><small>km</small></span>
          ${r.denivele_pos_m == null ? '<span class="stat unknown">D+ ?</span>' : `<span class="stat">${fmtNum(r.denivele_pos_m)}<small>m D+</small></span>`}
          ${r.km_effort == null ? "" : `<span class="stat">${fmtNum(r.km_effort)}<small>km-e</small></span>`}
          ${labels}
        </div>
        ${links ? `<div class="links">${links}</div>` : ""}
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

  function renderMore() {
    const slice = current.slice(shown, shown + PAGE);
    $("#races tbody").insertAdjacentHTML("beforeend", slice.map(rowHtml).join(""));
    $("#cards").insertAdjacentHTML("beforeend", slice.map(cardHtml).join(""));
    shown += slice.length;
    const left = current.length - shown;
    $("#more").hidden = left <= 0;
    $("#more").textContent = `Afficher plus (${left.toLocaleString("fr-FR")} restantes)`;
  }
  $("#more").addEventListener("click", renderMore);

  function refresh() {
    const rows = state.races.filter((r) => inZone(r) && passes(r));
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
    $("#races tbody").innerHTML = "";
    $("#cards").innerHTML = "";
    shown = 0;
    renderMore();

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
    if (!el || e.target.closest("a")) return;
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

  refresh();
  const pts = state.races.filter((r) => r.lat != null).map((r) => [r.lat, r.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 9 });
})();
