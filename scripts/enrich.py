"""Fusion des sources : une même course peut venir de plusieurs sources.

- Les sources complémentaires (DATAtourisme…) enrichissent les courses du
  catalogue quand il s'agit du même événement (même commune, même mois, nom
  proche) : date exacte, site de l'organisateur, D+ par distance. Sinon,
  leurs courses sont ajoutées.
- Le fichier data/sources/denivele.csv (relevés manuels sur les sites des
  organisateurs ou contributions) complète le D+ et le site web.
"""
import csv
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

DPLUS_CSV = Path(__file__).resolve().parents[1] / "data" / "sources" / "denivele.csv"
STOP = {"trail", "trails", "de", "du", "des", "la", "le", "les", "l", "d", "en", "et", "by", "course", "edition", "eme", "e",
        "nature", "urban", "ultra", "grand", "raid", "the", "of", "a", "au", "aux"}


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\bst\b", "saint", s)
    return re.sub(r"\bste\b", "sainte", s)


def tokens(s):
    return {t for t in norm(s).split() if t not in STOP and not t.isdigit() and len(t) > 2}


def close(km_a, km_b):
    return km_a is not None and km_b is not None and abs(km_a - km_b) <= max(2.0, 0.1 * max(km_a, km_b))


def _events(races):
    ev = defaultdict(list)
    for r in races:
        ev[(norm(r["nom"]), norm(r["ville"]), (r["date"] or "")[:7])].append(r)
    return ev


def _same_event(main_rows, other_rows):
    a, b = main_rows[0], other_rows[0]
    if norm(a["ville"]) != norm(b["ville"]) or (a["date"] or "")[:7] != (b["date"] or "")[:7]:
        return False
    return bool(tokens(a["nom"]) & tokens(b["nom"])) or norm(a["nom"]) == norm(b["nom"])


def _apply(rows, extra_rows):
    """Copie dans `rows` ce que `extra_rows` sait de plus."""
    src = extra_rows[0]
    for r in rows:
        if src["date"] and (not r["date"] or len(r["date"]) == 7) and src["date"].startswith(r["date"] or "#"):
            r["date"], r["date_confirmee"] = src["date"], True
        if not r["site_web"] and src.get("site_web"):
            r["site_web"] = src["site_web"]
        if r["denivele_pos_m"] is None:
            for x in extra_rows:
                if x.get("denivele_pos_m") and close(r["distance_km"], x["distance_km"]):
                    r["denivele_pos_m"] = x["denivele_pos_m"]
                    break


def merge(races):
    main = [r for r in races if r["source"] == "catalogue"]
    others = [r for r in races if r["source"] != "catalogue"]
    main_ev = _events(main)
    by_city_month = defaultdict(list)
    for k, rows in main_ev.items():
        by_city_month[(k[1], k[2])].append(rows)
    added = enriched = 0
    for k, rows in _events(others).items():
        cands = [m for m in by_city_month.get((k[1], k[2]), []) if _same_event(m, rows)]
        if cands:
            _apply(cands[0], rows)
            enriched += 1
        else:
            main.extend(rows)
            by_city_month[(k[1], k[2])].append(rows)
            added += 1
    print(f"fusion : {enriched} événements enrichis, {added} ajoutés par les autres sources")
    return main


def apply_dplus_file(races):
    if not DPLUS_CSV.exists():
        return
    by_city = defaultdict(list)
    for r in races:
        by_city[norm(r["ville"])].append(r)
    n = 0
    with DPLUS_CSV.open(encoding="utf-8") as f:
        for p in csv.DictReader(f):
            try:
                km, dp = float(p["distance_km"]), float(p["denivele_pos_m"])
            except (KeyError, ValueError):
                continue
            for r in by_city.get(norm(p["ville"]), []):
                if (tokens(r["nom"]) & tokens(p["nom"]) or norm(r["nom"]) == norm(p["nom"])) and close(r["distance_km"], km):
                    if r["denivele_pos_m"] is None:
                        r["denivele_pos_m"] = dp
                        n += 1
                    if not r["site_web"] and p.get("site_web"):
                        r["site_web"] = p["site_web"]
    print(f"denivele.csv : {n} D+ complétés")
