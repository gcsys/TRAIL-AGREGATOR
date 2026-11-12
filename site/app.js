/* Agregatrail : recherche, carte, zones, fiches par course, favoris. */
(async function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const desk = window.matchMedia("(min-width: 1024px)");
  const phone = window.matchMedia("(max-width: 700px)");

  const state = {
    base: [], // courses (formats) telles que publiées dans data/races.json
    races: [], // formats affichés (corrections personnelles appliquées)
    byId: new Map(),
    absent: [],
    eventsAll: new Map(), // clé d'événement -> tous ses formats
    view: null, // null | { kind: "list", id } | { kind: "shared", data, resolved }
    selDeps: new Set(),
    selRegs: new Set(),
    shapes: [], // GeoJSON Feature<Polygon> dessinés
    bbox: null, // [ouest, sud, est, nord] « zone affichée »
    radius: null, // { lat, lon, km, label }
    months: new Set(),
    profils: new Set(),
    sort: { k: "date", dir: 1 },
    clickLayer: "departements",
    mode: "cards",
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
  };

  // ---------- Outils ----------
  const { safeUrl, norm, dateStart, haversine } = Filtres;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toDate = (d) => new Date((d.length === 7 ? d + "-01" : d) + "T00:00");
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtNum = (v) => (v == null ? "—" : Number(v).toLocaleString("fr-FR"));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, w, ws) => `${n.toLocaleString("fr-FR")} ${n > 1 ? ws || w + "s" : w}`;
  const icon = (id, cls = "") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const fmtDate = (r) => {
    if (!r.date) return "Date inconnue";
    if (r.date.length === 7) return cap(toDate(r.date).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })) + " (à préciser)";
    return toDate(r.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  const fmtKm = (v) => (v < 10 ? v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : Math.round(v).toLocaleString("fr-FR"));

  // ---------- Carte ----------
  const map = L.map("map", { zoomSnap: 0.5, preferCanvas: true, zoomControl: true }).setView([46.6, 2.4], 5.5);
  const bases = {
    plan: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19, subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }),
    relief: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18, attribution: "Imagerie &copy; Esri, Maxar, Earthstar Geographics",
    }),
  };
  let baseName = bases[store.get("ta.base")] ? store.get("ta.base") : "plan";
  bases[baseName].addTo(map);
  const syncBaseMenu = () => $$("#basemap-menu [data-base]").forEach((b) => b.setAttribute("aria-checked", b.dataset.base === baseName));
  syncBaseMenu();
  $("#basemap").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#basemap-menu").hidden = !$("#basemap-menu").hidden;
  });
  $("#basemap-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-base]");
    if (!b) return;
    map.removeLayer(bases[baseName]);
    baseName = b.dataset.base;
    bases[baseName].addTo(map).bringToBack();
    store.set("ta.base", baseName);
    syncBaseMenu();
    $("#basemap-menu").hidden = true;
  });
  document.addEventListener("click", (e) => !e.target.closest(".map-side") && ($("#basemap-menu").hidden = true));

  // Les déplacements faits par le site ne doivent pas proposer « Rechercher dans cette zone ».
  // Carte masquée (mobile en mode liste) : le cadrage est rejoué quand elle s'affiche.
  let progMove = 0;
  let pendingMove = null;
  const mapVisible = () => map.getContainer().offsetWidth > 0;
  const moveMap = (fn) => {
    if (!mapVisible()) {
      pendingMove = fn;
      return;
    }
    progMove++;
    fn();
    setTimeout(() => (progMove = Math.max(0, progMove - 1)), 700);
  };
  const flushMove = () => {
    map.invalidateSize();
    if (pendingMove && mapVisible()) {
      const fn = pendingMove;
      pendingMove = null;
      moveMap(fn);
    }
  };

  const css = getComputedStyle(document.documentElement);
  const selColor = "#f2612c";
  const baseStyle = { color: "#2f6b4f", weight: 0.8, opacity: 0.55, fillOpacity: 0.02, fillColor: "#2f6b4f" };
  const selStyle = { color: selColor, weight: 2, opacity: 1, fillOpacity: 0.16, fillColor: selColor };
  const distVar = (km) => (km == null ? "--d1" : km < 20 ? "--d1" : km < 42 ? "--d2" : km < 80 ? "--d3" : "--d4");
  const distColor = (km) => css.getPropertyValue(distVar(km)).trim();

  // Chargement
  let depsGeo, regsGeo, data;
  try {
    [depsGeo, regsGeo, data] = await Promise.all([
      fetch("geo/departements.geojson").then((r) => r.json()),
      fetch("geo/regions.geojson").then((r) => r.json()),
      fetch("data/index.json").then((r) => r.json()),
    ]);
  } catch (e) {
    $("#cards").innerHTML = "";
    $("#empty").hidden = false;
    $("#empty-title").textContent = "Impossible de charger les courses";
    $("#empty-sub").textContent = "Vérifiez votre connexion puis rechargez la page.";
    $("#empty-reset").hidden = true;
    return;
  }

  const depName = new Map(depsGeo.features.map((f) => [f.properties.code, f.properties.nom]));
  const regName = new Map(regsGeo.features.map((f) => [f.properties.code, f.properties.nom]));

  // ---------- Données ----------
  // Index léger (data/index.json) : le détail secondaire se charge à la demande (Donnees.withDetails).
  state.base = Donnees.decode(data, depName, regName);
  const baseById = new Map(state.base.map((r) => [r.id, r]));
  const evKey = (r) => `${norm(r.nom)}|${norm(r.ville)}|${(r.date || "").slice(0, 7)}`;
  function rebuild() {
    state.absent = Favoris.reconcile(baseById, state.base);
    const ed = Favoris.edits();
    state.races = state.base.map((r) => Favoris.apply(r, ed[r.id]));
    state.byId = new Map(state.races.map((r) => [r.id, r]));
    state.absent = state.absent.map((r) => Favoris.apply(r, ed[r.id]));
    state.absent.forEach((r) => state.byId.set(r.id, r));
    state.eventsAll = new Map();
    state.races.forEach((r) => {
      const k = evKey(r);
      if (!state.eventsAll.has(k)) state.eventsAll.set(k, []);
      state.eventsAll.get(k).push(r);
    });
  }
  rebuild();

  // Communes connues (pour « autour de… ») : tirées des courses elles-mêmes.
  const towns = (() => {
    const m = new Map();
    state.base.forEach((r) => {
      if (r.lat == null || !r.ville) return;
      const k = norm(r.ville) + "|" + (r.departement_code || "");
      const t = m.get(k) || { name: r.ville, dep: r.departement_code, lat: 0, lon: 0, n: 0, key: norm(r.ville) };
      t.lat += r.lat;
      t.lon += r.lon;
      t.n++;
      m.set(k, t);
    });
    return [...m.values()].map((t) => ({ ...t, lat: t.lat / t.n, lon: t.lon / t.n }));
  })();

  const updated = new Date(data.generated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  $("#meta").innerHTML = `<b>${state.eventsAll.size.toLocaleString("fr-FR")}</b> courses et <b>${state.base.length.toLocaleString("fr-FR")}</b> formats partout en France. Mis à jour le ${updated}.`;
  $("#foot-meta").textContent = `Données mises à jour le ${updated}`;

  // ---------- Contours administratifs ----------
  let drawing = false;
  function adminLayer(geo, set, name) {
    return L.geoJSON(geo, {
      style: (f) => (set.has(f.properties.code) ? selStyle : baseStyle),
      onEachFeature: (f, layer) => {
        if (!L.Browser.mobile) layer.bindTooltip(`${f.properties.nom} (${f.properties.code})`, { sticky: true, className: "admin-tip" });
        layer.on("click", () => {
          if (drawing || state.clickLayer !== name) return;
          const c = f.properties.code;
          set.has(c) ? set.delete(c) : set.add(c);
          layer.setStyle(set.has(c) ? selStyle : baseStyle);
          clearBbox();
          refresh();
        });
      },
    });
  }
  const layers = {
    departements: adminLayer(depsGeo, state.selDeps, "departements"),
    regions: adminLayer(regsGeo, state.selRegs, "regions"),
  };
  const restyleAdmin = () => {
    layers.departements.eachLayer((l) => l.setStyle(state.selDeps.has(l.feature.properties.code) ? selStyle : baseStyle));
    layers.regions.eachLayer((l) => l.setStyle(state.selRegs.has(l.feature.properties.code) ? selStyle : baseStyle));
  };
  function setClickLayer(name) {
    state.clickLayer = name;
    $$("[data-layer]").forEach((x) => x.classList.toggle("active", x.dataset.layer === name));
    const shown = name === "regions" ? "regions" : "departements";
    Object.entries(layers).forEach(([k, l]) => (k === shown ? map.hasLayer(l) || l.addTo(map) : map.removeLayer(l)));
    layers[shown].bringToBack();
  }
  $$("[data-layer]").forEach((b) => b.addEventListener("click", () => setClickLayer(b.dataset.layer)));
  // Sur téléphone, un toucher sur la carte ne sélectionne rien par défaut (on passe par « Zone »).
  setClickLayer(desk.matches ? "departements" : "none");

  // ---------- Zones dessinées ----------
  const drawn = new L.FeatureGroup().addTo(map);
  function addShape(feature, layer) {
    state.shapes.push(feature);
    layer.setStyle && layer.setStyle(selStyle);
    layer.on("click", () => {
      if (drawing) return;
      drawn.removeLayer(layer);
      state.shapes = state.shapes.filter((s) => s !== feature);
      refresh();
    });
    if (!L.Browser.mobile) layer.bindTooltip("Cliquer pour supprimer ce périmètre");
    drawn.addLayer(layer);
    clearBbox();
    refresh();
  }
  map.on(L.Draw.Event.CREATED, (e) => {
    drawing = false;
    addShape(e.layer.toGeoJSON(), e.layer);
  });
  map.on(L.Draw.Event.DRAWSTOP, () => {
    document.body.classList.remove("drawing-active");
    $$(".seg .drawing").forEach((b) => b.classList.remove("drawing"));
    setTimeout(() => (drawing = false), 50);
  });
  const drawers = {
    "#draw-poly": () => new L.Draw.Polygon(map, { shapeOptions: selStyle, allowIntersection: false }),
    "#draw-rect": () => new L.Draw.Rectangle(map, { shapeOptions: selStyle }),
  };
  Object.entries(drawers).forEach(([sel, make]) =>
    $(sel).addEventListener("click", () => {
      cancelModes();
      drawing = true;
      $(sel).classList.add("drawing");
      document.body.classList.add("drawing-active");
      make().enable();
    })
  );

  // Main levée (souris ou doigt)
  let freehandCancel = null;
  function startFreehand() {
    cancelModes();
    drawing = true;
    document.body.classList.add("freehand-active");
    map.dragging.disable();
    showHint("Entourez la zone d'un seul trait", "Annuler", () => freehandCancel && freehandCancel());
    let pts = [];
    let line = null;
    const container = map.getContainer();
    const toLatLng = (ev) => map.mouseEventToLatLng(ev.touches ? ev.touches[0] : ev);
    const down = (ev) => {
      if (ev.target.closest(".leaflet-control, .draw-hint")) return;
      ev.preventDefault();
      pts = [toLatLng(ev)];
      line = L.polyline(pts, { ...selStyle, weight: 3 }).addTo(map);
      container.addEventListener("mousemove", move);
      container.addEventListener("touchmove", move, { passive: false });
    };
    const move = (ev) => {
      ev.preventDefault();
      pts.push(toLatLng(ev));
      line.setLatLngs(pts);
    };
    const stop = () => {
      container.removeEventListener("mousedown", down);
      container.removeEventListener("touchstart", down);
      container.removeEventListener("mousemove", move);
      container.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
      map.dragging.enable();
      document.body.classList.remove("freehand-active");
      if (line) map.removeLayer(line);
      hideHint();
      freehandCancel = null;
      setTimeout(() => (drawing = false), 50);
    };
    const up = () => {
      if (!line) return;
      stop();
      if (pts.length < 3) return;
      const ring = pts.map((p) => [p.lng, p.lat]);
      ring.push(ring[0]);
      const feature = turf.simplify(turf.polygon([ring]), { tolerance: 0.005, highQuality: false });
      addShape(feature, L.geoJSON(feature, { style: selStyle }).getLayers()[0]);
      toast("Zone ajoutée");
    };
    freehandCancel = stop;
    container.addEventListener("mousedown", down);
    container.addEventListener("touchstart", down, { passive: false });
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
  }
  $("#draw-free").addEventListener("click", startFreehand);

  // ---------- Rayon autour d'un point ----------
  const pinIcon = L.divIcon({ className: "radius-center-pin", html: "<div></div>", iconSize: [22, 22], iconAnchor: [11, 11] });
  let radiusCircle = null, radiusPin = null;
  const radiusKm = () => Number($("#radius").value) || 30;
  function drawRadius() {
    const r = state.radius;
    if (!r) {
      radiusCircle && map.removeLayer(radiusCircle);
      radiusPin && map.removeLayer(radiusPin);
      radiusCircle = radiusPin = null;
      return;
    }
    const ll = [r.lat, r.lon];
    if (!radiusCircle) {
      radiusCircle = L.circle(ll, { radius: r.km * 1000, color: selColor, weight: 2, fillColor: selColor, fillOpacity: 0.08, dashArray: "6 6", interactive: false }).addTo(map);
      radiusPin = L.marker(ll, { icon: pinIcon, draggable: true, keyboard: false, title: "Glissez pour déplacer le centre" }).addTo(map);
      radiusPin.on("drag", (e) => radiusCircle.setLatLng(e.latlng));
      radiusPin.on("dragend", (e) => {
        const p = e.target.getLatLng();
        setRadius({ lat: p.lat, lon: p.lng, label: "point choisi" }, { fit: false });
      });
    } else {
      radiusCircle.setLatLng(ll).setRadius(r.km * 1000);
      radiusPin.setLatLng(ll);
    }
  }
  function setRadius(center, { fit = true, km } = {}) {
    if (km != null) syncRadiusInputs(km);
    state.radius = center ? { lat: center.lat, lon: center.lon, label: center.label || state.radius?.label || "point choisi", km: radiusKm() } : null;
    if (center) clearBbox();
    drawRadius();
    if (center && fit) moveMap(() => map.fitBounds(radiusCircle.getBounds(), { padding: [30, 30] }));
    $("#radius-center").innerHTML = state.radius ? `Centre : <b>${esc(state.radius.label)}</b>` : "Aucun point choisi.";
    refresh();
  }
  function syncRadiusInputs(km) {
    ["#radius", "#radius-map"].forEach((s) => ($(s).value = km));
    ["#radius-out", "#radius-map-out"].forEach((s) => ($(s).textContent = `${km} km`));
    $$(".radius-presets [data-r]").forEach((b) => b.classList.toggle("active", Number(b.dataset.r) === Number(km)));
  }
  let radiusTimer;
  ["#radius", "#radius-map"].forEach((s) =>
    $(s).addEventListener("input", (e) => {
      syncRadiusInputs(e.target.value);
      if (!state.radius) return;
      state.radius.km = radiusKm();
      drawRadius();
      clearTimeout(radiusTimer);
      radiusTimer = setTimeout(refresh, 120);
    })
  );
  $$(".radius-presets [data-r]").forEach((b) =>
    b.addEventListener("click", () => {
      syncRadiusInputs(b.dataset.r);
      if (state.radius) setRadius(state.radius);
    })
  );
  syncRadiusInputs(30);

  function locateMe() {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible sur cet appareil.");
    toast("Recherche de votre position…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setRadius({ lat: p.coords.latitude, lon: p.coords.longitude, label: "ma position" });
        toast(`Courses à moins de ${radiusKm()} km de vous`);
      },
      () => toast("Position indisponible. Autorisez la localisation ou cherchez une ville."),
      { timeout: 10000, maximumAge: 300000 }
    );
  }
  $("#locate").addEventListener("click", locateMe);

  // Choisir le centre en touchant la carte
  function startRadiusPick() {
    cancelModes();
    drawing = true;
    document.body.classList.add("radius-pick");
    map.removeLayer(cluster);
    showHint("Touchez la carte pour placer le centre", "Annuler", stopRadiusPick);
    map.once("click", onPick);
  }
  function onPick(e) {
    stopRadiusPick();
    setRadius({ lat: e.latlng.lat, lon: e.latlng.lng, label: "point choisi" });
  }
  function stopRadiusPick() {
    map.off("click", onPick);
    document.body.classList.remove("radius-pick");
    map.addLayer(cluster);
    hideHint();
    setTimeout(() => (drawing = false), 50);
  }
  $("#draw-radius").addEventListener("click", startRadiusPick);

  // ---------- « Rechercher dans cette zone » ----------
  let bboxLayer = null;
  function clearBbox() {
    state.bbox = null;
    bboxLayer && map.removeLayer(bboxLayer);
    bboxLayer = null;
  }
  function useVisibleArea() {
    const b = map.getBounds();
    clearZone({ silent: true });
    state.bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    bboxLayer = L.rectangle(b.pad(-0.01), { color: selColor, weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(map);
    $("#search-here").hidden = true;
    refresh();
  }
  $("#search-here").addEventListener("click", useVisibleArea);
  const offerSearchHere = () => {
    if (progMove || state.view || drawing || map.getZoom() < 7) return;
    $("#search-here").hidden = false;
  };
  map.on("dragend", offerSearchHere);
  map.on("zoomend", offerSearchHere);

  function clearZone({ silent } = {}) {
    state.selDeps.clear();
    state.selRegs.clear();
    state.shapes = [];
    drawn.clearLayers();
    clearBbox();
    state.radius = null;
    drawRadius();
    $("#radius-center").textContent = "Aucun point choisi.";
    restyleAdmin();
    if (!silent) refresh();
  }
  $("#clear-sel").addEventListener("click", () => clearZone());
  $("#zp-clear").addEventListener("click", () => clearZone());

  // ---------- Bulle d'aide sur la carte (modes de sélection) ----------
  let hintAction = null;
  function showHint(text, btn, action) {
    $("#draw-hint-txt").textContent = text;
    $("#draw-done").textContent = btn;
    hintAction = action;
    $("#draw-hint").hidden = false;
  }
  function hideHint() {
    $("#draw-hint").hidden = true;
    hintAction = null;
  }
  $("#draw-done").addEventListener("click", () => (hintAction ? hintAction() : hideHint()));
  function cancelModes() {
    if (freehandCancel) freehandCancel();
    if (document.body.classList.contains("radius-pick")) stopRadiusPick();
    if (document.body.classList.contains("tap-mode")) endTapMode();
  }
  // Mode « toucher les départements » (mobile)
  function startTapMode() {
    cancelModes();
    document.body.classList.add("tap-mode");
    map.removeLayer(cluster); // les points ne doivent pas intercepter les touchers
    setClickLayer("departements");
    showHint("Touchez les départements à inclure", "Terminé", endTapMode);
  }
  function endTapMode() {
    document.body.classList.remove("tap-mode");
    map.addLayer(cluster);
    if (!desk.matches) setClickLayer("none");
    hideHint();
  }

  // ---------- Marqueurs (un par course, regroupés) ----------
  const cluster = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 11,
    maxClusterRadius: (z) => (z < 7 ? 56 : 42),
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 34 : n < 100 ? 40 : 48;
      return L.divIcon({ html: `<div>${n}</div>`, className: `cluster ${n < 10 ? "c-sm" : n < 100 ? "c-md" : "c-lg"}`, iconSize: [size, size] });
    },
  }).addTo(map);
  const markerByKey = new Map();
  const markerStyle = (ev, hl) => ({ radius: hl ? 10 : 7, color: "#fff", weight: hl ? 3 : 2, fillColor: distColor(ev.maxKm), fillOpacity: 1 });

  // ---------- Filtres ----------
  const num = (id) => {
    const v = $(id).value;
    return v === "" ? null : Number(v);
  };
  const filterIds = ["#f-from", "#f-to", "#f-km-min", "#f-km-max", "#f-d-min", "#f-d-max", "#f-ke-min", "#f-ke-max", "#f-utmb", "#f-ws", "#f-itra", "#f-type", "#f-night", "#f-dplus", "#f-confirmed", "#f-site"];
  filterIds.forEach((id) => $(id).addEventListener("input", () => refresh()));
  let qTimer;
  $("#f-q").addEventListener("input", () => {
    $("#q-clear").hidden = !$("#f-q").value;
    clearTimeout(qTimer);
    qTimer = setTimeout(refresh, 160);
  });
  $("#q-clear").addEventListener("click", () => {
    $("#f-q").value = "";
    $("#q-clear").hidden = true;
    closeSuggest($("#suggest"));
    refresh();
    $("#f-q").focus();
  });
  const isOn = (id) => ($(id).type === "checkbox" ? $(id).checked : $(id).value !== "");
  const clearInput = (id) => ($(id).type === "checkbox" ? ($(id).checked = false) : ($(id).value = ""));
  function resetFilters() {
    filterIds.forEach(clearInput);
    state.months.clear();
    state.profils.clear();
    refresh();
  }
  $("#reset-filters").addEventListener("click", resetFilters);
  $("#empty-reset").addEventListener("click", () => {
    $("#f-q").value = "";
    $("#q-clear").hidden = true;
    clearZone({ silent: true });
    resetFilters();
  });

  // Mois (12 prochains mois)
  (() => {
    const now = new Date();
    const out = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const v = iso(d).slice(0, 7);
      out.push(`<button type="button" data-month="${v}">${d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}<small>${d.getFullYear()}</small></button>`);
    }
    $("#months").innerHTML = out.join("");
  })();
  $("#months").addEventListener("click", (e) => {
    const b = e.target.closest("[data-month]");
    if (!b) return;
    const m = b.dataset.month;
    state.months.has(m) ? state.months.delete(m) : state.months.add(m);
    refresh();
  });
  $$("[data-prof]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = b.dataset.prof;
      state.profils.has(p) ? state.profils.delete(p) : state.profils.add(p);
      refresh();
    })
  );

  // Puces rapides : elles écrivent dans les champs du panneau (source unique de vérité).
  const weekend = () => {
    const now = new Date();
    const d = now.getDay(); // 0 = dimanche
    const sat = new Date(now);
    sat.setDate(now.getDate() + (d === 0 ? -1 : 6 - d));
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    return [iso(d === 0 || d === 6 ? now : sat), iso(sun)];
  };
  const whenRange = (w) => {
    if (w === "we") return weekend();
    const now = new Date();
    return [iso(now), iso(new Date(now.getTime() + w * 864e5))];
  };
  $$(".chip:not(.dispo)").forEach((c) =>
    c.addEventListener("click", () => {
      const on = c.classList.contains("active");
      if (c.dataset.km) {
        const [a, b] = c.dataset.km.split("-");
        $("#f-km-min").value = on ? "" : a === "0" ? "" : a;
        $("#f-km-max").value = on ? "" : b || "";
      } else if (c.dataset.when) {
        const [f, t] = whenRange(c.dataset.when);
        $("#f-from").value = on ? "" : f;
        $("#f-to").value = on ? "" : t;
        state.months.clear();
      } else if (c.dataset.type) {
        $("#f-type").value = on ? "" : c.dataset.type;
      } else if (c.dataset.profil) {
        on ? state.profils.delete(c.dataset.profil) : state.profils.add(c.dataset.profil);
      } else if ("night" in c.dataset) {
        $("#f-night").checked = !on;
      }
      refresh();
    })
  );
  function syncChips() {
    const kmMin = $("#f-km-min").value, kmMax = $("#f-km-max").value;
    $$(".chip:not(.dispo)").forEach((c) => {
      let on = false;
      if (c.dataset.km) {
        const [a, b] = c.dataset.km.split("-");
        on = kmMin === (a === "0" ? "" : a) && kmMax === (b || "") && (kmMin || kmMax) !== "";
      } else if (c.dataset.when) {
        const [f, t] = whenRange(c.dataset.when);
        on = $("#f-from").value === f && $("#f-to").value === t;
      } else if (c.dataset.type) on = $("#f-type").value === c.dataset.type;
      else if (c.dataset.profil) on = state.profils.has(c.dataset.profil);
      else if ("night" in c.dataset) on = $("#f-night").checked;
      c.classList.toggle("active", on);
    });
    $$("#months [data-month]").forEach((b) => b.classList.toggle("active", state.months.has(b.dataset.month)));
    $$("[data-prof]").forEach((b) => b.classList.toggle("active", state.profils.has(b.dataset.prof)));
    const n = filterCount();
    $("#filter-badge").textContent = n;
    $("#filter-badge").hidden = !n;
    $("#toggle-more").classList.toggle("on", n > 0);
  }
  function filterCount() {
    let n = 0;
    if (isOn("#f-from") || isOn("#f-to") || state.months.size) n++;
    if (isOn("#f-km-min") || isOn("#f-km-max")) n++;
    if (isOn("#f-d-min") || isOn("#f-d-max") || state.profils.size) n++;
    if (isOn("#f-ke-min") || isOn("#f-ke-max")) n++;
    ["#f-utmb", "#f-ws", "#f-itra", "#f-type", "#f-night", "#f-dplus", "#f-confirmed", "#f-site"].forEach((id) => isOn(id) && n++);
    return n;
  }

  // Logique des filtres et de la zone : site/filtres.js (testée dans tests/js/).
  const zone = () => ({ deps: state.selDeps, regs: state.selRegs, shapes: state.shapes, bbox: state.bbox, radius: state.radius });
  const zoneActive = () => Filtres.zoneActive(zone());
  const pip = (pt, poly) => turf.booleanPointInPolygon(pt, poly);
  // Lit le formulaire une seule fois par rafraîchissement.
  const readCriteria = () =>
    Filtres.criteres({
      q: norm($("#f-q").value), from: $("#f-from").value, to: $("#f-to").value,
      months: state.months, profils: state.profils,
      kmMin: num("#f-km-min"), kmMax: num("#f-km-max"), dMin: num("#f-d-min"), dMax: num("#f-d-max"),
      keMin: num("#f-ke-min"), keMax: num("#f-ke-max"),
      utmb: $("#f-utmb").value, ws: $("#f-ws").value, itra: num("#f-itra"), type: $("#f-type").value,
      night: $("#f-night").checked, dplus: $("#f-dplus").checked, confirmed: $("#f-confirmed").checked, site: $("#f-site").checked,
    });

  let dispoHidden = new Set(); // courses retirées par « Week-ends dispo » au dernier rafraîchissement
  function passes(r, c, z) {
    if (!Filtres.dansZone(r, z, pip) || !Filtres.passe(r, c)) return false;
    if (Dispo.hiding() && Dispo.status(r) === "busy") return dispoHidden.add(evKey(r)), false;
    return true;
  }

  // ---------- Panneaux (filtres, zone) ----------
  let openPanelEl = null;
  function openPanel(sel) {
    closePanel();
    openPanelEl = $(sel);
    openPanelEl.hidden = false;
    $("#scrim").hidden = false;
    document.body.classList.add("panel-open");
    $("#toggle-more").setAttribute("aria-expanded", sel === "#more-filters");
  }
  function closePanel() {
    if (!openPanelEl) return;
    openPanelEl.hidden = true;
    openPanelEl = null;
    $("#scrim").hidden = true;
    document.body.classList.remove("panel-open");
    $("#toggle-more").setAttribute("aria-expanded", false);
  }
  $("#toggle-more").addEventListener("click", () => openPanel("#more-filters"));
  $("#open-zone").addEventListener("click", () => openPanel("#zone-panel"));
  $("#map-zone-btn").addEventListener("click", () => openPanel("#zone-panel"));
  $("#scrim").addEventListener("click", closePanel);
  $$(".panel [data-close]").forEach((b) =>
    b.addEventListener("click", () => {
      closePanel();
      if (b.classList.contains("primary") && !document.body.classList.contains("map-mode")) scrollToResults();
    })
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("dialog[open]")) return;
    closePanel();
    cancelModes();
  });
  const scrollToResults = () => {
    const y = $("#results").getBoundingClientRect().top + window.scrollY - stickH() - 8;
    if (window.scrollY > y || !desk.matches) window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  };

  // Panneau zone : actions
  $("#zp-me").addEventListener("click", () => {
    closePanel();
    if (!desk.matches) setMapMode(true);
    locateMe();
  });
  $("#zp-pick").addEventListener("click", () => {
    closePanel();
    if (!desk.matches) setMapMode(true);
    startRadiusPick();
  });
  $("#zp-tap-dep").addEventListener("click", () => {
    closePanel();
    if (!desk.matches) setMapMode(true);
    startTapMode();
  });
  $("#zp-free").addEventListener("click", () => {
    closePanel();
    if (!desk.matches) setMapMode(true);
    startFreehand();
  });
  $("#zp-view").addEventListener("click", () => {
    closePanel();
    if (!desk.matches && !document.body.classList.contains("map-mode")) {
      setMapMode(true);
      toast("Cadrez la carte puis touchez « Rechercher dans cette zone »");
      $("#search-here").hidden = false;
      return;
    }
    useVisibleArea();
  });
  const fillSelect = (sel, entries) =>
    ($(sel).innerHTML += entries.map(([c, n]) => `<option value="${esc(c)}">${esc(n)} (${esc(c)})</option>`).join(""));
  fillSelect("#zp-dep", [...depName].sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true })));
  fillSelect("#zp-reg", [...regName].sort((a, b) => a[1].localeCompare(b[1], "fr")));
  $("#zp-dep").addEventListener("change", (e) => {
    if (!e.target.value) return;
    state.selDeps.add(e.target.value);
    e.target.value = "";
    clearBbox();
    restyleAdmin();
    refresh();
  });
  $("#zp-reg").addEventListener("change", (e) => {
    if (!e.target.value) return;
    state.selRegs.add(e.target.value);
    e.target.value = "";
    clearBbox();
    restyleAdmin();
    refresh();
  });

  // ---------- Suggestions (recherche principale et « autour de ») ----------
  const towns_search = (q, n) => {
    const k = norm(q);
    if (k.length < 2) return [];
    const starts = [], has = [];
    towns.forEach((t) => (t.key.startsWith(k) ? starts : t.key.includes(k) ? has : null)?.push(t));
    const sortT = (a, b) => b.n - a.n;
    return starts.sort(sortT).concat(has.sort(sortT)).slice(0, n);
  };
  // Communes absentes de la base : Géoplateforme (IGN), puis ancienne API Adresse.
  async function remoteTowns(q) {
    const urls = [
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&type=municipality&limit=5`,
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&type=municipality&limit=5`,
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const j = await r.json();
        return (j.features || []).map((f) => ({
          name: f.properties.city || f.properties.name,
          dep: (f.properties.context || "").split(",")[0].trim(),
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          remote: true,
        }));
      } catch (e) {
        /* essai suivant */
      }
    }
    return [];
  }

  function closeSuggest(ul) {
    ul.hidden = true;
    ul.innerHTML = "";
    ul.previousElementSibling?.setAttribute?.("aria-expanded", "false");
    ul._items = [];
    ul._sel = -1;
  }
  function renderSuggest(ul, input, groups) {
    const items = [];
    const html = groups
      .filter((g) => g.items.length)
      .map(
        (g) =>
          `<li class="sg-head" role="presentation">${esc(g.title)}</li>` +
          g.items
            .map((it) => {
              items.push(it);
              return `<li role="option" id="${ul.id}-${items.length - 1}" data-i="${items.length - 1}" aria-selected="false"><span class="sg-ic">${icon(it.icon)}</span><span class="sg-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></li>`;
            })
            .join("")
      )
      .join("");
    ul._items = items;
    ul._sel = -1;
    ul.innerHTML = html;
    ul.hidden = !items.length;
    input.setAttribute("aria-expanded", String(!!items.length));
  }
  function wireSuggest(input, ul, build) {
    let seq = 0;
    const update = async () => {
      const my = ++seq;
      const groups = await build(input.value.trim(), (late) => my === seq && renderSuggest(ul, input, late));
      if (my === seq) renderSuggest(ul, input, groups);
    };
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(update, 120);
    });
    input.addEventListener("focus", () => input.value.trim().length >= 2 && update());
    input.addEventListener("keydown", (e) => {
      const items = ul._items || [];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!items.length) return;
        e.preventDefault();
        ul._sel = (ul._sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        $$("[role=option]", ul).forEach((li) => li.setAttribute("aria-selected", li.dataset.i == ul._sel));
        input.setAttribute("aria-activedescendant", `${ul.id}-${ul._sel}`);
        ul.querySelector(`[data-i="${ul._sel}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        if (ul._sel >= 0 && items[ul._sel]) {
          e.preventDefault();
          items[ul._sel].run();
        } else {
          closeSuggest(ul);
          input.blur();
          if (input.id === "f-q") scrollToResults();
        }
        closeSuggest(ul);
      } else if (e.key === "Escape") closeSuggest(ul);
    });
    ul.addEventListener("mousedown", (e) => e.preventDefault());
    ul.addEventListener("click", (e) => {
      const li = e.target.closest("[data-i]");
      if (!li) return;
      ul._items[li.dataset.i].run();
      closeSuggest(ul);
    });
    input.addEventListener("blur", () => setTimeout(() => closeSuggest(ul), 150));
  }

  const townItem = (t, after) => ({
    icon: "pin",
    label: `Autour de ${t.name}`,
    sub: `${t.dep ? (depName.get(t.dep) || t.dep) + " · " : ""}rayon ${radiusKm()} km`,
    run: () => {
      setRadius({ lat: t.lat, lon: t.lon, label: t.name });
      after && after();
    },
  });
  const qDone = () => {
    $("#f-q").value = "";
    $("#q-clear").hidden = true;
    $("#f-q").blur();
    refresh();
    scrollToResults();
  };
  wireSuggest($("#f-q"), $("#suggest"), async (q, late) => {
    const k = norm(q);
    if (k.length < 2) return [];
    const places = towns_search(q, 3).map((t) => townItem(t, qDone));
    const deps = [...depName]
      .filter(([c, n]) => norm(n).includes(k) || c.toLowerCase() === k)
      .slice(0, 3)
      .map(([c, n]) => ({
        icon: "map", label: n, sub: `Département (${c})`,
        run: () => { state.selDeps.add(c); clearBbox(); restyleAdmin(); qDone(); },
      }));
    const regs = [...regName]
      .filter(([, n]) => norm(n).includes(k))
      .slice(0, 2)
      .map(([c, n]) => ({
        icon: "map", label: n, sub: "Région",
        run: () => { state.selRegs.add(c); clearBbox(); restyleAdmin(); qDone(); },
      }));
    const seen = new Set();
    const races = [];
    for (const [key, rows] of state.eventsAll) {
      if (races.length >= 5) break;
      const r = rows[0];
      if (!norm(r.nom).includes(k) || seen.has(norm(r.nom))) continue;
      seen.add(norm(r.nom));
      races.push({
        icon: "mountain", label: r.nom, sub: `${r.ville} · ${fmtDate(r)}`,
        run: () => {
          $("#f-q").value = r.nom;
          $("#q-clear").hidden = false;
          refresh();
          scrollToResults();
        },
      });
    }
    return [
      { title: "Lieux", items: [...places, ...deps, ...regs] },
      { title: "Courses", items: races },
    ];
  });
  wireSuggest($("#place-q"), $("#place-suggest"), async (q, late) => {
    if (norm(q).length < 2) return [];
    const done = () => ($("#place-q").value = "");
    const local = towns_search(q, 6).map((t) => townItem(t, done));
    if (local.length < 3) {
      remoteTowns(q).then((rs) => {
        const extra = rs.filter((t) => !local.some((l) => l.label === `Autour de ${t.name}`)).map((t) => townItem(t, done));
        late([{ title: "Communes", items: [...local, ...extra] }]);
      });
    }
    return [{ title: "Communes", items: local }];
  });

  // ---------- Formatage ----------
  const courseLabel = (r) => (/^\s*[\d.,]+\s*km\s*$/i.test(r.course || "") ? "" : r.course || "");
  const place = (r) => [r.ville, r.departement_code && `(${r.departement_code})`].filter(Boolean).join(" ");
  const placeLong = (r) => [r.ville, r.departement && `${r.departement}${r.departement_code ? ` (${r.departement_code})` : ""}`].filter(Boolean).join(" · ");

  // Pastille disponibilités (bêta) : rien quand l'indicateur est coupé.
  const dispoDot = (st) => (st ? `<i class="dispo-dot ${st}" title="${Dispo.label[st]}" role="img" aria-label="${Dispo.label[st]}"></i>` : "");
  // Pour une course à plusieurs formats, on retient le cas le moins favorable.
  const evStatus = (ev) => {
    const sts = ev.rows.map((r) => Dispo.status(r));
    return sts.includes("busy") ? "busy" : sts.includes("unsure") ? "unsure" : sts[0] || null;
  };
  function dateCell(r) {
    return dispoDot(Dispo.status(r)) + dateCellInner(r);
  }
  function dateCellInner(r) {
    if (!r.date) return `<span class="dim">Date inconnue</span>`;
    const d = toDate(r.date);
    if (r.date.length === 7)
      return `<span class="d-day">${cap(d.toLocaleDateString("fr-FR", { month: "short" }))} ${d.getFullYear()}</span><span class="d-sub">date à préciser</span>`;
    return `<span class="d-day">${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span><span class="d-sub">${d.getFullYear()}${r.date_confirmee ? "" : " · à confirmer"}</span>`;
  }
  function dateBox(ev) {
    const dot = dispoDot(evStatus(ev));
    return dot ? dateBoxInner(ev).replace(/<\/div>$/, dot + "</div>") : dateBoxInner(ev);
  }
  function dateBoxInner(ev) {
    const r = ev.first;
    if (!r.date) return `<div class="ev-date approx"><span class="wd">date</span><span class="d">?</span><span class="m">&nbsp;</span></div>`;
    const d = toDate(r.date);
    const m = d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
    if (r.date.length === 7) return `<div class="ev-date approx" title="Jour à préciser"><span class="wd">${d.getFullYear()}</span><span class="d">${m}</span></div>`;
    return `<div class="ev-date"><span class="wd">${d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</span><span class="d">${d.getDate()}</span><span class="m">${m}</span></div>`;
  }
  const linksHtml = (r) =>
    [
      safeUrl(r.lien_inscription) && `<a href="${esc(r.lien_inscription)}" target="_blank" rel="noopener">S'inscrire${icon("ext")}</a>`,
      safeUrl(r.site_web) && `<a href="${esc(r.site_web)}" target="_blank" rel="noopener">Site officiel${icon("ext")}</a>`,
      safeUrl(r.source_url) && `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">Source${icon("ext")}</a>`,
    ].filter(Boolean).join("");
  const labelsHtml = (r) =>
    [
      r.utmb_index && `<span class="tag" title="Catégorie UTMB Index estimée">UTMB ${esc(r.utmb_index)}</span>`,
      r.utmb_world_series && `<span class="tag ws">World Series</span>`,
      r.itra_points_estimes > 0 && `<span class="tag muted" title="Points ITRA estimés">ITRA ${r.itra_points_estimes}</span>`,
      r.type === "ultra" && `<span class="tag">Ultra</span>`,
      r.type === "kv" && `<span class="tag">KV</span>`,
      r.nocturne && `<span class="tag night">${icon("moon")}Nocturne</span>`,
    ].filter(Boolean).join("");
  const editedTag = (r) =>
    (r._edited ? `<span class="tag mine" title="Données corrigées par vous">modifié</span>` : "") +
    (r._shared ? `<span class="tag mine" title="Corrigé par l'auteur de la liste">corrigé</span>` : "") +
    (r._absent ? `<span class="tag muted" title="Cette course n'est plus dans la base : affichage de la dernière version connue">hors base</span>` : "");
  const notesHtml = (r) => (r.notes_perso ? `<div class="r-notes">${esc(r.notes_perso)}</div>` : "");

  const favBtn = (r) => {
    const on = Favoris.isFav(r.id);
    const t = on ? "Dans mes listes" : "Ajouter à mes listes";
    return `<button type="button" class="icon-btn fav-btn${on ? " on" : ""}" data-act="fav" data-rid="${esc(r.id)}" aria-pressed="${on}" title="${t}" aria-label="${t}">${icon("star")}</button>`;
  };
  const editBtn = (r) => `<button type="button" class="icon-btn" data-act="edit" data-rid="${esc(r.id)}" title="Compléter : D+, date, km, inscription" aria-label="Compléter les informations">${icon("edit")}</button>`;

  const fmtRow = (r) => `<li class="fmt" data-rid="${esc(r.id)}">
      <span class="f-km"><i class="dot" style="--dc:var(${distVar(r.distance_km)})"></i>${r.distance_km == null ? '<span class="dim">? km</span>' : `${fmtNum(r.distance_km)}<small>km</small>`}</span>
      ${r.denivele_pos_m == null ? '<span class="f-dp unknown">D+ ?</span>' : `<span class="f-dp">${fmtNum(r.denivele_pos_m)}<small> m D+</small></span>`}
      <span class="f-info">${courseLabel(r) ? `<span class="f-label">${esc(courseLabel(r))}</span>` : ""}${labelsHtml(r)}${editedTag(r)}</span>
      <span class="f-acts">${editBtn(r)}${favBtn(r)}</span>
    </li>`;

  function evMeta(ev) {
    const r = ev.first;
    const bits = [`<span>${icon("pin")}${esc(placeLong(r))}</span>`];
    if (r.date && r.date.length === 10) {
      const days = new Set(ev.rows.map((x) => x.date)).size;
      bits.push(`<span class="when">${icon("calendar")}${esc(cap(toDate(r.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })))}${days > 1 ? ` · sur ${days} jours` : ""}</span>`);
      if (!ev.rows.every((x) => x.date_confirmee)) bits.push(`<span class="warn">Date à confirmer</span>`);
    } else if (r.date) bits.push(`<span class="warn">${icon("calendar")}Jour à préciser</span>`);
    return bits.join("");
  }
  const cardHtml = (ev) => {
    const links = linksHtml(ev.links);
    const also = ev.others.length ? `Aussi : ${ev.others.map((r) => (r.distance_km == null ? "?" : fmtNum(r.distance_km)) + " km").join(", ")}` : "";
    return `<li class="ev${ev.rows.every((r) => r._absent) ? " absent" : ""}${evStatus(ev) === "busy" ? " dispo-busy" : ""}" data-key="${esc(ev.key)}">
      ${dateBox(ev)}
      <div class="ev-main">
        <div class="ev-head"><h3 class="ev-name">${esc(ev.first.nom)}</h3>${ev.near != null ? `<span class="ev-near">à ${fmtKm(ev.near)} km</span>` : ""}</div>
        <p class="ev-meta">${evMeta(ev)}</p>
        <ul class="fmts">${ev.rows.map(fmtRow).join("")}</ul>
        ${ev.rows.map(notesHtml).join("")}
        ${links || also ? `<div class="ev-foot"><span class="ev-also">${esc(also)}</span><span class="ev-links">${links}</span></div>` : ""}
      </div>
    </li>`;
  };
  const popupHtml = (ev) => `<div class="pop">
      <div class="pop-date">${dispoDot(evStatus(ev))}${esc(fmtDate(ev.first))}</div>
      <div class="pop-title">${esc(ev.first.nom)}</div>
      <div class="pop-sub">${esc(placeLong(ev.first))}${ev.near != null ? ` · à ${fmtKm(ev.near)} km` : ""}</div>
      <ul class="fmts">${ev.rows.map(fmtRow).join("")}</ul>
      <div class="ev-links">${linksHtml(ev.links)}</div>
    </div>`;

  const rowHtml = (r) => `<tr data-key="${esc(evKey(r))}"${r._absent ? ' class="absent"' : ""}>
      <td class="date">${dateCell(r)}</td>
      <td><div class="r-name-row">${favBtn(r)}<div><div class="r-name">${esc(r.nom)} ${editedTag(r)}</div><div class="r-sub">${[courseLabel(r), r.organisateur].filter(Boolean).map(esc).join(" · ")}</div>${notesHtml(r)}</div></div></td>
      <td class="place">${esc(place(r))}<div class="r-sub">${esc(r.region || "")}</div></td>
      <td class="num"><span class="dist" style="--dc:var(${distVar(r.distance_km)})">${fmtNum(r.distance_km)}</span></td>
      <td class="num">${r.denivele_pos_m == null ? '<span class="dim">?</span>' : fmtNum(r.denivele_pos_m) + " m"}</td>
      <td class="num">${r.km_effort == null ? '<span class="dim">—</span>' : fmtNum(r.km_effort)}</td>
      <td>${labelsHtml(r) || '<span class="dim">—</span>'}</td>
      <td class="links">${[safeUrl(r.site_web) && `<a href="${esc(r.site_web)}" target="_blank" rel="noopener">Site</a>`, safeUrl(r.source_url) && `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">Source</a>`].filter(Boolean).join("")}${editBtn(r)}</td>
    </tr>`;

  // ---------- Regroupement par course ----------
  function groupEvents(rows) {
    const m = new Map();
    rows.forEach((r) => {
      const k = evKey(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    const c = state.radius;
    return [...m].map(([key, rs]) => {
      rs.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
      const first = [...rs].sort((a, b) => (a.date || "9").localeCompare(b.date || "9"))[0];
      const ids = new Set(rs.map((r) => r.id));
      const kms = rs.map((r) => r.distance_km).filter((v) => v != null);
      const dps = rs.map((r) => r.denivele_pos_m).filter((v) => v != null);
      const kes = rs.map((r) => r.km_effort).filter((v) => v != null);
      const pos = rs.find((r) => r.lat != null);
      return {
        key, rows: rs, first,
        others: state.view ? [] : (state.eventsAll.get(key) || []).filter((r) => !ids.has(r.id)),
        links: { site_web: rs.map((r) => r.site_web).find(safeUrl), lien_inscription: rs.map((r) => r.lien_inscription).find(safeUrl), source_url: rs.map((r) => r.source_url).find(safeUrl) },
        lat: pos?.lat, lon: pos?.lon,
        minKm: kms.length ? Math.min(...kms) : null, maxKm: kms.length ? Math.max(...kms) : null,
        maxD: dps.length ? Math.max(...dps) : null, maxKe: kes.length ? Math.max(...kes) : null,
        near: c && pos ? haversine(c.lat, c.lon, pos.lat, pos.lon) : null,
      };
    });
  }
  const cmp = (x, y, dir) => {
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "fr") : x - y) * dir;
  };
  function sortEvents(evs) {
    const { k, dir } = state.sort;
    const val = {
      date: (e) => (e.first.date ? dateStart(e.first.date) : null),
      near: (e) => e.near,
      distance_km: (e) => (dir === 1 ? e.minKm : e.maxKm),
      denivele_pos_m: (e) => e.maxD,
      km_effort: (e) => e.maxKe,
      nom: (e) => e.first.nom,
      ville: (e) => e.first.ville,
      utmb_index: (e) => e.first.utmb_index,
    }[k] || ((e) => e.first[k]);
    const d = (e) => (e.first.date ? dateStart(e.first.date) : null);
    const byDate = (a, b) => cmp(d(a), d(b), 1);
    return evs.sort((a, b) => cmp(val(a), val(b), dir) || byDate(a, b));
  }

  // ---------- Tri ----------
  const syncSortUi = () => {
    const { k, dir } = state.sort;
    $$("th[data-k]").forEach((th) => {
      th.classList.toggle("sorted-asc", th.dataset.k === k && dir === 1);
      th.classList.toggle("sorted-desc", th.dataset.k === k && dir === -1);
    });
    const sel = $("#sort-select");
    sel.querySelector("[data-near]").hidden = !state.radius;
    const v = `${k}:${dir}`;
    if (![...sel.options].some((o) => o.value === v)) {
      sel.querySelectorAll("[data-extra]").forEach((x) => x.remove());
      const o = new Option(`${$(`th[data-k="${k}"]`)?.textContent || k} ${dir === 1 ? "↑" : "↓"}`, v);
      o.dataset.extra = "1";
      sel.add(o);
    }
    sel.value = v;
  };
  $$("th[data-k]").forEach((th) =>
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

  // Fiches / tableau
  function setMode(m) {
    state.mode = m === "table" ? "table" : "cards";
    store.set("ta.mode", state.mode);
    $$(".view-seg [data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
    document.body.classList.toggle("table-mode", state.mode === "table");
    $(".table-wrap").hidden = state.mode !== "table" || !desk.matches;
    setTimeout(() => map.invalidateSize(), 50);
  }
  $$(".view-seg [data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      setMode(b.dataset.mode);
      refresh({ keep: true });
    })
  );

  // ---------- Rendu ----------
  const PAGE = 30;
  let curEvents = [];
  let curRows = [];
  let shown = 0;
  const tableOn = () => state.mode === "table" && desk.matches;

  function renderMore(n = PAGE) {
    if (tableOn()) {
      const slice = curRows.slice(shown, shown + n * 2);
      $("#races tbody").insertAdjacentHTML("beforeend", slice.map(rowHtml).join(""));
      shown += slice.length;
      $("#more").hidden = shown >= curRows.length;
      $("#more").textContent = `Afficher plus (${plural(curRows.length - shown, "format")} restants)`;
    } else {
      const slice = curEvents.slice(shown, shown + n);
      $("#cards").insertAdjacentHTML("beforeend", slice.map(cardHtml).join(""));
      shown += slice.length;
      $("#more").hidden = shown >= curEvents.length;
      $("#more").textContent = `Afficher plus (${plural(curEvents.length - shown, "course")} restantes)`;
    }
  }
  $("#more").addEventListener("click", () => renderMore());
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => e.isIntersecting && !$("#more").hidden && renderMore(), { rootMargin: "600px" }).observe($("#sentinel"));
  }

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
        if (ed[to] || !se || !Object.keys(se).length) return r;
        return { ...Favoris.apply(r, se), _edited: false, _shared: true };
      })
      .filter(Boolean);
  }

  function refresh(opts = {}) {
    const keep = opts.keep ? Math.max(shown, PAGE) : PAGE;
    dispoHidden = new Set();
    const c = readCriteria(), z = zone();
    const rows = state.view ? viewRows() : state.races.filter((r) => passes(r, c, z));
    if (state.sort.k === "near" && !state.radius) state.sort = { k: "date", dir: 1 };
    curEvents = sortEvents(groupEvents(rows));
    const { k, dir } = state.sort;
    const rowVal = (r) => (k === "near" ? (state.radius && r.lat != null ? haversine(state.radius.lat, state.radius.lon, r.lat, r.lon) : null) : r[k]);
    curRows = rows.slice().sort((a, b) => cmp(rowVal(a), rowVal(b), dir));

    syncSortUi();
    syncChips();
    const nEv = curEvents.length;
    $("#count").textContent = nEv.toLocaleString("fr-FR");
    $("#count-label").textContent = nEv > 1 ? "courses" : "course";
    $("#count-sub").textContent = `${plural(rows.length, "format")}${zoneActive() && !state.view ? ` · ${zoneLabel()}` : ""}`;
    $$(".count-inline").forEach((el) => (el.textContent = nEv.toLocaleString("fr-FR")));
    $("#fab-count").textContent = nEv.toLocaleString("fr-FR");
    $("#empty").hidden = nEv > 0;
    $("#empty-title").textContent = state.view ? "Cette liste est vide" : "Aucune course ne correspond";
    $("#empty-sub").textContent = state.view ? "Touchez l'étoile d'une course pour l'ajouter à cette liste." : "Élargissez la zone ou retirez un filtre.";
    $("#empty-reset").hidden = !!state.view;
    $("#races tbody").innerHTML = "";
    $("#cards").innerHTML = "";
    $(".table-wrap").hidden = !tableOn() || !nEv;
    shown = 0;
    renderMore(keep);
    renderBanner(rows, curEvents);
    renderTokens();
    renderDispoBar(curEvents);
    document.body.classList.toggle("list-view", !!state.view);
    state.view ? $("#nav-home").removeAttribute("aria-current") : $("#nav-home").setAttribute("aria-current", "page");

    // Marqueurs : un par course
    cluster.clearLayers();
    markerByKey.clear();
    const ms = [];
    curEvents.forEach((ev) => {
      if (ev.lat == null) return;
      const m = L.circleMarker([ev.lat, ev.lon], markerStyle(ev));
      m.bindPopup(() => popupHtml(ev), { autoPanPaddingTopLeft: L.point(16, 70), autoPanPaddingBottomRight: L.point(16, 90), maxWidth: 320, minWidth: 250 });
      m.on("mouseover", () => $(`.ev[data-key="${CSS.escape(ev.key)}"]`)?.classList.add("hl"));
      m.on("mouseout", () => $(`.ev[data-key="${CSS.escape(ev.key)}"]`)?.classList.remove("hl"));
      m._ev = ev;
      ms.push(m);
      markerByKey.set(ev.key, m);
    });
    cluster.addLayers(ms);

    // Résumé de la zone
    const zl = zoneLabel();
    $("#map-status").hidden = !zl || !!state.view;
    $("#selection-summary").textContent = zl;
    $("#ms-radius").hidden = !state.radius;
    $("#zone-btn-lbl").textContent = zl || "Zone";
    $("#map-zone-lbl").textContent = zl || "Choisir une zone";
    $("#open-zone").classList.toggle("on", !!zl);
    const nz = state.selDeps.size + state.selRegs.size + state.shapes.length + (state.bbox ? 1 : 0) + (state.radius ? 1 : 0);
    $("#zone-badge").textContent = nz;
    $("#zone-badge").hidden = !nz || !phone.matches;
    $("#zone-tags").innerHTML = [...state.selRegs].map((c) => tokenHtml(regName.get(c) || c, `reg:${c}`)).concat([...state.selDeps].map((c) => tokenHtml(`${depName.get(c) || c} (${c})`, `dep:${c}`))).join("");
    if (zl) $("#search-here").hidden = true;

    if (!state.view) writeUrl();
  }

  function zoneLabel() {
    const parts = [];
    const names = (set, m) => (set.size <= 2 ? [...set].map((c) => m.get(c) || c).join(", ") : null);
    if (state.radius) parts.push(`${state.radius.km} km autour de ${state.radius.label}`);
    if (state.selRegs.size) parts.push(names(state.selRegs, regName) || plural(state.selRegs.size, "région"));
    if (state.selDeps.size) parts.push(names(state.selDeps, depName) || plural(state.selDeps.size, "département"));
    if (state.shapes.length) parts.push(state.shapes.length > 1 ? `${state.shapes.length} zones dessinées` : "zone dessinée");
    if (state.bbox) parts.push("zone affichée");
    return parts.length ? cap(parts.join(" + ")) : "";
  }

  // Filtres actifs sous forme d'étiquettes supprimables
  const tokenHtml = (label, id) => `<button type="button" class="token" data-tok="${esc(id)}">${esc(label)}<span class="tx">${icon("x")}</span></button>`;
  function renderTokens() {
    if (state.view) return ($("#active-filters").hidden = true);
    const t = [];
    const q = $("#f-q").value.trim();
    if (q) t.push([`« ${q} »`, "q"]);
    if (state.radius) t.push([`${state.radius.km} km autour de ${state.radius.label}`, "radius"]);
    state.selRegs.forEach((c) => t.push([regName.get(c) || c, `reg:${c}`]));
    state.selDeps.forEach((c) => t.push([`${depName.get(c) || c} (${c})`, `dep:${c}`]));
    if (state.shapes.length) t.push([state.shapes.length > 1 ? `${state.shapes.length} zones dessinées` : "Zone dessinée", "shapes"]);
    if (state.bbox) t.push(["Zone affichée", "bbox"]);
    const range = (a, b, unit) => (a && b ? `${a}–${b} ${unit}` : a ? `≥ ${a} ${unit}` : `≤ ${b} ${unit}`);
    const fd = (v) => toDate(v).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const from = $("#f-from").value, to = $("#f-to").value;
    if (from || to) t.push([from && to ? `${fd(from)} → ${fd(to)}` : from ? `Dès le ${fd(from)}` : `Jusqu'au ${fd(to)}`, "dates"]);
    [...state.months].sort().forEach((m) => t.push([cap(toDate(m).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })), `month:${m}`]));
    if (isOn("#f-km-min") || isOn("#f-km-max")) t.push([range($("#f-km-min").value, $("#f-km-max").value, "km"), "km"]);
    if (isOn("#f-d-min") || isOn("#f-d-max")) t.push([range($("#f-d-min").value, $("#f-d-max").value, "m D+"), "dplusr"]);
    if (isOn("#f-ke-min") || isOn("#f-ke-max")) t.push([range($("#f-ke-min").value, $("#f-ke-max").value, "km-effort"), "ke"]);
    const profName = { roulant: "Roulant", vallonne: "Vallonné", montagne: "Montagne" };
    state.profils.forEach((p) => t.push([profName[p], `prof:${p}`]));
    if (isOn("#f-type")) t.push([$("#f-type").selectedOptions[0].text, "#f-type"]);
    if (isOn("#f-utmb")) t.push([`UTMB : ${$("#f-utmb").selectedOptions[0].text}`, "#f-utmb"]);
    if (isOn("#f-ws")) t.push([`World Series : ${$("#f-ws").selectedOptions[0].text}`, "#f-ws"]);
    if (isOn("#f-itra")) t.push([`ITRA ≥ ${$("#f-itra").value}`, "#f-itra"]);
    if (isOn("#f-night")) t.push(["Nocturne", "#f-night"]);
    if (isOn("#f-dplus")) t.push(["D+ connu", "#f-dplus"]);
    if (isOn("#f-confirmed")) t.push(["Date confirmée", "#f-confirmed"]);
    if (isOn("#f-site")) t.push(["Site officiel", "#f-site"]);
    $("#active-filters").hidden = !t.length;
    $("#active-filters").innerHTML = t.map(([l, id]) => tokenHtml(l, id)).join("") + (t.length > 1 ? `<button type="button" class="clear-all" data-tok="all">Tout effacer</button>` : "");
  }
  function removeToken(id) {
    if (id === "all") {
      $("#f-q").value = "";
      $("#q-clear").hidden = true;
      clearZone({ silent: true });
      return resetFilters();
    }
    if (id === "q") ($("#f-q").value = ""), ($("#q-clear").hidden = true);
    else if (id === "radius") (state.radius = null), drawRadius();
    else if (id.startsWith("reg:")) state.selRegs.delete(id.slice(4)), restyleAdmin();
    else if (id.startsWith("dep:")) state.selDeps.delete(id.slice(4)), restyleAdmin();
    else if (id === "shapes") (state.shapes = []), drawn.clearLayers();
    else if (id === "bbox") clearBbox();
    else if (id === "dates") clearInput("#f-from"), clearInput("#f-to");
    else if (id.startsWith("month:")) state.months.delete(id.slice(6));
    else if (id === "km") clearInput("#f-km-min"), clearInput("#f-km-max");
    else if (id === "dplusr") clearInput("#f-d-min"), clearInput("#f-d-max");
    else if (id === "ke") clearInput("#f-ke-min"), clearInput("#f-ke-max");
    else if (id.startsWith("prof:")) state.profils.delete(id.slice(5));
    else if (id.startsWith("#")) clearInput(id);
    refresh();
  }
  ["#active-filters", "#zone-tags"].forEach((s) =>
    $(s).addEventListener("click", (e) => {
      const b = e.target.closest("[data-tok]");
      if (b) removeToken(b.dataset.tok);
    })
  );

  // ---------- Lien de la page = recherche en cours ----------
  const URL_INPUTS = { q: "#f-q", du: "#f-from", au: "#f-to", kmin: "#f-km-min", kmax: "#f-km-max", dmin: "#f-d-min", dmax: "#f-d-max", kemin: "#f-ke-min", kemax: "#f-ke-max", type: "#f-type", utmb: "#f-utmb", ws: "#f-ws", itra: "#f-itra", nuit: "#f-night", dplus: "#f-dplus", conf: "#f-confirmed", site: "#f-site" };
  function writeUrl() {
    const p = new URLSearchParams();
    Object.entries(URL_INPUTS).forEach(([k, id]) => {
      const el = $(id);
      if (el.type === "checkbox") el.checked && p.set(k, "1");
      else if (el.value.trim()) p.set(k, el.value.trim());
    });
    if (state.months.size) p.set("mois", [...state.months].sort().join(","));
    if (state.profils.size) p.set("profil", [...state.profils].join(","));
    if (state.selDeps.size) p.set("dep", [...state.selDeps].join(","));
    if (state.selRegs.size) p.set("reg", [...state.selRegs].join(","));
    if (state.radius) p.set("autour", `${state.radius.lat.toFixed(4)},${state.radius.lon.toFixed(4)},${state.radius.km},${state.radius.label}`);
    if (state.sort.k !== "date" || state.sort.dir !== 1) p.set("tri", `${state.sort.k}:${state.sort.dir}`);
    const s = p.toString();
    const url = location.pathname + (s ? "?" + s : "");
    if (url !== location.pathname + location.search || location.hash) history.replaceState(history.state, "", url);
  }
  function readUrl() {
    const p = new URLSearchParams(location.search);
    Object.entries(URL_INPUTS).forEach(([k, id]) => {
      if (!p.has(k)) return;
      const el = $(id);
      if (el.type === "checkbox") el.checked = p.get(k) === "1";
      else el.value = p.get(k);
    });
    $("#q-clear").hidden = !$("#f-q").value;
    (p.get("mois") || "").split(",").filter(Boolean).forEach((m) => state.months.add(m));
    (p.get("profil") || "").split(",").filter(Boolean).forEach((m) => state.profils.add(m));
    (p.get("dep") || "").split(",").filter((c) => depName.has(c)).forEach((c) => state.selDeps.add(c));
    (p.get("reg") || "").split(",").filter((c) => regName.has(c)).forEach((c) => state.selRegs.add(c));
    const a = (p.get("autour") || "").split(",");
    if (a.length >= 3 && !isNaN(a[0]) && !isNaN(a[1])) {
      syncRadiusInputs(Number(a[2]) || 30);
      state.radius = { lat: Number(a[0]), lon: Number(a[1]), km: radiusKm(), label: a.slice(3).join(",") || "point choisi" };
      $("#radius-center").innerHTML = `Centre : <b>${esc(state.radius.label)}</b>`;
      drawRadius();
    }
    const t = (p.get("tri") || "").split(":");
    if (t.length === 2 && ["date", "near", "distance_km", "denivele_pos_m", "km_effort", "nom", "ville", "utmb_index"].includes(t[0])) state.sort = { k: t[0], dir: Number(t[1]) === -1 ? -1 : 1 };
    restyleAdmin();
  }

  // ---------- Carte ↔ liste ----------
  function setMapMode(on, push = true) {
    if (desk.matches) on = false;
    const was = document.body.classList.contains("map-mode");
    document.body.classList.toggle("map-mode", on);
    if (on && !was) {
      if (push) history.pushState({ ...(history.state || {}), app: true, map: true }, "", location.href);
      flushMove();
    } else if (!on && was && push && history.state?.map) {
      history.back();
    }
  }
  $("#view-toggle").addEventListener("click", () => setMapMode(!document.body.classList.contains("map-mode")));
  desk.addEventListener("change", () => {
    setMapMode(false, false);
    setClickLayer(desk.matches ? "departements" : "none");
    setMode(state.mode);
    refresh({ keep: true });
    setTimeout(flushMove, 60);
  });

  function focusEvent(key) {
    const m = markerByKey.get(key);
    if (!m) return;
    if (!desk.matches) setMapMode(true);
    setTimeout(() => {
      map.invalidateSize();
      pendingMove = null;
      moveMap(() => {
        if (map.getZoom() < 11) map.setView(m.getLatLng(), 11, { animate: false });
        cluster.zoomToShowLayer(m, () => m.openPopup());
      });
    }, desk.matches ? 0 : 60);
  }
  const onCardClick = (e) => {
    const el = e.target.closest("[data-key]");
    if (!el || e.target.closest("a, button")) return;
    focusEvent(el.dataset.key);
  };
  $("#cards").addEventListener("click", onCardClick);
  $("#races tbody").addEventListener("click", onCardClick);
  // Survol d'une fiche : point mis en évidence sur la carte
  let hlMarker = null;
  $("#cards").addEventListener("mouseover", (e) => {
    const el = e.target.closest(".ev");
    const m = el && markerByKey.get(el.dataset.key);
    if (m === hlMarker) return;
    if (hlMarker) hlMarker.setStyle(markerStyle(hlMarker._ev));
    hlMarker = m && cluster.getVisibleParent(m) === m ? m : null;
    if (hlMarker) hlMarker.setStyle(markerStyle(hlMarker._ev, true)).bringToFront();
  });
  $("#cards").addEventListener("mouseleave", () => {
    if (hlMarker) hlMarker.setStyle(markerStyle(hlMarker._ev));
    hlMarker = null;
  });

  // Hauteur de la zone collante (en-tête + barre de recherche)
  const hdrH = () => $(".site-header").offsetHeight;
  const stickH = () => hdrH() + (document.body.classList.contains("list-view") ? 0 : $("#searchbar").offsetHeight);
  const syncStick = () => {
    document.documentElement.style.setProperty("--stick", `${stickH()}px`);
    const top = $("#searchbar").getBoundingClientRect().top;
    $("#searchbar").classList.toggle("stuck", top <= hdrH() + 1);
  };
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      syncStick();
    });
  }, { passive: true });
  window.addEventListener("resize", () => {
    syncStick();
    flushMove();
  });

  // ---------- Disponibilités (bêta) ----------
  function renderDispoBar(evs) {
    const on = Dispo.active() && !state.view;
    $("#dispo-bar").hidden = !on;
    if (!on) return;
    const shownKeys = new Set(evs.map((ev) => ev.key));
    const n = [...dispoHidden].filter((k) => !shownKeys.has(k)).length; // courses entièrement retirées
    const c = Dispo.config();
    const kept = evs.filter((ev) => evStatus(ev) === "ok").length;
    $("#dispo-bar-text").innerHTML = c.hide
      ? `<strong>Week-ends dispo activé.</strong> ${n ? `${plural(n, "course")} retirée${n > 1 ? "s" : ""} car elle${n > 1 ? "s tombent" : " tombe"} un week-end indisponible` : "Aucune course retirée"} (un week-end sur ${c.every}). ${plural(kept, "course")} en vert.`
      : `<strong>Week-ends dispo activé.</strong> Les courses d'un week-end indisponible restent affichées en rouge.`;
  }
  $("#dispo-off").addEventListener("click", () => {
    Dispo.set({ on: false });
    syncDispoUi();
    refresh({ keep: true });
  });
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
    if (!Dispo.ready()) return openDispo(); // réglage effacé : on le redemande
    Dispo.set({ on: !Dispo.config().on });
    syncDispoUi();
    refresh({ keep: true });
    if (Dispo.active()) scrollToResults();
  });
  $("#dispo-settings").addEventListener("click", openDispo);
  syncDispoUi();

  // ---------- Export ----------
  $("#export").addEventListener("click", async () => {
    await Donnees.withDetails(curRows, data.detail_fields);
    const cols = ["date", "nom", "course", "ville", "code_postal", "departement", "region", "distance_km", "denivele_pos_m", "km_effort", "utmb_index", "utmb_world_series", "itra_points_estimes", "type", "nocturne", "organisateur", "site_web", "lien_inscription"];
    const csv = [cols.join(";")]
      .concat(curRows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(";")))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "trails.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- Favoris : listes, corrections, partage ----------
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 2800);
  };
  const openDlg = (id) => {
    const d = $(id);
    if (!d.open) d.showModal();
  };

  function syncFavUi() {
    const n = Favoris.lists().length;
    $("#lists-badge").textContent = n;
    $("#lists-badge").hidden = !n;
    $$('[data-act="fav"]').forEach((b) => {
      const on = Favoris.isFav(b.dataset.rid);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
      b.title = on ? "Dans mes listes" : "Ajouter à mes listes";
      b.setAttribute("aria-label", b.title);
    });
  }

  function fitTo(evs) {
    const pts = evs.filter((e) => e.lat != null).map((e) => [e.lat, e.lon]);
    if (pts.length) moveMap(() => map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 11 }));
  }

  // Navigation : la liste ouverte a sa propre adresse, le bouton « retour » du téléphone ramène à l'accueil.
  const listUrl = (v) => (v.kind === "list" ? `${location.pathname}?liste=${encodeURIComponent(v.id)}` : location.pathname + location.search + location.hash);
  function setView(v, { push = true } = {}) {
    cancelModes();
    closePanel();
    setMapMode(false, false);
    const wasView = !!state.view;
    state.view = v;
    if (v && push) {
      const st = { app: true, view: v.kind === "list" ? { kind: "list", id: v.id } : "shared" };
      wasView ? history.replaceState(st, "", listUrl(v)) : history.pushState(st, "", listUrl(v));
    }
    $("#search-here").hidden = true;
    refresh();
    syncStick();
    if (v) {
      fitTo(curEvents);
      window.scrollTo({ top: 0 });
    }
  }
  function goHome() {
    if (!state.view) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (history.state?.app && history.state.view) {
      history.back(); // l'accueil d'où l'on venait, avec ses filtres
      return;
    }
    state.view = null;
    history.replaceState(null, "", location.pathname);
    refresh();
    syncStick();
    fitAll();
    window.scrollTo({ top: 0 });
  }
  const fitAll = () => {
    if (zoneActive()) {
      fitTo(curEvents);
      return;
    }
    const pts = state.races.filter((r) => r.lat != null).map((r) => [r.lat, r.lon]);
    if (pts.length) moveMap(() => map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 9 }));
  };
  $("#lb-back").addEventListener("click", goHome);
  ["#home-link", "#nav-home"].forEach((s) =>
    $(s).addEventListener("click", (e) => {
      e.preventDefault();
      goHome();
    })
  );
  $(".foot-brand .brand").addEventListener("click", (e) => {
    e.preventDefault();
    goHome();
  });
  window.addEventListener("popstate", (e) => {
    const s = e.state || {};
    document.body.classList.toggle("map-mode", !!s.map && !desk.matches);
    if (s.map) flushMove();
    route();
  });
  async function route() {
    const id = new URLSearchParams(location.search).get("liste");
    if (id && Favoris.get(id)) {
      if (state.view?.kind !== "list" || state.view.id !== id) setView({ kind: "list", id }, { push: false });
      return true;
    }
    if (/^#liste=/.test(location.hash)) return openSharedFromHash({ push: false });
    if (state.view) {
      state.view = null;
      refresh();
      syncStick();
      fitAll();
    }
    return false;
  }

  // Bandeau de la liste consultée
  function renderBanner(rows, evs) {
    const v = state.view;
    $("#list-banner").hidden = !v;
    if (!v) return;
    if (v.kind === "list") {
      const l = Favoris.get(v.id);
      if (!l) return setTimeout(goHome);
      $("#lb-kicker").textContent = "Ma liste";
      $("#lb-name").textContent = l.name;
      $("#lb-note").textContent = `${plural(evs.length, "course")} · ${plural(rows.length, "format")}`;
      $("#lb-actions").innerHTML = `
        <button class="btn" data-lb="share">${icon("share")}Partager</button>
        <button class="btn" data-lb="rename">${icon("edit")}Renommer</button>
        <button class="btn danger" data-lb="delete">${icon("trash")}Supprimer</button>`;
    } else {
      const lost = v.resolved.filter((x) => !x.to).length;
      $("#lb-kicker").textContent = "Liste partagée";
      $("#lb-name").textContent = v.data.name;
      $("#lb-note").textContent = plural(evs.length, "course") + (lost ? ` · ${plural(lost, "course")} introuvable${lost > 1 ? "s" : ""} dans la base` : "");
      $("#lb-actions").innerHTML = `<button class="btn primary" data-lb="import">${icon("star")}Enregistrer dans mes listes</button>`;
    }
  }

  $("#lb-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lb]");
    if (!b) return;
    const v = state.view;
    const act = b.dataset.lb;
    if (act === "share") shareList(v.id);
    else if (act === "rename") renameList(v.id);
    else if (act === "delete") deleteList(v.id);
    else if (act === "import") {
      const l = Favoris.importShared(v.data, v.resolved, state.byId);
      rebuild();
      syncFavUi();
      state.view = null;
      history.replaceState({ app: true, view: { kind: "list", id: l.id } }, "", `${location.pathname}?liste=${encodeURIComponent(l.id)}`);
      setView({ kind: "list", id: l.id }, { push: false });
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
    syncFavUi();
    renderListsDlg();
    if (state.view?.id === id) goHome();
    else refresh({ keep: true });
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
            <button type="button" class="icon-btn" data-ll="share" title="Partager" aria-label="Partager">${icon("share")}</button>
            <button type="button" class="icon-btn" data-ll="rename" title="Renommer" aria-label="Renommer">${icon("edit")}</button>
            <button type="button" class="icon-btn" data-ll="delete" title="Supprimer" aria-label="Supprimer">${icon("trash")}</button>
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
    $("#share-copy").textContent = navigator.share && phone.matches ? "Partager" : "Copier";
    openDlg("#dlg-share");
    $("#share-url").select();
  }
  $("#share-copy").addEventListener("click", async () => {
    const url = $("#share-url").value;
    if (navigator.share && phone.matches) {
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

  async function openSharedFromHash({ push = true } = {}) {
    const m = location.hash.match(/^#liste=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    try {
      const data = await Favoris.decode(m[1]);
      const resolved = Favoris.resolveShared(data, state.byId, state.races);
      setView({ kind: "shared", data, resolved }, { push });
      return true;
    } catch (e) {
      console.warn(e);
      toast("Lien de liste illisible ou incomplet.");
      history.replaceState(null, "", location.pathname + location.search);
      return false;
    }
  }
  window.addEventListener("hashchange", () => openSharedFromHash());

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
      source: `Correction depuis Agregatrail (id ${o.id}). Source : `,
    });
    window.open(`https://github.com/gcsys/TRAIL-AGREGATOR/issues/new?${p}`, "_blank", "noopener");
  });

  // Délégation : étoiles et boutons « Compléter » (tableau, fiches, popups)
  const onAct = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.act === "fav") openFav(b.dataset.rid);
    else if (b.dataset.act === "edit") openEdit(b.dataset.rid);
  };
  document.addEventListener("click", onAct);
  map.on("popupopen", (e) => {
    const el = e.popup.getElement();
    if (el && !el.dataset.actBound) {
      el.dataset.actBound = "1";
      el.addEventListener("click", onAct);
    }
  });

  // ---------- Démarrage ----------
  setMode(desk.matches ? store.get("ta.mode", "cards") : "cards");
  syncFavUi();
  readUrl();
  syncStick();
  if (!(await route())) {
    refresh();
    if (state.radius) moveMap(() => map.fitBounds(L.latLng(state.radius.lat, state.radius.lon).toBounds(state.radius.km * 2000), { padding: [20, 20] }));
    else fitAll();
  }
})();
