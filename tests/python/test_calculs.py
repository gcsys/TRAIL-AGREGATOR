"""Champs calculés et normalisation (scripts/build_db.py)."""
import unittest

from aide import build_db, course


class KmEffort(unittest.TestCase):
    def test_km_effort(self):
        r = course(km="20", dplus="1000")
        self.assertEqual(r["km_effort"], 30.0)
        self.assertEqual(r["utmb_index"], "20K")
        self.assertEqual(r["itra_points_estimes"], 1)

    def test_sans_dplus(self):
        r = course(km="20", dplus="")
        self.assertIsNone(r["km_effort"])
        self.assertIsNone(r["utmb_index"])
        self.assertIsNone(r["itra_points_estimes"])

    def test_arrondi_pair_comme_python(self):
        # 10 km + 325 m = 13,25 : round() de Python donne 13,2 (site/donnees.js doit faire pareil)
        self.assertEqual(course(km="10", dplus="325")["km_effort"], 13.2)

    def test_virgule_decimale(self):
        self.assertEqual(course(km="16,5")["distance_km"], 16.5)


class Categories(unittest.TestCase):
    def test_utmb(self):
        cas = {None: None, 19.9: None, 20: "20K", 44.9: "20K", 45: "50K", 74.9: "50K", 75: "100K", 154.9: "100K", 155: "100M"}
        for ke, attendu in cas.items():
            self.assertEqual(build_db.utmb_category(ke), attendu, ke)

    def test_itra(self):
        cas = {None: None, 10: 0, 25: 1, 45: 2, 75: 3, 115: 4, 155: 5, 209.9: 5, 210: 6}
        for ke, attendu in cas.items():
            self.assertEqual(build_db.itra_points(ke), attendu, ke)


class Normalisation(unittest.TestCase):
    def test_booleens(self):
        for v, attendu in (("oui", True), ("x", True), ("1", True), ("", False), ("non", False)):
            self.assertEqual(build_db.to_bool(v), attendu, v)

    def test_departement_sur_deux_chiffres(self):
        self.assertEqual(course(departement="7")["departement_saisi"], "07")

    def test_norm(self):
        self.assertEqual(build_db.norm("St-Jean-de-Védas"), "saint jean de vedas")
        self.assertEqual(build_db.norm("Ste Croix"), "sainte croix")


if __name__ == "__main__":
    unittest.main()
