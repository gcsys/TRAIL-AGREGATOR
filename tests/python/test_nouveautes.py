"""Nouveautés : archive, page et flux Atom (scripts/nouveautes.py)."""
import tempfile
import unittest
import xml.dom.minidom
from pathlib import Path

import aide  # noqa: F401  (chemins)

import nouveautes as N


def r(nom="Trail des Templiers", ville="Millau", date="2027-05-16", km=20.0, dplus=None, conf=False, dep="12", reg="76"):
    return {"nom": nom, "ville": ville, "date": date, "distance_km": km, "denivele_pos_m": dplus, "date_confirmee": conf,
            "departement_code": dep, "departement": "Aveyron", "region_code": reg, "region": "Occitanie"}


class Archive(unittest.TestCase):
    def test_premier_build_rien_de_nouveau(self):
        vues = {}
        self.assertEqual(N.noter(vues, [r(), r(nom="Autre")], "2026-11-16"), {"nouvelle": 0, "confirmee": 0, "dplus": 0})
        self.assertTrue(all(v["massif"] for v in vues.values()))

    def test_nouvel_evenement(self):
        vues = {}
        N.noter(vues, [r()], "2026-11-16")
        self.assertEqual(N.noter(vues, [r(), r(nom="Trail nocturne", dplus=300)], "2026-11-23")["nouvelle"], 1)
        self.assertEqual(vues["trail nocturne|millau"], {"le": "2026-11-23", "dplus": 1})

    def test_nouvelle_edition_pas_nouvelle_course(self):
        vues = {}
        N.noter(vues, [r(nom="Trail des Templiers 2026", date="2026-10-25")], "2026-01-01")
        self.assertEqual(N.noter(vues, [r(nom="Trail des Templiers 2027")], "2026-11-23")["nouvelle"], 0)

    def test_date_confirmee_et_dplus_ajoute(self):
        vues = {}
        N.noter(vues, [r(date="2027-05"), r(km=42.0, date="2027-05")], "2026-11-16")
        n = N.noter(vues, [r(conf=True), r(km=42.0, dplus=2100, conf=True)], "2026-11-23")
        self.assertEqual(n, {"nouvelle": 0, "confirmee": 1, "dplus": 1})
        v = vues["trail des templiers|millau"]
        self.assertEqual((v["conf"], v["conf_le"], v["dplus"], v["dplus_le"]), ("2027-05-16", "2026-11-23", 1, "2026-11-23"))
        # build suivant identique : rien de neuf
        self.assertEqual(N.noter(vues, [r(conf=True), r(km=42.0, dplus=2100, conf=True)], "2026-11-30"),
                         {"nouvelle": 0, "confirmee": 0, "dplus": 0})

    def test_arrivee_massive_d_une_source(self):
        vues = {}
        N.noter(vues, [r()], "2026-11-16")
        noms = [f"Trail {a}{b}" for a in "abcdefghijk" for b in "abcdefghij"]
        self.assertEqual(N.noter(vues, [r(nom=x) for x in noms], "2026-11-23")["nouvelle"], 0)

    def test_ecrire_archive(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a" / "vues.json"
            N.ecrire_archive([r()], "2026-11-16", p)
            N.ecrire_archive([r(), r(nom="Trail nocturne")], "2026-11-23", p)
            self.assertIn('"trail nocturne|millau":{"dplus": 0, "le": "2026-11-23"}', p.read_text())


class Sorties(unittest.TestCase):
    def setUp(self):
        self.vues = {"trail des templiers|millau": {"le": "2026-11-23", "dplus": 0},
                     "trail nocturne|millau": {"le": "2026-11-16", "dplus": 0},
                     "vieux trail|millau": {"le": "2026-01-05", "dplus": 1, "dplus_le": "2026-11-23", "conf": "2027-05-16",
                                            "conf_le": "2026-11-23"},
                     "import|nice": {"le": "2026-11-23", "massif": True}}
        self.races = [r(km=20.0), r(km=42.5, date="2027-05-15"), r(nom="Trail nocturne", date="2027-03"),
                      r(nom="Vieux trail", dplus=800, conf=True), r(nom="Import", ville="Nice", dep="06", reg="93")]

    def test_selection_et_ordre(self):
        items = N.nouveautes(self.races, self.vues, "2026-10-26")
        self.assertEqual([(i["type"], i["nom"]) for i in items],
                         [("nouvelle", "Trail des Templiers"), ("confirmee", "Vieux trail"), ("dplus", "Vieux trail"),
                          ("nouvelle", "Trail nocturne")])
        self.assertEqual(items[0]["date"], "2027-05-15")
        self.assertEqual(N.kms(items[0]["formats"]), "20 km, 42,5 km")
        self.assertEqual(N.detail(items[2]), "20 km : 800 m D+")

    def test_confirmation_annulee_pas_affichee(self):
        races = [r(nom="Vieux trail", dplus=800)]  # plus confirmée depuis
        self.assertEqual([i["type"] for i in N.nouveautes(races, self.vues, "2026-10-26")], ["dplus"])

    def test_page(self):
        items = N.nouveautes(self.races + [r(nom="Trail <b>", ville="Rodez")],
                             {**self.vues, "trail b|rodez": {"le": "2026-11-23"}}, "2026-10-26")
        h = N.page(items, "2026-11-23T04:00:00+00:00", [("76", "Occitanie")], [("12", "Aveyron")])
        self.assertIn("Relevé le lundi 23 novembre 2026", h)
        self.assertIn("mars 2027 (jour à confirmer)", h)
        self.assertIn('<a href="#confirmee">Dates confirmées · 1</a>', h)
        self.assertIn("Trail &lt;b&gt;", h)
        self.assertIn('href="../?q=Trail%20des%20Templiers"', h)
        self.assertIn('href="../flux/dep-12.xml"', h)
        self.assertIn('content="noindex"', h)
        self.assertIn("Rien de nouveau", N.page([], "2026-11-23"))

    def test_flux_atom_valides(self):
        items = N.nouveautes(self.races + [r(nom='Trail "& co"')], {**self.vues, "trail co|millau": {"le": "2026-11-23"}},
                             "2026-10-26")
        fichiers, regions, deps = N.tous_les_flux(items, self.races, "2026-11-23T04:00:00+00:00")
        self.assertEqual(sorted(fichiers), ["dates-confirmees.xml", "dep-06.xml", "dep-12.xml", "nouveautes.xml",
                                            "region-76.xml", "region-93.xml"])
        n = lambda f: len(xml.dom.minidom.parseString(fichiers[f].encode()).getElementsByTagName("entry"))
        self.assertEqual((n("nouveautes.xml"), n("dates-confirmees.xml"), n("dep-06.xml"), n("region-76.xml")), (5, 1, 0, 5))
        x = fichiers["nouveautes.xml"]
        self.assertIn("<updated>2026-11-23T06:00:00Z</updated>", x)
        self.assertIn("tag:gcsys.github.io,2026:agregatrail/confirmee/vieux%20trail%7Cmillau/2026-11-23", x)
        self.assertIn("<title>Date confirmée : Vieux trail · Millau (12)</title>", x)


if __name__ == "__main__":
    unittest.main()
