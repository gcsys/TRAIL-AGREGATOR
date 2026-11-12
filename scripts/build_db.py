#!/usr/bin/env python3
"""Construit site/data/races.json à partir de toutes les sources.

Étapes : collecte -> normalisation -> géocodage des villes sans coordonnées
(API Adresse, data.gouv.fr, avec cache) -> rattachement département/région
par point-dans-polygone -> champs calculés (km-effort, catégorie UTMB Index,
points ITRA estimés) -> écriture du JSON.

Aucune dépendance externe : bibliothèque standard Python uniquement.
"""
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from sources import SOURCES  # noqa: E402
import enrich  # noqa: E402
import site_data  # noqa: E402

GEO = ROOT / "site" / "geo"
OUT = ROOT / "site" / "data" / "races.json"
GEOCODE_CACHE = ROOT / "data" / "geocode_cache.json"


# ---------- géométrie ----------
def _rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    return geom["coordinates"]  # MultiPolygon


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _in_geom(lon, lat, geom):
    for poly in _rings(geom):
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


def load_layer(name):
    with (GEO / f"{name}.geojson").open(encoding="utf-8") as f:
        return json.load(f)["features"]


def locate(lon, lat, features):
    for ft in features:
        if _in_geom(lon, lat, ft["geometry"]):
            return ft["properties"]["code"], ft["properties"]["nom"]
    return None, None


def dep_to_region(deps, regs):
    """Région de chaque département, via un point intérieur du département."""
    out = {}
    for ft in deps:
        geom = ft["geometry"]
        ring = _rings(geom)[0][0]
        lon = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        if not _in_geom(lon, lat, geom):  # centroïde hors du polygone : on prend un sommet décalé
            lon, lat = ring[0]
        code, nom = locate(lon, lat, regs)
        if code is None:
            for p in ring:
                code, nom = locate(p[0], p[1], regs)
                if code:
                    break
        out[ft["properties"]["code"]] = (code, nom)
    return out


# ---------- géocodage ----------
def _get_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "trail-agregator/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\bst\b", "saint", s)
    s = re.sub(r"\bste\b", "sainte", s)
    return s


class Geocoder:
    """Géocodage des communes : une seule requête pour toutes les communes de France
    (API Découpage administratif), puis recherche locale par nom + département."""

    def __init__(self, cache, online=True):
        self.cache = cache
        self.index = {}
        if not online:  # NO_GEOCODE=1 : cache seulement
            return
        try:
            url = "https://geo.api.gouv.fr/communes?fields=nom,codeDepartement,centre,population&format=json"
            communes = _get_json(url, timeout=120)
            for c in communes:
                if not c.get("centre"):
                    continue
                key = (norm(c["nom"]), c.get("codeDepartement", ""))
                prev = self.index.get(key)
                if not prev or (c.get("population") or 0) > (prev[1] or 0):
                    self.index[key] = (c["centre"]["coordinates"], c.get("population") or 0)
            print(f"  {len(communes)} communes chargées pour le géocodage")
        except Exception as e:
            print(f"  liste des communes indisponible ({e}) : seul le cache sera utilisé", file=sys.stderr)

    def _lookup(self, ville, dep):
        n = norm(ville)
        if dep:
            hit = self.index.get((n, dep))
            if hit:
                return hit[0]
            # ex. « Digne » -> « Digne-les-Bains » : préfixe unique dans le département
            cands = [v for (name, d), v in self.index.items() if d == dep and (name.startswith(n + " ") or n.startswith(name + " "))]
            if len(cands) == 1:
                return cands[0][0]
            return None
        cands = [v for (name, d), v in self.index.items() if name == n]
        return max(cands, key=lambda v: v[1])[0] if cands else None

    def __call__(self, ville, cp, dep):
        key = f"{ville}|{cp}|{dep}"
        if self.cache.get(key):
            return self.cache[key]
        if not self.index:
            return None
        res = self._lookup(ville, dep)
        if res:
            self.cache[key] = res
        else:
            print(f"  commune introuvable : {ville} ({dep or '?'})", file=sys.stderr)
        return res


# ---------- champs calculés ----------
def utmb_category(km_effort):
    """Catégorie UTMB Index d'après le km-effort (approximation)."""
    if km_effort is None:
        return None
    if km_effort < 20:
        return None
    if km_effort < 45:
        return "20K"
    if km_effort < 75:
        return "50K"
    if km_effort < 155:
        return "100K"
    return "100M"


def itra_points(km_effort):
    """Points ITRA estimés à partir du km-effort (barème indicatif)."""
    if km_effort is None:
        return None
    for limit, pts in ((25, 0), (45, 1), (75, 2), (115, 3), (155, 4), (210, 5)):
        if km_effort < limit:
            return pts
    return 6


def to_float(v):
    try:
        return float(str(v).replace(",", ".")) if str(v).strip() != "" else None
    except ValueError:
        return None


def to_bool(v):
    return str(v).strip().lower() in ("true", "1", "oui", "yes", "x")


