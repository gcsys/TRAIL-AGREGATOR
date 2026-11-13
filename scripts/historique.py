"""Historique des éditions : archive des dates et formats de chaque événement, d'une semaine à l'autre.

- data/archive/editions.json (versionné, jamais vidé) garde, pour chaque événement, ses éditions par
  année : date, date confirmée ou non, distances, et les changements de date relevés d'un build à l'autre.
  Une course passée disparaît de races.json mais reste dans l'archive.
- site/data/historique.json (lu par la fiche) ne garde que ce qui sert aux courses à venir :
  éditions précédentes, habitude (« 3e week-end de mai »), estimation de la date quand elle n'est connue
  qu'au mois, et changements de date. Les estimations sont marquées comme telles par le site.

Bibliothèque standard uniquement.
"""
import calendar
import json
import re
from datetime import date, timedelta
from pathlib import Path

import enrich

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data" / "archive" / "editions.json"
SITE = ROOT / "site" / "data" / "historique.json"

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre",
        "décembre"]
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
ECART_EDITION = 60  # jours : au-delà, deux dates de la même année sont deux éditions distinctes
MOTS_EDITION = {"edition", "eme", "e", "er", "ere"}
ORDINAL = re.compile(r"\d+(e|er|ere|eme|ieme)?")  # 2026, 3e, 1er, 30eme


def cle(r):
    """Identifiant d'un événement d'une année sur l'autre : nom sans numéro d'édition ni année, et commune."""
    nom = " ".join(t for t in enrich.norm(r["nom"]).split() if t not in MOTS_EDITION and not ORDINAL.fullmatch(t))
    return f"{nom}|{enrich.norm(r['ville'])}"


def _jour(d):
    return date.fromisoformat(d) if d and len(d) == 10 else None


def _milieu(d):
    """Date approximative d'une date connue au mois (pour rattacher l'édition)."""
    return _jour(d) or date(int(d[:4]), int(d[5:7]), 15)


def _precise(avant, apres):
    """Vrai si `apres` ne fait que préciser `avant` (même mois, jour ajouté) : ce n'est pas un changement."""
    return len(avant) == 7 and apres.startswith(avant)


# ----- Archive -----

def _groupes(dates):
    """Regroupe les dates d'un événement vues dans une même base : une édition = des dates à moins de
    ECART_EDITION jours (un événement sur deux jours, deux sources en désaccord…). Date retenue : le premier
    jour connu, sinon le mois."""
    out = []
    for d in sorted(dates, key=_milieu):
        if out and (_milieu(d) - _milieu(out[-1][-1])).days <= ECART_EDITION and d[:4] == out[-1][0][:4]:
            out[-1].append(d)
        else:
            out.append([d])
    return [(min((x for x in g if len(x) == 10), default=g[0]), g) for g in out]


def mettre_a_jour(archive, races, aujourdhui):
    """Ajoute à l'archive les éditions vues dans `races` (formats d'une même base). Ne supprime rien.
    Renvoie le nombre d'éditions nouvelles et de changements de date relevés."""
    evs = archive.setdefault("evenements", {})
    par_ev = {}
    for r in races:
        if r.get("date"):
            par_ev.setdefault(cle(r), []).append(r)
    nouvelles = changements = 0
    for k, rows in sorted(par_ev.items()):
        ev = evs.setdefault(k, {"nom": rows[0]["nom"], "ville": rows[0]["ville"],
                                "departement": rows[0].get("departement_code"), "editions": {}})
        ev["nom"], ev["ville"] = rows[0]["nom"], rows[0]["ville"]
        for d, groupe in _groupes({r["date"] for r in rows}):
            lignes = [r for r in rows if r["date"] in groupe]
            # édition existante de la même année à une date proche : la même (éventuellement déplacée ou précisée)
            cible = next((eid for eid, ed in ev["editions"].items()
                          if eid[:4] == d[:4] and abs((_milieu(ed["date"]) - _milieu(d)).days) <= ECART_EDITION), None)
            if cible is None:
                cible, suffixe = d[:4], "a"
                while cible in ev["editions"]:  # 2e édition de l'année : 2027a, puis 2027b…
                    cible, suffixe = d[:4] + suffixe, chr(ord(suffixe) + 1)
                ev["editions"][cible] = {"date": d, "confirmee": False, "formats": [], "changements": []}
                nouvelles += 1
            ed = ev["editions"][cible]
            if ed["date"] != d and not (len(d) == 7 and len(ed["date"]) == 10):  # un mois n'efface pas un jour connu
                if not _precise(ed["date"], d):
                    ed["changements"].append({"le": aujourdhui, "avant": ed["date"], "apres": d})
                    changements += 1
                ed["date"] = d
            ed["confirmee"] = (ed["confirmee"] or any(r.get("date_confirmee") for r in lignes)) and len(ed["date"]) == 10
            ed["formats"] = sorted({r["distance_km"] for r in lignes if r.get("distance_km") is not None} | set(ed["formats"]))
            ed["vu"] = aujourdhui
    return nouvelles, changements


def _json_archive(archive):
    """Une ligne par événement : fichier compact, diffs lisibles d'une semaine à l'autre."""
    evs = archive.get("evenements", {})
    lignes = ",\n".join(f" {json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False, separators=(',', ':'), sort_keys=True)}"
                        for k, v in sorted(evs.items()))
    return f'{{"version":{archive.get("version", 1)},"evenements":{{\n{lignes}\n}}}}\n'


