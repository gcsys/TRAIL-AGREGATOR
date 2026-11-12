"""Rattachement département / région et géocodage (scripts/build_db.py)."""
import unittest

from aide import build_db

DEPS = build_db.load_layer("departements")
REGS = build_db.load_layer("regions")


class Rattachement(unittest.TestCase):
    def test_points_connus(self):
        cas = {
            (3.0777, 44.0983): ("12", "76"),  # Millau
            (4.3601, 43.8367): ("30", "76"),  # Nîmes
            (6.8694, 45.9237): ("74", "84"),  # Chamonix
            (5.3698, 43.2965): ("13", "93"),  # Marseille
            (9.4500, 42.6970): ("2B", "94"),  # Bastia
        }
        d2r = build_db.dep_to_region(DEPS, REGS)
        for (lon, lat), (dep, reg) in cas.items():
            code, _ = build_db.locate(lon, lat, DEPS)
            self.assertEqual(code, dep, (lon, lat))
            self.assertEqual(d2r[code][0], reg, code)

    def test_hors_de_france(self):
        self.assertEqual(build_db.locate(-3.70, 40.42, DEPS), (None, None))  # Madrid

    def test_tous_les_departements_ont_une_region(self):
        d2r = build_db.dep_to_region(DEPS, REGS)
        self.assertEqual(len(d2r), len(DEPS))
        self.assertTrue(all(code for code, _ in d2r.values()))


class Geocodage(unittest.TestCase):
    def geocoder(self, cache=None):
        g = build_db.Geocoder(cache if cache is not None else {}, online=False)
        g.index = {
            ("digne les bains", "04"): ([6.23, 44.09], 16000),
            ("saint martin", "30"): ([4.1, 44.0], 500),
            ("saint martin", "34"): ([3.6, 43.6], 3000),
        }
        return g

    def test_nom_exact(self):
        self.assertEqual(self.geocoder()("St Martin", "", "30"), [4.1, 44.0])

    def test_prefixe_unique(self):
        self.assertEqual(self.geocoder()("Digne", "", "04"), [6.23, 44.09])

    def test_sans_departement_prend_la_plus_peuplee(self):
        self.assertEqual(self.geocoder()("Saint-Martin", "", ""), [3.6, 43.6])

    def test_introuvable(self):
        self.assertIsNone(self.geocoder()("Atlantide", "", "30"))

    def test_resultat_mis_en_cache(self):
        cache = {}
        self.geocoder(cache)("Digne", "", "04")
        self.assertEqual(cache["Digne||04"], [6.23, 44.09])

    def test_hors_ligne_utilise_le_cache(self):
        # NO_GEOCODE=1 : pas de téléchargement, mais le cache sert toujours
        g = build_db.Geocoder({"Millau||12": [3.08, 44.1]}, online=False)
        self.assertEqual(g("Millau", "", "12"), [3.08, 44.1])
        self.assertIsNone(g("Rodez", "", "12"))


if __name__ == "__main__":
    unittest.main()
