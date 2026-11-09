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
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from sources import SOURCES  # noqa: E402

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
def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "trail-agregator/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def geocode(ville, cp, dep, cache):
    """Coordonnées [lon, lat] d'une commune (API Découpage administratif puis API Adresse)."""
    key = f"{ville}|{cp}|{dep}"
    if key in cache:
        return cache[key]
    res = None
    try:
        if dep:
            q = urllib.parse.urlencode({"nom": ville, "codeDepartement": dep, "fields": "centre", "boost": "population", "limit": 1})
            found = _get_json(f"https://geo.api.gouv.fr/communes?{q}")
            if found and found[0].get("centre"):
                res = found[0]["centre"]["coordinates"]
        if res is None:
            params = {"q": ville, "type": "municipality", "limit": 1}
            if cp:
                params["postcode"] = cp
            feats = _get_json("https://api-adresse.data.gouv.fr/search/?" + urllib.parse.urlencode(params)).get("features", [])
            if feats:
                props = feats[0]["properties"]
                if not dep or str(props.get("citycode", "")).startswith(dep):
                    res = feats[0]["geometry"]["coordinates"]
    except Exception as e:  # réseau indisponible : on réessaiera au prochain run
        print(f"  géocodage impossible pour {ville}: {e}", file=sys.stderr)
        return None
    cache[key] = res
    time.sleep(0.05)
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
        "notes": r.get("notes", "").strip(),
        "source": r.get("source", ""),
        "source_url": r.get("source_url", "").strip(),
    }


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

    cache = json.loads(GEOCODE_CACHE.read_text()) if GEOCODE_CACHE.exists() else {}
    offline = os.environ.get("NO_GEOCODE") == "1"  # utile en local sans réseau
    for n in races:
        if not offline and (n["lat"] is None or n["lon"] is None):
            res = geocode(n["ville"], n["code_postal"], n["departement_saisi"], cache)
            if res:
                n["lon"], n["lat"] = res
    GEOCODE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + "\n")

    deps, regs = load_layer("departements"), load_layer("regions")
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


if __name__ == "__main__":
    main()
