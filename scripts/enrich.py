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


def _month_gap(a, b):
    try:
        return abs((int(a[:4]) * 12 + int(a[5:7])) - (int(b[:4]) * 12 + int(b[5:7])))
    except (TypeError, ValueError):
        return 99


# mots trop courants pour identifier un événement à eux seuls
GENERIC = {"nocturne", "nocturnes", "urbain", "urbaine", "hivernal", "hivernale", "balcons", "balcon", "duo", "snow",
           "vertical", "verticale", "foulees", "foulee", "run", "running", "marathon", "semi", "relais", "solidaire",
           "blanc", "blanche", "cimes", "sommets", "cretes", "crete", "bois", "lacs", "chateau", "chateaux",
           "montagne", "montagnes", "vignes", "vignoble", "vignobles", "collines", "gorges", "vallee", "patrimoine",
           "noel", "printemps", "automne", "hiver", "classic", "challenge", "festival", "rando", "marche", "kids",
           "night", "skyrace", "backyard", "estival", "estivale", "corrida", "sentiers", "chemins", "pays", "tour"}


def _strong_name(a, b):
    """Noms quasi identiques, en ignorant la commune (souvent différente d'une source à l'autre)."""
    ca, cb = re.sub(r"[^a-z]", "", norm(a["nom"])), re.sub(r"[^a-z]", "", norm(b["nom"]))
    if ca == cb:
        return True
    ta = tokens(a["nom"]) - tokens(a["ville"])
    tb = tokens(b["nom"]) - tokens(b["ville"])
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if not small or not small <= big or not small - GENERIC:
        return False
    return len(small) >= 2 or max(len(t) for t in small) >= 6


def _same_event(main_rows, other_rows):
    """Même événement ? Les dates au mois près (estimées) peuvent être décalées d'un mois."""
    a, b = main_rows[0], other_rows[0]
    gap = _month_gap(a["date"] or "", b["date"] or "")
    fuzzy_date = len(a["date"] or "") == 7 or len(b["date"] or "") == 7
    if gap > (1 if fuzzy_date else 0):
        return False
    if norm(a["ville"]) == norm(b["ville"]):
        if gap == 0:
            return bool(tokens(a["nom"]) & tokens(b["nom"])) or norm(a["nom"]) == norm(b["nom"])
        return _strong_name(a, b)
    # communes différentes (commune voisine, ancienne commune…) : même département et nom quasi identique
    da, db = a.get("departement_saisi"), b.get("departement_saisi")
    return bool(da) and da == db and _strong_name(a, b)


FILL = ("site_web", "organisateur", "lien_inscription", "prix_eur", "heure_depart", "participants_max")
PER_FORMAT = ("prix_eur", "heure_depart", "participants_max")


def _apply(rows, extra_rows):
    """Copie dans `rows` ce que `extra_rows` sait de plus ; ajoute les formats manquants."""
    src = extra_rows[0]
    exact = src["date"] if src["date"] and len(src["date"]) == 10 else None
    for r in rows:
        if exact and (not r["date"] or len(r["date"]) == 7):
            r["date"], r["date_confirmee"] = exact, src.get("date_confirmee", True)
        if r.get("lat") is None and src.get("lat") is not None and norm(r["ville"]) == norm(src["ville"]):
            r["lat"], r["lon"] = src["lat"], src["lon"]
        for x in extra_rows:
            if close(r["distance_km"], x["distance_km"]):
                if r["denivele_pos_m"] is None and x.get("denivele_pos_m"):
                    r["denivele_pos_m"] = x["denivele_pos_m"]
                for f in FILL:
                    if not r.get(f) and x.get(f):
                        r[f] = x[f]
                break
        for f in FILL:
            if f not in PER_FORMAT and not r.get(f) and src.get(f):
                r[f] = src[f]
    # formats connus seulement de l'autre source (avec distance) : on les ajoute à l'événement
    base = rows[0]
    added = []
    for x in extra_rows:
        if x["distance_km"] is None or any(close(r["distance_km"], x["distance_km"]) for r in rows + added):
            continue
        n = dict(x)
        n.update({k: base[k] for k in ("nom", "ville", "code_postal", "departement_saisi", "lat", "lon")})
        if base["date"] and len(base["date"]) == 10 and not exact:
            n["date"] = base["date"]
        added.append(n)
    return added


def merge(races):
    main = [r for r in races if r["source"] == "catalogue"]
    others = [r for r in races if r["source"] != "catalogue"]
    main_ev = _events(main)
    by_month = defaultdict(list)  # (département ou commune, mois) -> événements
    for rows in main_ev.values():
        by_month[(rows[0].get("departement_saisi") or norm(rows[0]["ville"]), (rows[0]["date"] or "")[:7])].append(rows)
    added = enriched = formats = 0
    for k, rows in _events(others).items():
        key = rows[0].get("departement_saisi") or norm(rows[0]["ville"])
        m = k[2]
        months = [m]
        if len(m) == 7:
            y, mo = int(m[:4]), int(m[5:7])
            months += ["%04d-%02d" % ((y * 12 + mo - 2) // 12, (y * 12 + mo - 2) % 12 + 1),
                       "%04d-%02d" % ((y * 12 + mo) // 12, (y * 12 + mo) % 12 + 1)]
        pool = [c for mm in months for c in by_month.get((key, mm), [])]
        if not rows[0].get("departement_saisi"):  # source sans département : recherche par commune dans tout le mois
            pool += [c for mm in months for kk, cs in by_month.items() if kk[1] == mm for c in cs
                     if norm(c[0]["ville"]) == norm(rows[0]["ville"]) and c not in pool]
        cands = [c for c in pool if _same_event(c, rows)]
        # priorité à la même commune et au même mois
        cands.sort(key=lambda c: (norm(c[0]["ville"]) != norm(rows[0]["ville"]), _month_gap(c[0]["date"] or "", m)))
        if cands:
            new = _apply(cands[0], rows)
            cands[0].extend(new)
            main.extend(new)
            formats += len(new)
            enriched += 1
        else:
            main.extend(rows)
            by_month[(key, m)].append(rows)
            added += 1
    print(f"fusion : {enriched} événements enrichis ({formats} formats ajoutés), {added} événements ajoutés par les autres sources")
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
