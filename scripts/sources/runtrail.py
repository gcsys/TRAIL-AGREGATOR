"""Source 'runtrail' : trails collectés sur runtrail.run (voir scripts/collect_runtrail.py).

Le fichier data/sources/runtrail.csv est rafraîchi par le workflow
collect-runtrail.yml ; ce module se contente de le relire.
"""
import csv
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "sources" / "runtrail.csv"
NAME = "runtrail"
# Anciennes communes ou stations -> commune actuelle (pour le géocodage et la fusion)
COMMUNES = {
    ("Valmorel", "73"): "Les Avanchers-Valmorel", ("Paladru", "38"): "Villages du Lac de Paladru",
    ("Valleraugue", "30"): "Val-d'Aigoual", ("Lanslebourg-Mont-Cenis", "73"): "Val-Cenis",
    ("Aiguebelle", "73"): "Val-d'Arc", ("Naves", "73"): "Grand-Aigueblanche", ("Pelvoux", "05"): "Vallouise-Pelvoux",
    ("Saint-Christol", "34"): "Entre-Vignes", ("Le Dévoluy", "05"): "Dévoluy", ("Saint-Disdier", "05"): "Dévoluy",
    ("Châtillon-en-Michaille", "01"): "Valserhône", ("Granier", "73"): "Aime-la-Plagne",
    ("Le Mont-Dore", "63"): "Mont-Dore", ("Saint-Bon-Tarentaise", "73"): "Courchevel",
}


def fetch():
    if not CSV_PATH.exists():
        return []
    with CSV_PATH.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["source"] = NAME
        r["ville"] = COMMUNES.get((r["ville"], r["departement"]), r["ville"])
    return rows
