"""Source 'membres' : courses ajoutées sur le site par les membres et validées par l'administrateur,
ou importées par lui depuis l'espace admin.

Le fichier data/sources/membres.csv est l'export public de l'API du site
(api/courses.php?action=csv), téléchargé par le workflow avant chaque construction.
Même format que data/sources/catalogue.csv. Absent (site pas encore sur OVH) : aucune course.
"""
import csv
import re
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "sources" / "membres.csv"
NAME = "membres"
# L'API préfixe d'une apostrophe les cellules qui commencent par = + - @ (protection tableur).
_FORMULE = re.compile(r"^'(?=[=+\-@])")


def fetch(path=CSV_PATH):
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        rows = [{k: _FORMULE.sub("", v or "") for k, v in r.items() if k} for r in csv.DictReader(f)]
    rows = [r for r in rows if r.get("id", "").startswith("membre-") and r.get("nom")]
    for r in rows:
        r["source"] = NAME
    return rows
