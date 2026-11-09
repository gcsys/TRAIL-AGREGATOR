"""Source 'gotrail' : trails collectés sur gotrail.run (voir scripts/collect_gotrail.py).

Le fichier data/sources/gotrail.csv est rafraîchi par le workflow
collect-gotrail.yml ; ce module se contente de le relire.
"""
import csv
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "sources" / "gotrail.csv"
NAME = "gotrail"


def fetch():
    if not CSV_PATH.exists():
        return []
    with CSV_PATH.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["source"] = NAME
    return rows
