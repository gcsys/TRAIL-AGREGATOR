"""Surveillance des sources : une alerte quand une source baisse fortement ou change de format.

À chaque build, build_db.py appelle `verifier()` avec les lignes brutes de chaque source (avant fusion) :
- data/archive/sources.json (versionné) garde les derniers relevés par source : nombre de lignes,
  taux de remplissage des champs utiles, colonnes renseignées, état de la collecte quand la source
  le donne (DATAtourisme : « direct », « indisponible : … », « format : … ») ;
- si une alerte nouvelle est levée (différente de celles du build précédent), elle est écrite dans
  surveillance.md (non versionné) ; le workflow ouvre alors une issue « surveillance » (ou commente
  celle qui est déjà ouverte).

Alertes :
- nombre de lignes en baisse de plus de 20 % (et d'au moins 10 lignes) par rapport au relevé précédent,
  ou source vide ;
- changement de format : colonne qui n'est plus jamais renseignée, ou champ utile dont le taux de
  remplissage chute d'au moins 30 points ;
- collecte en échec (la dernière version connue a été utilisée).

Bibliothèque standard uniquement.
"""
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data" / "archive" / "sources.json"
ALERTES = ROOT / "surveillance.md"

BAISSE = 0.20
BAISSE_MIN = 10
CHUTE = 0.30
HISTORIQUE = 12  # relevés gardés par source
CHAMPS = ["date", "ville", "distance_km", "denivele_pos_m", "lat", "site_web"]


def releve(rows, etat=None):
    """Résumé d'une source : nombre de lignes, colonnes renseignées, remplissage des champs utiles."""
    n = len(rows)
    rempli = lambda k: sum(1 for r in rows if str(r.get(k) or "").strip())
    colonnes = sorted({k for r in rows for k, v in r.items() if str(v or "").strip()})
    out = {"lignes": n, "colonnes": colonnes,
           "remplissage": {k: round(rempli(k) / n, 3) for k in CHAMPS if n and k in colonnes}}
    if etat:
        out["etat"] = etat
    return out


def comparer(nom, avant, apres):
    """Liste des alertes (textes) entre deux relevés d'une même source."""
    alertes = []
    if apres.get("etat") and apres["etat"] != "direct":
        alertes.append(f"collecte en échec ({apres['etat']}) : la dernière version connue a été utilisée")
    if apres["lignes"] == 0:
        alertes.append("aucune ligne (source vide)")
    if not avant:
        return alertes
    a, b = avant["lignes"], apres["lignes"]
    if b and a - b >= BAISSE_MIN and (a - b) / a > BAISSE:
        alertes.append(f"{a} → {b} lignes ({(b - a) / a:+.0%})")
    if b:
        perdues = sorted(set(avant.get("colonnes", [])) - set(apres["colonnes"]))
        if perdues:
            alertes.append("colonnes plus jamais renseignées : " + ", ".join(perdues))
        for k, t in apres["remplissage"].items():
            t0 = avant.get("remplissage", {}).get(k)
            if t0 is not None and t0 - t >= CHUTE:
                alertes.append(f"champ « {k} » renseigné pour {t:.0%} des lignes (contre {t0:.0%})")
    return alertes


def verifier(par_source, etats, aujourdhui=None, archive_path=ARCHIVE, alertes_path=ALERTES):
    """Compare chaque source à son dernier relevé, met l'archive à jour, écrit les alertes. Renvoie {source: [alertes]}."""
    aujourdhui = aujourdhui or date.today().isoformat()
    archive = json.loads(archive_path.read_text(encoding="utf-8")) if archive_path.exists() else {}
    resultat = {}
    for nom, rows in sorted(par_source.items()):
        r = releve(rows, etats.get(nom))
        hist = archive.setdefault(nom, [])
        precedent = hist[-1]["releve"] if hist else None
        alertes = comparer(nom, precedent, r)
        if alertes:
            resultat[nom] = alertes
        if precedent != r:  # un relevé par changement, pas par build
            hist.append({"le": aujourdhui, "releve": r})
            del hist[:-HISTORIQUE]
    nouvelles = resultat and resultat != archive.get("_alertes")  # même alerte qu'au build précédent : déjà signalée
    archive["_alertes"] = resultat
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(json.dumps(archive, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    if nouvelles:
        alertes_path.write_text(rapport(resultat, aujourdhui), encoding="utf-8")
        for nom, al in resultat.items():
            print(f"surveillance : {nom} : " + " ; ".join(al))
    else:
        alertes_path.unlink(missing_ok=True)
        print("surveillance : " + ("alertes déjà signalées" if resultat else "aucune alerte"))
    return resultat


def rapport(resultat, aujourdhui):
    lignes = [f"Build du {aujourdhui} : la surveillance des sources a relevé ceci.", ""]
    for nom, al in sorted(resultat.items()):
        lignes.append(f"**{nom}**")
        lignes += [f"- {a}" for a in al]
        lignes.append("")
    lignes += ["À vérifier : la page de la source a-t-elle changé de structure, l'export a-t-il été déplacé, "
               "ou s'agit-il d'une baisse normale (fin de saison) ? L'historique des relevés est dans "
               "`data/archive/sources.json`.", "",
               "Issue ouverte automatiquement par le workflow de mise à jour ; fermez-la une fois vérifié."]
    return "\n".join(lignes) + "\n"
