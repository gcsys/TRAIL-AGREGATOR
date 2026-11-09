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
  $("#meta").textContent = `· ${data.count} courses · mise à jour ${new Date(data.generated_at).toLocaleDateString("fr-FR")}`;

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
  map.on(L.Draw.Event.DRAWSTOP, () => setTimeout(() => (drawing = false), 50));

  const drawers = {
    "#draw-poly": () => new L.Draw.Polygon(map, { shapeOptions: selStyle, allowIntersection: false }),
    "#draw-rect": () => new L.Draw.Rectangle(map, { shapeOptions: selStyle }),
    "#draw-circle": () => new L.Draw.Circle(map, { shapeOptions: selStyle }),
  };
  Object.entries(drawers).forEach(([sel, make]) =>
    $(sel).addEventListener("click", () => {
      drawing = true;
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

  // ---------- Filtres ----------
  const num = (id) => {
    const v = $(id).value;
    return v === "" ? null : Number(v);
  };
  const filterIds = ["#f-q", "#f-from", "#f-to", "#f-km-min", "#f-km-max", "#f-d-min", "#f-d-max", "#f-ke-min", "#f-ke-max", "#f-utmb", "#f-ws", "#f-itra", "#f-type", "#f-night"];
  filterIds.forEach((id) => $(id).addEventListener("input", refresh));
  $("#reset-filters").addEventListener("click", () => {
    filterIds.forEach((id) => ($(id).type === "checkbox" ? ($(id).checked = false) : ($(id).value = "")));
    refresh();
  });

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
    return true;
  }

  // ---------- Tableau ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
  const fmtDate = (r) => {
    if (!r.date) return "—";
    if (r.date.length === 7) return new Date(r.date + "-01T00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) + " ~";
    return (r.date_confirmee ? "" : "~") + new Date(r.date + "T00:00").toLocaleDateString("fr-FR");
  };
  const dateStart = (d) => (d.length === 7 ? d + "-01" : d);
  const dateEnd = (d) => (d.length === 7 ? d + "-31" : d);
  const fmtNum = (v) => (v == null ? "—" : Number(v).toLocaleString("fr-FR"));

  document.querySelectorAll("th[data-k]").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      state.sort = { k, dir: state.sort.k === k ? -state.sort.dir : 1 };
      refresh();
    })
  );

  let current = [];
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
    document.querySelectorAll("th[data-k]").forEach((th) => {
      th.classList.toggle("sorted-asc", th.dataset.k === k && dir === 1);
      th.classList.toggle("sorted-desc", th.dataset.k === k && dir === -1);
    });
    $("#count").textContent = rows.length;
    $("#races tbody").innerHTML = rows
      .map((r) => {
        const links = [
          safeUrl(r.site_web) && `<a href="${esc(r.site_web)}" target="_blank" rel="noopener">Site</a>`,
          safeUrl(r.lien_inscription) && `<a href="${esc(r.lien_inscription)}" target="_blank" rel="noopener">Inscription</a>`,
          safeUrl(r.source_url) && `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">Source</a>`,
        ].filter(Boolean).join(" · ");
        return `<tr data-id="${esc(r.id)}">
          <td>${fmtDate(r)}</td>
          <td><strong>${esc(r.nom)}</strong><br><span class="course-sub">${esc(r.course)}${r.nocturne ? " · 🌙" : ""}</span></td>
          <td>${esc(r.ville)}</td>
          <td>${esc(r.departement_code || "")}</td>
          <td>${esc(r.region || "")}</td>
          <td class="num">${fmtNum(r.distance_km)}</td>
          <td class="num">${fmtNum(r.denivele_pos_m)}</td>
          <td class="num">${fmtNum(r.km_effort)}</td>
          <td>${r.utmb_index ? `<span class="tag">${r.utmb_index}</span>` : "—"}</td>
          <td>${r.utmb_world_series ? '<span class="tag ws">Oui</span>' : "Non"}</td>
          <td class="num">${r.itra_points_estimes ?? "—"}</td>
          <td>${esc(r.type)}</td>
          <td>${esc(r.organisateur) || "—"}</td>
          <td>${links || "—"}</td>
        </tr>`;
      })
      .join("");

    markers.clearLayers();
    markerById.clear();
    rows.forEach((r) => {
      if (r.lat == null) return;
      const m = L.circleMarker([r.lat, r.lon], { radius: 6, color: "#fff", weight: 1.5, fillColor: "#2f7d4f", fillOpacity: 0.95 })
        .bindPopup(`<strong>${esc(r.nom)}</strong> – ${esc(r.course)}<br>${fmtDate(r)} · ${esc(r.ville)}<br>${fmtNum(r.distance_km)} km · ${fmtNum(r.denivele_pos_m)} m D+`);
      markers.addLayer(m);
      markerById.set(r.id, m);
    });

    const parts = [];
    if (state.selRegs.size) parts.push(`${state.selRegs.size} région(s)`);
    if (state.selDeps.size) parts.push(`${state.selDeps.size} département(s)`);
    if (state.shapes.length) parts.push(`${state.shapes.length} périmètre(s) dessiné(s)`);
    $("#selection-summary").textContent = parts.length
      ? `Zone : ${parts.join(" + ")}. Cliquez à nouveau sur une zone pour la retirer.`
      : "Aucune zone sélectionnée : toutes les courses sont affichées.";
  }

  $("#races tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr || e.target.closest("a")) return;
    const m = markerById.get(tr.dataset.id);
    if (m) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 9));
      m.openPopup();
      $("#map").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

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
})();
