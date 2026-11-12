"""Tableau de bord qualité (scripts/quality.py)."""
import unittest

from aide import course

import quality


def situee(lat=44.10, lon=3.08, dep="12", reg="76", **kw):
    """Une course telle que publiée (après rattachement au département et à la région)."""
    r = course(**kw)
    r.pop("departement_saisi", None)
    r.update(lat=lat, lon=lon, departement_code=dep, departement="Aveyron", region_code=reg,
             region=quality.REGIONS.get(reg, "Autre"))
    return r


class Taux(unittest.TestCase):
    def test_parts_par_region_et_total(self):
        races = [situee(id="a", dplus="800"), situee(id="b", nom="Autre trail"), situee(id="c", reg="84", dplus="100")]
        t = quality.taux(races, quality.region_de)
        self.assertEqual(t["Occitanie"]["formats"], 2)
        self.assertEqual(t["Occitanie"]["evenements"], 2)
        self.assertAlmostEqual(t["Occitanie"]["dplus"], 0.5)
        self.assertAlmostEqual(t["Total"]["dplus"], 2 / 3)
        self.assertEqual(t["Auvergne-Rhône-Alpes"]["formats"], 1)

    def test_date_au_mois_ni_jour_ni_confirmee(self):
        t = quality.taux([situee(date="2027-05", date_confirmee="true")], quality.source_de)
        self.assertEqual(t["Miles Republic"]["jour"], 0)
        self.assertEqual(t["Miles Republic"]["confirmee"], 0)


class Incoherences(unittest.TestCase):
    def raisons(self, **kw):
        return [x[1] for x in quality.incoherences([situee(**kw)])]

    def test_course_normale(self):
        self.assertEqual(self.raisons(course="20 km", km="20", dplus="900"), [])

    def test_distance_inconnue_ou_improbable(self):
        self.assertEqual(self.raisons(km=""), ["distance inconnue"])
        self.assertIn("improbable", self.raisons(km="1200")[0])

    def test_libelle_different_de_la_distance(self):
        self.assertIn("libellé", self.raisons(course="42 km", km="21")[0])
        self.assertEqual(self.raisons(course="42,2 km", km="42"), [])

    def test_denivele(self):
        self.assertIn("très élevé", self.raisons(km="10", dplus="2500")[0])
        self.assertEqual(self.raisons(km="10", dplus="2500", type="kv"), [])
        self.assertIn("nul", self.raisons(km="15", dplus="0")[0])


class HorsZone(unittest.TestCase):
    def test_zones(self):
        races = [situee(id="ok"), situee(id="sans", lat=None, lon=None), situee(id="fr", reg=None, dep=None),
                 situee(id="voisin", reg="75")]
        got = {r["id"]: raison for r, raison in quality.hors_zone(races)}
        self.assertNotIn("ok", got)
        self.assertIn("sans coordonnées", got["sans"])
        self.assertIn("hors de France", got["fr"])
        self.assertIn("hors des régions couvertes", got["voisin"])


class Doublons(unittest.TestCase):
    def test_meme_course_deux_communes_voisines(self):
        a = situee(id="a", nom="Trail des Causses Noirs", ville="Millau", source="catalogue")
        b = situee(id="b", nom="Causses Noirs Trail", ville="Creissels", lat=44.09, lon=3.06, source="runtrail", km="21")
        (x, y, raisons), = quality.doublons([a, b])
        self.assertIn("même jour", raisons)
        self.assertIn("sources différentes", raisons)

    def test_date_au_mois_mois_voisin(self):
        a = situee(id="a", nom="Trail des Causses Noirs", date="2027-04")
        b = situee(id="b", nom="Trail des Causses Noirs", ville="Creissels", lat=44.09, lon=3.06, date="2027-05-16")
        self.assertEqual(len(quality.doublons([a, b])), 1)

    def test_pas_de_doublon(self):
        a = situee(id="a", nom="Trail des Causses Noirs")
        loin = situee(id="b", nom="Trail des Causses Noirs", ville="Nice", lat=43.7, lon=7.26)
        autre_jour = situee(id="c", nom="Trail des Causses Noirs", ville="Creissels", lat=44.09, lon=3.06, date="2027-05-23")
        autre_nom = situee(id="d", nom="Trail nocturne", ville="Creissels", lat=44.09, lon=3.06)
        autre_distance = situee(id="e", nom="Trail des Causses Noirs", ville="Creissels", lat=44.09, lon=3.06, km="80")
        for c in (loin, autre_jour, autre_nom, autre_distance):
            self.assertEqual(quality.doublons([a, c]), [], c["id"])

    def test_formats_du_meme_evenement_ignores(self):
        a = situee(id="a", nom="Trail des Causses Noirs", km="20")
        b = situee(id="b", nom="Trail des Causses Noirs", km="21")
        self.assertEqual(quality.doublons([a, b]), [])


class Page(unittest.TestCase):
    def test_page_et_resume(self):
        races = [situee(id="a", nom="Trail <script>", km="")]  # listée : distance inconnue
        res = quality.analyser(races)
        html = quality.page(res, "2026-11-12T04:00:00+00:00", len(races))
        self.assertIn("Qualité des données", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertNotIn("<script>", html)
        md = quality.resume_md(res, len(races))
        self.assertIn("| Occitanie | 1 |", md)


if __name__ == "__main__":
    unittest.main()
