"""Contribution validée -> lignes de data/sources (scripts/contribution.py)."""
import csv
import shutil
import tempfile
import unittest
from pathlib import Path

import aide  # noqa: F401  (chemins)

import contribution as C

CORPS = """### Nom de la course

Trail des Templiers

### Commune de départ

Millau

### Département (numéro)

_No response_

### Date (AAAA-MM-JJ)

2027-10-24

### Distances et D+

80 ; 3 500 m
20 ;
nimporte quoi

### Site officiel

javascript:alert(1)

### Lien d'inscription

https://inscription.example/templiers

### Inscriptions

Ouvertes

### Date d'ouverture des inscriptions (AAAA-MM-JJ)

2026-11-02

### Mode d'attribution des dossards

Tirage au sort

### Prix (si un seul format, ou celui du format principal)

95,50 €

### Où avez-vous trouvé l'information ?

https://templiers.example

### Identifiant Agregatrail

_No response_
"""

BASE = [{"id": "t-80", "nom": "Festival des Templiers", "ville": "Millau", "date": "2027-10-23", "distance_km": 80.0},
        {"id": "t-20", "nom": "Festival des Templiers", "ville": "Millau", "date": "2027-10-23", "distance_km": 20.0}]


class Contribution(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        for f in ("denivele.csv", "inscriptions.csv", "catalogue.csv"):
            shutil.copy(C.SOURCES / f, self.dir / f)
        self.addCleanup(shutil.rmtree, self.dir, True)

    def lignes(self, f):
        with (self.dir / f).open(encoding="utf-8") as fh:
            return list(csv.DictReader(fh))

    def test_lecture_et_validation(self):
        c = C.lire(CORPS)
        self.assertEqual(c["nom"], "Trail des Templiers")
        self.assertNotIn("departement", c)
        self.assertEqual(C.formats(c["formats"]), [(80.0, 3500.0), (20.0, None)])
        self.assertEqual(C.lien(c["site"]), "")
        self.assertEqual(C.jour("2027-02-30"), "")
        self.assertEqual(C.texte("=SOMME(A1)"), "SOMME(A1)")

    def test_course_connue(self):
        avant, cat = len(self.lignes("denivele.csv")), len(self.lignes("catalogue.csv"))
        n, resume = C.traiter(C.lire(CORPS), 42, BASE, "2026-11-13", self.dir)
        self.assertEqual(n, 2)
        d = self.lignes("denivele.csv")[avant:]
        self.assertEqual([(x["nom"], x["distance_km"], x["denivele_pos_m"]) for x in d], [("Festival des Templiers", "80", "3500")])
        i = self.lignes("inscriptions.csv")
        self.assertEqual((i[0]["statut"], i[0]["mode"], i[0]["ouverture"], i[0]["distance_km"], i[0]["prix_eur"], i[0]["releve_le"]),
                         ("ouvertes", "tirage", "2026-11-02", "80", "95.5", "2026-11-13"))
        self.assertEqual(i[0]["lien_inscription"], "https://inscription.example/templiers")
        self.assertIn("Date proposée : 2027-10-24", resume)
        self.assertEqual(len(self.lignes("catalogue.csv")), cat)  # course connue : pas de nouvelle ligne

    def test_course_inconnue(self):
        avant = len(self.lignes("catalogue.csv"))
        c = C.lire(CORPS.replace("Millau", "Nant").replace("_No response_\n\n### Date", "12\n\n### Date", 1))
        n, _ = C.traiter(c, 7, BASE, "2026-11-13", self.dir)
        self.assertEqual(n, 2)
        new = self.lignes("catalogue.csv")[avant:]
        self.assertEqual([(x["id"], x["departement"], x["date"], x["date_confirmee"], x["denivele_pos_m"]) for x in new],
                         [("contrib-7-trail-des-templiers-80", "12", "2027-10-24", "false", "3500"),
                          ("contrib-7-trail-des-templiers-20", "12", "2027-10-24", "false", "")])

    def test_rien_a_ajouter(self):
        n, resume = C.traiter({"nom": "X", "ville": "Y", "formats": "?"}, 1, BASE, "2026-11-13", self.dir)
        self.assertEqual(n, 0)
        self.assertIn("rien à ajouter", resume)


if __name__ == "__main__":
    unittest.main()
