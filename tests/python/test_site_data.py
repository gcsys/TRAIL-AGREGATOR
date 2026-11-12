"""Index léger et détail par région (scripts/site_data.py)."""
import json
import tempfile
import unittest
from pathlib import Path

from aide import ROOT, course

import site_data


def exemple():
    a = course(id="a", nom="Trail A", km="20", dplus="1000", nocturne="oui", site_web="https://a.fr")
    a.update(lat=44.123456789, lon=3.0, region_code="76", departement_code="12", heure_depart="08:30", participants_max=300.0)
    b = course(id="b", nom="Trail A", km="10.5", date="2027-05", date_confirmee="")
    b.update(lat=None, lon=None, region_code=None, departement_code=None)
    return [a, b]


class Index(unittest.TestCase):
    def test_aller_retour(self):
        races = exemple()
        dec = site_data.decode_index(json.loads(json.dumps(site_data.build_index(races, "t"))))
        for r, d in zip(races, dec):
            for k in site_data.INDEX_FIELDS + site_data.FLAGS:
                attendu = r[k]
                if k in ("lat", "lon") and attendu is not None:
                    attendu = round(attendu, 5)
                if k in site_data.DICT_FIELDS:
                    attendu = attendu or ""
                self.assertEqual(d[k], attendu, k)

    def test_textes_repetes_stockes_une_fois(self):
        idx = site_data.build_index(exemple(), "t")
        self.assertEqual(idx["dicts"]["nom"], ["Trail A"])
        self.assertEqual(idx["cols"]["nom"], [0, 0])

    def test_sans_champs_calcules_ni_detail(self):
        idx = site_data.build_index(exemple(), "t")
        for k in site_data.DERIVED_FIELDS + site_data.DETAIL_FIELDS:
            self.assertNotIn(k, idx["cols"])

    def test_entiers_alleges(self):
        idx = site_data.build_index(exemple(), "t")
        self.assertEqual(idx["cols"]["distance_km"], [20, 10.5])
        self.assertIsInstance(idx["cols"]["distance_km"][0], int)


class Detail(unittest.TestCase):
    def test_par_region_sans_champs_vides(self):
        d = site_data.build_details(exemple())
        self.assertEqual(d["76"]["a"], {"heure_depart": "08:30", "participants_max": 300, "source": "catalogue"})
        self.assertIn("b", d[site_data.OTHER_REGION])

    def test_ecriture_et_nettoyage(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "detail").mkdir()
            (Path(tmp) / "detail" / "99.json").write_text("{}")  # région disparue
            sizes = site_data.write(exemple(), "t", tmp)
            self.assertEqual(sorted(p.name for p in (Path(tmp) / "detail").iterdir()), ["76.json", "autres.json"])
            self.assertIn("index.json", sizes)


class DonneesPubliees(unittest.TestCase):
    """L'index publié correspond à races.json (mêmes courses, même ordre)."""

    def test_coherence(self):
        data = ROOT / "site" / "data"
        races = json.loads((data / "races.json").read_text(encoding="utf-8"))["races"]
        idx = json.loads((data / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(idx["count"], len(races))
        self.assertEqual(site_data.decode_index(idx)[0]["id"], races[0]["id"])
        self.assertLess((data / "index.json").stat().st_size, 1_000_000, "objectif : index < 1 Mo")


if __name__ == "__main__":
    unittest.main()
