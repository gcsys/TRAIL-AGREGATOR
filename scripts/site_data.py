"""Fichiers de données publiés pour le site.

- site/data/index.json : index léger chargé au démarrage. Format en colonnes
  (une liste par champ) avec dictionnaires pour les textes répétés (noms,
  communes, sites…). Contient tout ce qu'il faut aux filtres, à la liste, à la
  carte et aux fiches.
  La table creuse « inscriptions » ({id: {statut, ouverture, mode, releve_le, prix}}) donne l'état
  des inscriptions des rares formats relevés.
- site/data/detail/<code région>.json : champs secondaires (code postal,
  heure de départ, participants, prix, notes, source), chargés à la demande.

Les champs calculés (km-effort, catégorie UTMB, points ITRA estimés) et les
noms de département et de région ne sont pas publiés dans l'index : le
navigateur les recalcule (site/donnees.js) avec les mêmes règles que
scripts/build_db.py.

Bibliothèque standard uniquement.
"""
import json
from pathlib import Path

VERSION = 1

# champs de l'index, dans l'ordre
INDEX_FIELDS = [
    "id", "nom", "course", "date", "ville", "lat", "lon", "distance_km", "denivele_pos_m",
    "type", "organisateur", "site_web", "lien_inscription", "source_url", "departement_code", "region_code",
]
# textes répétés : stockés une fois dans un dictionnaire, la colonne contient des numéros
DICT_FIELDS = {"nom", "course", "ville", "type", "organisateur", "site_web", "lien_inscription", "source_url",
               "departement_code", "region_code"}
# booléens regroupés dans une colonne « flags » (un bit chacun)
FLAGS = ["date_confirmee", "utmb_world_series", "nocturne"]
# champs secondaires, publiés par région
DETAIL_FIELDS = ["code_postal", "heure_depart", "participants_max", "prix_eur", "notes", "source"]
# champs recalculés par le navigateur
DERIVED_FIELDS = ["km_effort", "utmb_index", "itra_points_estimes", "departement", "region"]
OTHER_REGION = "autres"


def _num(v):
    """1.0 -> 1 pour alléger le JSON ; None reste None."""
    if v is None:
        return None
    return int(v) if float(v).is_integer() else v


def _coord(v):
    return None if v is None else round(v, 5)  # ~1 m


def build_index(races, generated_at):
    cols, dicts = {}, {}
    for f in INDEX_FIELDS:
        vals = [r.get(f) for r in races]
        if f in DICT_FIELDS:
            table, pos = [], {}
            out = []
            for v in vals:
                v = v or ""
                if v not in pos:
                    pos[v] = len(table)
                    table.append(v)
                out.append(pos[v])
            dicts[f], vals = table, out
        elif f in ("lat", "lon"):
            vals = [_coord(v) for v in vals]
        elif f in ("distance_km", "denivele_pos_m"):
            vals = [_num(v) for v in vals]
        cols[f] = vals
    cols["flags"] = [sum(1 << i for i, k in enumerate(FLAGS) if r.get(k)) for r in races]
    return {
        "version": VERSION,
        "generated_at": generated_at,
        "count": len(races),
        "flags": FLAGS,
        "detail_fields": DETAIL_FIELDS,
        "dicts": dicts,
        "cols": cols,
        # état des inscriptions (data/sources/inscriptions.csv), rare : table creuse par id, prix compris
        "inscriptions": {r["id"]: {**r["inscription"], **({"prix": _num(r["prix_eur"])} if r.get("prix_eur") is not None else {})}
                         for r in races if r.get("inscription")},
    }


def decode_index(index):
    """Inverse de build_index (hors champs calculés) : sert aux tests et aux scripts."""
    cols, dicts = index["cols"], index["dicts"]
    out = []
    for i in range(index["count"]):
        r = {}
        for f in INDEX_FIELDS:
            v = cols[f][i]
            r[f] = dicts[f][v] if f in dicts else v
        for b, k in enumerate(index["flags"]):
            r[k] = bool(cols["flags"][i] >> b & 1)
        if r["id"] in index.get("inscriptions", {}):
            r["inscription"] = {k: v for k, v in index["inscriptions"][r["id"]].items() if k != "prix"}
        out.append(r)
    return out


def build_details(races):
    """{code région: {id: {champ: valeur}}}, sans les champs vides."""
    out = {}
    for r in races:
        d = {k: _num(r[k]) if k in ("participants_max", "prix_eur") else r[k]
             for k in DETAIL_FIELDS if r.get(k) not in (None, "")}
        out.setdefault(r.get("region_code") or OTHER_REGION, {})[r["id"]] = d
    return out


def _dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def write(races, generated_at, data_dir):
    """Écrit index.json et detail/*.json dans data_dir ; renvoie les tailles en octets."""
    data_dir = Path(data_dir)
    sizes = {}
    idx = data_dir / "index.json"
    _dump(idx, build_index(races, generated_at))
    sizes["index.json"] = idx.stat().st_size
    ddir = data_dir / "detail"
    details = build_details(races)
    for old in ddir.glob("*.json") if ddir.exists() else []:
        if old.stem not in details:
            old.unlink()
    for code, rows in details.items():
        p = ddir / f"{code}.json"
        _dump(p, rows)
        sizes[f"detail/{code}.json"] = p.stat().st_size
    return sizes
