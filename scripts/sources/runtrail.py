"""Source 'runtrail' : trails collectés sur runtrail.run (voir scripts/collect_runtrail.py).

Le fichier data/sources/runtrail.csv est rafraîchi par le workflow
collect-runtrail.yml ; ce module se contente de le relire.
"""
import csv
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "sources" / "runtrail.csv"
NAME = "runtrail"


def fetch():
    if not CSV_PATH.exists():
        return []
    with CSV_PATH.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["source"] = NAME
    return rows