# ----- Habitude et estimation -----

def _samedi(j):
    """Samedi du week-end d'une date (samedi ou dimanche), sinon None."""
    if j.weekday() == 5:
        return j
    if j.weekday() == 6:
        return j - timedelta(days=1)
    return None


def _regle(j):
    """Règle de calendrier d'une date : (mois, rang du week-end ou du jour, dernier ?, jour de la semaine, week-end ?)."""
    sam = _samedi(j)
    base = sam or j
    der = base.day + 7 > calendar.monthrange(base.year, base.month)[1]
    return {"mois": base.month, "rang": (base.day - 1) // 7 + 1, "dernier": der, "jour": j.weekday(),
            "weekend": sam is not None}


def _ordinal(n):
    return "1er" if n == 1 else f"{n}e"


def habitude(dates):
    """Habitude commune à des dates passées (AAAA-MM-JJ). Renvoie (texte, règle) ou None si elles divergent."""
    regles = [_regle(_jour(d)) for d in dates if _jour(d)]
    if not regles:
        return None
    r0 = regles[0]
    if any(r["mois"] != r0["mois"] or r["weekend"] != r0["weekend"] for r in regles):
        return None
    if not r0["weekend"] and any(r["jour"] != r0["jour"] for r in regles):
        return None
    quoi = "week-end" if r0["weekend"] else JOURS[r0["jour"]]
    mois = MOIS[r0["mois"] - 1]
    de = "d'" if mois[0] in "aeiouo" else "de "
    if all(r["rang"] == r0["rang"] for r in regles) and r0["rang"] <= 4:
        return f"{_ordinal(r0['rang'])} {quoi} {de}{mois}", {**r0, "dernier": False}
    if all(r["dernier"] for r in regles):
        return f"dernier {quoi} {de}{mois}", {**r0, "dernier": True}
    return None


def estimer(regle, annee):
    """Date de l'édition `annee` d'après une règle (le samedi, ou le dimanche pour une course du dimanche,
    du week-end visé ; sinon le jour de la semaine visé). None si le mois n'a pas ce rang."""
    cible = 5 if regle["weekend"] else regle["jour"]
    nb = calendar.monthrange(annee, regle["mois"])[1]
    jours = [date(annee, regle["mois"], d) for d in range(1, nb + 1) if date(annee, regle["mois"], d).weekday() == cible]
    if regle["dernier"]:
        j = jours[-1]
    elif regle["rang"] <= len(jours):
        j = jours[regle["rang"] - 1]
    else:
        return None
    return j + timedelta(days=1) if regle["weekend"] and regle["jour"] == 6 else j


def _date_fr(j):
    return f"{JOURS[j.weekday()]} {j.day} {MOIS[j.month - 1]} {j.year}"


def pour_le_site(archive, races, aujourdhui):
    """{"nom|ville": {...}} pour les événements à venir dont l'archive dit quelque chose."""
    auj = date.fromisoformat(aujourdhui)
    evs = archive.get("evenements", {})
    out = {}
    vus = set()
    for r in races:
        if not r.get("date"):
            continue
        k, site_k = cle(r), f"{r['nom']}|{r['ville']}"
        if site_k in vus or k not in evs:
            continue
        vus.add(site_k)
        eds = evs[k]["editions"]
        passees = sorted((e for e in eds.values() if _milieu(e["date"]) < auj), key=lambda e: e["date"])
        actuelle = next((e for e in eds.values() if e["date"] == r["date"]), None)
        info = {}
        if passees:
            info["precedentes"] = [[e["date"], e["formats"]] for e in passees[-5:]]
            h = habitude([e["date"] for e in passees[-3:]])
            if h:
                info["habitude"] = h[0]
                info["n"] = len([e for e in passees[-3:] if _jour(e["date"])])
                if len(r["date"]) == 7:
                    est = estimer(h[1], int(r["date"][:4]))
                    if est and est.strftime("%Y-%m") == r["date"]:
                        info["estimation"] = est.isoformat()
                        info["estimation_texte"] = _date_fr(est)
                elif _jour(r["date"]):
                    est = estimer(h[1], int(r["date"][:4]))
                    if est and abs((est - _jour(r["date"])).days) > 1:
                        info["inhabituelle"] = True
        # seuls les déplacements d'un jour connu à un autre comptent : une date au mois était une estimation
        deplacements = [c for c in (actuelle or {}).get("changements", []) if len(c["avant"]) == 10]
        if deplacements:
            info["changements"] = deplacements[-3:]
        if info:
            out[site_k] = info
    return out


def ecrire(races, aujourdhui=None, archive_path=ARCHIVE, site_path=SITE):
    """Met l'archive à jour avec `races` (à venir et passées) puis écrit le fichier du site."""
    aujourdhui = aujourdhui or date.today().isoformat()
    archive = json.loads(archive_path.read_text(encoding="utf-8")) if archive_path.exists() else {"version": 1}
    nouvelles, changements = mettre_a_jour(archive, races, aujourdhui)
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(_json_archive(archive), encoding="utf-8")
    a_venir = [r for r in races if r.get("date") and r["date"] >= aujourdhui[: len(r["date"])]]
    site = pour_le_site(archive, a_venir, aujourdhui)
    site_path.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"historique : {len(archive['evenements'])} événements archivés, {nouvelles} éditions nouvelles, "
          f"{changements} changements de date ; {len(site)} fiches enrichies")