def normalize(r):
    km = to_float(r.get("distance_km"))
    dplus = to_float(r.get("denivele_pos_m"))
    km_effort = round(km + dplus / 100, 1) if km is not None and dplus is not None else None
    return {
        "id": r["id"].strip(),
        "nom": r.get("nom", "").strip(),
        "course": r.get("course", "").strip(),
        "date": r.get("date", "").strip() or None,
        "date_confirmee": to_bool(r.get("date_confirmee")),
        "ville": r.get("ville", "").strip(),
        "code_postal": r.get("code_postal", "").strip(),
        "departement_saisi": r.get("departement", "").strip().zfill(2) if r.get("departement", "").strip() else "",
        "lat": to_float(r.get("lat")),
        "lon": to_float(r.get("lon")),
        "distance_km": km,
        "denivele_pos_m": dplus,
        "km_effort": km_effort,
        "utmb_index": utmb_category(km_effort),
        "utmb_world_series": to_bool(r.get("utmb_world_series")),
        "itra_points_estimes": itra_points(km_effort),
        "type": r.get("type", "").strip() or "trail",
        "nocturne": to_bool(r.get("nocturne")),
        "prix_eur": to_float(r.get("prix_eur")),
        "organisateur": r.get("organisateur", "").strip(),
        "site_web": r.get("site_web", "").strip(),
        "lien_inscription": r.get("lien_inscription", "").strip(),
        "heure_depart": (r.get("heure_depart") or "").strip(),
        "participants_max": to_float(r.get("participants_max")),
        "notes": r.get("notes", "").strip(),
        "source": r.get("source", ""),
        "source_url": r.get("source_url", "").strip(),
    }


def departement_par_point(races, deps):
    """Sources sans département mais avec coordonnées (GoTrail) : département déduit du point,
    pour que la fusion compare les événements d'un même département."""
    for n in races:
        if not n["departement_saisi"] and n["lat"] is not None:
            n["departement_saisi"] = locate(n["lon"], n["lat"], deps)[0] or ""


def main():
    raw = []
    for src in SOURCES:
        rows = src.fetch()
        print(f"source {src.NAME}: {len(rows)} courses")
        raw.extend(rows)

    races, seen = [], set()
    for r in raw:
        n = normalize(r)
        if not n["id"] or n["id"] in seen:
            continue
        seen.add(n["id"])
        races.append(n)

    deps = load_layer("departements")
    departement_par_point(races, deps)
    races = enrich.merge(races)
    enrich.apply_dplus_file(races)
    for n in races:  # D+ éventuellement complété : on recalcule les champs dérivés
        km, dplus = n["distance_km"], n["denivele_pos_m"]
        n["km_effort"] = round(km + dplus / 100, 1) if km is not None and dplus is not None else None
        n["utmb_index"] = utmb_category(n["km_effort"])
        n["itra_points_estimes"] = itra_points(n["km_effort"])

    cache = json.loads(GEOCODE_CACHE.read_text()) if GEOCODE_CACHE.exists() else {}
    missing = [n for n in races if n["lat"] is None or n["lon"] is None]
    geocode = Geocoder(cache, online=os.environ.get("NO_GEOCODE") != "1") if missing else None
    for n in missing:
        if geocode:
            res = geocode(n["ville"], n["code_postal"], n["departement_saisi"])
            if res:
                n["lon"], n["lat"] = res
    GEOCODE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + "\n")

    regs = load_layer("regions")
    dep_names = {f["properties"]["code"]: f["properties"]["nom"] for f in deps}
    dep_region = dep_to_region(deps, regs)
    for n in races:
        dc = dn = None
        if n["lat"] is not None:
            dc, dn = locate(n["lon"], n["lat"], deps)
        if dc is None and n["departement_saisi"] in dep_names:  # repli : département saisi
            dc, dn = n["departement_saisi"], dep_names[n["departement_saisi"]]
        n["departement_code"], n["departement"] = dc, dn
        n["region_code"], n["region"] = dep_region.get(dc, (None, None))
        del n["departement_saisi"]

    today = date.today().isoformat()
    # courses à venir (une date peut n'être connue qu'au mois près : AAAA-MM)
    races = [n for n in races if not n["date"] or n["date"] >= today[: len(n["date"])]]
    races.sort(key=lambda n: (n["date"] or "9999", n["nom"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if OUT.exists():  # ne change pas la date si les courses sont identiques
        old = json.loads(OUT.read_text(encoding="utf-8"))
        if old.get("races") == races:
            generated_at = old.get("generated_at", generated_at)
    payload = {
        "generated_at": generated_at,
        "count": len(races),
        "races": races,
    }
    new = json.dumps(payload, ensure_ascii=False, indent=1)
    OUT.write_text(new + "\n", encoding="utf-8")
    missing = sum(1 for n in races if n["lat"] is None)
    print(f"{len(races)} courses écrites dans {OUT.relative_to(ROOT)} ({missing} sans coordonnées)")
    export_site(payload)


def export_site(payload):
    """Index léger + détail par région, lus par le site (voir scripts/site_data.py).
    races.json reste publié pour les anciennes versions du site encore en cache."""
    sizes = site_data.write(payload["races"], payload["generated_at"], OUT.parent)
    detail = sum(v for k, v in sizes.items() if k.startswith("detail/"))
    print(f"index.json : {sizes['index.json'] / 1e6:.2f} Mo ; détail : {detail / 1e6:.2f} Mo en {len(sizes) - 1} fichiers")


if __name__ == "__main__":
    if "--export-only" in sys.argv:  # régénère index et détail depuis races.json, sans relancer la collecte
        export_site(json.loads(OUT.read_text(encoding="utf-8")))
    else:
        main()
