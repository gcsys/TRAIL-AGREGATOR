"""Nouvelles courses : archive, page et flux Atom (scripts/nouveautes.py)."""
import tempfile
import unittest
import xml.dom.minidom
from pathlib import Path

import aide  # noqa: F401  (chemins)

import nouveautes as N


def r(nom="Trail des Templiers", ville="Millau", date="2027-05-16", km=20.0, **kw):
    return {"nom": nom, "ville": ville, "date": date, "distance_km": km, "departement_code": "12", **kw}


class Archive(unittest.TestCase):
    def test_premier_build_rien_de_nouveau(self):
        vues = {}
        self.assertEqual(N.noter(vues, [r(), r(nom="Autre")], "2026-11-16"), 0)
        self.assertTrue(all(v["massif"] for v in vues.values()))

    def test_nouvel_evenement(self):
        vues = {}
        N.noter(vues, [r()], "2026-11-16")
        self.assertEqual(N.noter(vues, [r(), r(nom="Trail nocturne")], "2026-11-23"), 1)
        self.assertEqual(vues["trail nocturne|millau"], {"le": "2026-11-23"})

    def test_nouvelle_edition_pas_nouvelle_course(self):
        vues = {}
        N.noter(vues, [r(nom="Trail des Templiers 2026", date="2026-10-25")], "2026-01-01")
        self.assertEqual(N.noter(vues, [r(nom="Trail des Templiers 2027")], "2026-11-23"), 0)

    def test_arrivee_massive_d_une_source(self):
        vues = {}
        N.noter(vues, [r()], "2026-11-16")
        self.assertEqual(N.noter(vues, [r(nom=f"Trail {a}{b}") for a in "abcdefghijk" for b in "abcdefghij"], "2026-11-23"), 0)

    def test_ecrire_archive(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a" / "vues.json"
            N.ecrire_archive([r()], "2026-11-16", p)
            N.ecrire_archive([r(), r(nom="Trail nocturne")], "2026-11-23", p)
            self.assertIn('"trail nocturne|millau":{"le": "2026-11-23"}', p.read_text())


class Sorties(unittest.TestCase):
    def setUp(self):
        self.vues = {"trail des templiers|millau": {"le": "2026-11-23"}, "trail nocturne|millau": {"le": "2026-11-16"},
                     "vieux trail|millau": {"le": "2026-01-05"}, "import|millau": {"le": "2026-11-23", "massif": True}}
        self.races = [r(km=20.0), r(km=42.5, date="2027-05-15"), r(nom="Trail nocturne", date="2027-03"),
                      r(nom="Vieux trail"), r(nom="Import")]

    def test_selection_et_ordre(self):
        evs = N.evenements(self.races, self.vues, "2026-10-26")
        self.assertEqual([e["nom"] for e in evs], ["Trail des Templiers", "Trail nocturne"])
        self.assertEqual(evs[0]["date"], "2027-05-15")
        self.assertEqual(N.kms(evs[0]["formats"]), "20 km, 42,5 km")

    def test_page(self):
        evs = N.evenements(self.races + [r(nom="Trail <b>", ville="Rodez")], {**self.vues, "trail b|rodez": {"le": "2026-11-23"}}, "2026-10-26")
        h = N.page(evs, "2026-11-23T04:00:00+00:00")
        self.assertIn("Ajoutées le lundi 23 novembre 2026", h)
        self.assertIn("mars 2027 (jour à confirmer)", h)
        self.assertIn("samedi 15 mai 2027", h)
        self.assertIn("Trail &lt;b&gt;", h)
        self.assertIn('href="../?q=Trail%20des%20Templiers"', h)
        self.assertIn('content="noindex"', h)
        self.assertIn("Aucune nouvelle course", N.page([], "2026-11-23"))

    def test_flux_atom_valide(self):
        evs = N.evenements(self.races + [r(nom='Trail "& co"')], {**self.vues, "trail co|millau": {"le": "2026-11-23"}}, "2026-10-26")
        x = N.flux(evs, "2026-11-23T04:00:00+00:00")
        doc = xml.dom.minidom.parseString(x.encode())
        self.assertEqual(len(doc.getElementsByTagName("entry")), 3)
        self.assertEqual(doc.getElementsByTagName("updated")[0].firstChild.data, "2026-11-23T06:00:00Z")
        self.assertIn("tag:gcsys.github.io,2026:agregatrail/trail%20des%20templiers%7Cmillau", x)


if __name__ == "__main__":
    unittest.main()
