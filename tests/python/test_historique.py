"""Historique des éditions (scripts/historique.py)."""
import json
import tempfile
import unittest
from pathlib import Path

import aide  # noqa: F401  (chemins)

import historique as H


def r(nom="Trail des Templiers", ville="Millau", date="2027-05-16", km=20, conf=False):
    return {"nom": nom, "ville": ville, "date": date, "distance_km": km, "date_confirmee": conf, "departement_code": "12"}


class Cle(unittest.TestCase):
    def test_numero_et_annee_retires(self):
        self.assertEqual(H.cle(r(nom="Trail des Templiers 30ème édition 2026")), "trail des templiers|millau")
        self.assertEqual(H.cle(r(nom="3e Trail des Templiers")), H.cle(r()))


class Archive(unittest.TestCase):
    def test_nouvelle_edition_puis_precision_puis_deplacement(self):
        a = {}
        self.assertEqual(H.mettre_a_jour(a, [r(date="2027-05")], "2026-11-01"), (1, 0))
        self.assertEqual(H.mettre_a_jour(a, [r(date="2027-05-16")], "2026-11-08"), (0, 0))  # précision
        self.assertEqual(H.mettre_a_jour(a, [r(date="2027-05-23")], "2026-11-15"), (0, 1))  # déplacement
        ed = a["evenements"][H.cle(r())]["editions"]["2027"]
        self.assertEqual(ed["date"], "2027-05-23")
        self.assertEqual(ed["changements"], [{"le": "2026-11-15", "avant": "2027-05-16", "apres": "2027-05-23"}])

    def test_un_mois_n_efface_pas_un_jour(self):
        a = {}
        H.mettre_a_jour(a, [r(date="2027-05-16")], "2026-11-01")
        H.mettre_a_jour(a, [r(date="2027-05")], "2026-11-08")
        self.assertEqual(a["evenements"][H.cle(r())]["editions"]["2027"]["date"], "2027-05-16")

    def test_plusieurs_dates_une_edition_et_formats_cumules(self):
        a = {}
        n, c = H.mettre_a_jour(a, [r(date="2027-05-15", km=60), r(date="2027-05-16", km=20)], "2026-11-01")
        self.assertEqual((n, c), (1, 0))
        ed = a["evenements"][H.cle(r())]["editions"]["2027"]
        self.assertEqual((ed["date"], ed["formats"]), ("2027-05-15", [20, 60]))
        H.mettre_a_jour(a, [r(date="2027-05-15", km=60), r(date="2027-05-16", km=20)], "2026-11-08")
        self.assertEqual(ed["changements"], [])  # pas de va-et-vient

    def test_deux_editions_la_meme_annee(self):
        a = {}
        self.assertEqual(H.mettre_a_jour(a, [r(date="2027-03-14"), r(date="2027-10-10")], "2026-11-01"), (2, 0))
        self.assertEqual(sorted(a["evenements"][H.cle(r())]["editions"]), ["2027", "2027a"])

    def test_confirmation(self):
        a = {}
        H.mettre_a_jour(a, [r(conf=True)], "2026-11-01")
        self.assertTrue(a["evenements"][H.cle(r())]["editions"]["2027"]["confirmee"])


class Habitude(unittest.TestCase):
    def test_rang_du_week_end(self):
        texte, regle = H.habitude(["2025-05-17", "2026-05-16"])
        self.assertEqual(texte, "3e week-end de mai")
        self.assertEqual(H.estimer(regle, 2027).isoformat(), "2027-05-15")

    def test_course_du_dimanche(self):
        texte, regle = H.habitude(["2025-05-18", "2026-05-17"])
        self.assertEqual(H.estimer(regle, 2027).isoformat(), "2027-05-16")

    def test_dernier_week_end(self):
        texte, regle = H.habitude(["2025-08-30", "2026-08-29"])
        self.assertEqual(texte, "dernier week-end d'août")
        self.assertEqual(H.estimer(regle, 2027).isoformat(), "2027-08-28")

    def test_pas_d_habitude(self):
        self.assertIsNone(H.habitude(["2025-05-17", "2026-06-13"]))
        self.assertIsNone(H.habitude(["2025-05"]))


class Site(unittest.TestCase):
    def archive(self):
        a = {}
        H.mettre_a_jour(a, [r(date="2025-05-17", km=20)], "2025-01-01")
        H.mettre_a_jour(a, [r(date="2026-05-16", km=22)], "2026-01-01")
        return a

    def test_estimation_quand_la_date_est_au_mois(self):
        a = self.archive()
        H.mettre_a_jour(a, [r(date="2027-05")], "2026-11-13")
        info = H.pour_le_site(a, [r(date="2027-05")], "2026-11-13")["Trail des Templiers|Millau"]
        self.assertEqual(info["habitude"], "3e week-end de mai")
        self.assertEqual(info["n"], 2)
        self.assertEqual(info["estimation"], "2027-05-15")
        self.assertEqual(info["estimation_texte"], "samedi 15 mai 2027")
        self.assertEqual(info["precedentes"], [["2025-05-17", [20]], ["2026-05-16", [22]]])

    def test_date_inhabituelle_et_changement(self):
        a = self.archive()
        H.mettre_a_jour(a, [r(date="2027-05-15")], "2026-11-06")
        H.mettre_a_jour(a, [r(date="2027-06-05")], "2026-11-13")
        info = H.pour_le_site(a, [r(date="2027-06-05")], "2026-11-13")["Trail des Templiers|Millau"]
        self.assertTrue(info["inhabituelle"])
        self.assertEqual(info["changements"][0]["avant"], "2027-05-15")

    def test_rien_a_dire(self):
        a = {}
        H.mettre_a_jour(a, [r()], "2026-11-13")
        self.assertEqual(H.pour_le_site(a, [r()], "2026-11-13"), {})

    def test_ecrire(self):
        with tempfile.TemporaryDirectory() as d:
            arch, site = Path(d) / "a" / "editions.json", Path(d) / "historique.json"
            H.ecrire([r(date="2026-05-16"), r(date="2027-05")], "2026-11-13", arch, site)
            self.assertEqual(len(json.loads(arch.read_text())["evenements"]), 1)
            self.assertIn("Trail des Templiers|Millau", json.loads(site.read_text()))


if __name__ == "__main__":
    unittest.main()
