"""Source 'catalogue' : fichier CSV maintenu à la main dans le repo."""
import csv
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "sources" / "catalogue.csv"
NAME = "catalogue"


def fetch():
    with CSV_PATH.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["source"] = NAME
    return rows
