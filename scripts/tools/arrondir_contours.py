#!/usr/bin/env python3
"""Arrondit les coordonnées des contours site/geo/*.geojson à 4 décimales (~10 m).

Les fichiers d'origine (france-geojson) ont 15 décimales : inutile pour l'affichage
et pour le rattachement des courses (aucun changement de département constaté),
et deux fois plus lourd à charger. À relancer si l'on remplace les contours.
"""
import json
from pathlib import Path

GEO = Path(__file__).resolve().parents[2] / "site" / "geo"


def rnd(g, n=4):
    return [rnd(x, n) for x in g] if isinstance(g[0], list) else [round(g[0], n), round(g[1], n)]


for p in sorted(GEO.glob("*.geojson")):
    d = json.loads(p.read_text(encoding="utf-8"))
    for f in d["features"]:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    before = p.stat().st_size
    p.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{p.name} : {before / 1e3:.0f} Ko -> {p.stat().st_size / 1e3:.0f} Ko")
