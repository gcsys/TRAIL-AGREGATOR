"""Outils partagés par les tests : chemins et fabrique de courses."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import build_db  # noqa: E402


def course(**kw):
    """Une course normalisée comme après build_db.normalize (avant rattachement)."""
    row = {"id": kw.pop("id", "x"), "nom": "Trail test", "ville": "Millau", "date": "2027-05-16", "distance_km": "20",
           "denivele_pos_m": "", "source": "catalogue", "departement": "12"}
    row.update({k: v for k, v in kw.items() if k in row or k not in ("dplus", "km")})
    if "km" in kw:
        row["distance_km"] = kw["km"]
    if "dplus" in kw:
        row["denivele_pos_m"] = kw["dplus"]
    return build_db.normalize(row)
