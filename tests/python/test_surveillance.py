"""Surveillance des sources (scripts/surveillance.py)."""
import json
import tempfile
import unittest
from pathlib import Path

import aide  # noqa: F401  (chemins)

import surveillance as S


def lignes(n, **kw):
    base = {"id": "x", "nom": "Trail", "date": "2027-05-16", "ville": "Millau", "distance_km": "20", "denivele_pos_m": "900",
            "lat": "44.1", "site_web": "https://exemple.fr"}
    return [{**base, "id": str(i), **kw} for i in range(n)]


class Comparer(unittest.TestCase):
    def test_stable(self):
        self.assertEqual(S.comparer("rt", S.releve(lignes(100)), S.releve(lignes(95))), [])

    def test_baisse_forte(self):
        al = S.comparer("rt", S.releve(lignes(100)), S.releve(lignes(70)))
        self.assertEqual(al, ["100 → 70 lignes (-30%)"])

    def test_petite_source_pas_d_alerte_pour_quelques_lignes(self):
        self.assertEqual(S.comparer("rt", S.releve(lignes(20)), S.releve(lignes(12))), [])

    def test_source_vide(self):
        self.assertIn("aucune ligne (source vide)", S.comparer("rt", S.releve(lignes(100)), S.releve([])))

    def test_changement_de_format(self):
        al = S.comparer("rt", S.releve(lignes(100)), S.releve(lignes(100, denivele_pos_m="", distance_km="")))
        self.assertTrue(any("colonnes plus jamais renseignées : denivele_pos_m, distance_km" in a for a in al), al)
        moitie = lignes(50) + lignes(50, distance_km="")
        moins = lignes(100)[:20] + lignes(80, distance_km="")
        al = S.comparer("rt", S.releve(moitie), S.releve(moins))
        self.assertEqual(al, ["champ « distance_km » renseigné pour 20% des lignes (contre 50%)"])

    def test_collecte_en_echec(self):
        al = S.comparer("dt", S.releve(lignes(100)), S.releve(lignes(100), "format : colonnes absentes (Latitude)"))
        self.assertIn("format : colonnes absentes (Latitude)", al[0])
        self.assertEqual(S.comparer("dt", None, S.releve(lignes(100), "direct")), [])


class Verifier(unittest.TestCase):
    def test_archive_et_rapport(self):
        with tempfile.TemporaryDirectory() as d:
            arch, md = Path(d) / "a" / "sources.json", Path(d) / "surveillance.md"
            v = lambda src, jour: S.verifier(src, {}, jour, arch, md)
            self.assertEqual(v({"runtrail": lignes(100)}, "2026-11-16"), {})
            self.assertFalse(md.exists())
            self.assertEqual(list(v({"runtrail": lignes(60)}, "2026-11-23")), ["runtrail"])
            self.assertIn("**runtrail**\n- 100 → 60 lignes (-40%)", md.read_text())
            hist = json.loads(arch.read_text())["runtrail"]
            self.assertEqual([h["le"] for h in hist], ["2026-11-16", "2026-11-23"])
            # build suivant sans changement : relevé identique, rien de nouveau à signaler
            v({"runtrail": lignes(60)}, "2026-11-23")
            self.assertFalse(md.exists())
            self.assertEqual(len(json.loads(arch.read_text())["runtrail"]), 2)

    def test_alerte_persistante_signalee_une_fois(self):
        with tempfile.TemporaryDirectory() as d:
            arch, md = Path(d) / "sources.json", Path(d) / "surveillance.md"
            S.verifier({"dt": lignes(10)}, {"dt": "indisponible : timeout"}, "2026-11-16", arch, md)
            self.assertTrue(md.exists())
            S.verifier({"dt": lignes(10)}, {"dt": "indisponible : timeout"}, "2026-11-23", arch, md)
            self.assertFalse(md.exists())


if __name__ == "__main__":
    unittest.main()
