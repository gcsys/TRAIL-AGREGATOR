"""Envoi FTP vers OVH (scripts/deploy_ftp.py) et source « membres »."""
import json
import tempfile
import unittest
from pathlib import Path

import aide  # noqa: F401  (chemins)
import deploy_ftp
from sources import membres


class FauxServeur:
    """Remplace Remote : fichiers en mémoire."""

    def __init__(self, fichiers=None):
        self.fichiers = dict(fichiers or {})
        self.ordre = []

    def read(self, rel):
        return self.fichiers.get(rel)

    def put(self, rel, data):
        self.fichiers[rel] = data
        self.ordre.append(rel)

    def delete(self, rel):
        self.fichiers.pop(rel, None)


class DeploiementTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.site = Path(self.tmp.name)
        for rel, txt in {"index.html": "<html>", "sw.js": "sw", "app.js": "a", "data/index.json": "{}",
                         "api/config.php": "SECRET", "api/auth.php": "<?php"}.items():
            p = self.site / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(txt)

    def tearDown(self):
        self.tmp.cleanup()

    def test_premier_envoi_complet_sans_config_et_accueil_en_dernier(self):
        srv = FauxServeur()
        up, rm = deploy_ftp.deploy(self.site, srv, log=lambda *_: None)
        self.assertNotIn("api/config.php", up)
        self.assertNotIn("api/config.php", srv.fichiers)
        self.assertEqual(rm, [])
        self.assertEqual(srv.ordre[-3:], ["index.html", "sw.js", deploy_ftp.MANIFEST])
        self.assertIn("data/index.json", json.loads(srv.fichiers[deploy_ftp.MANIFEST]))

    def test_envoi_suivant_seulement_les_changements_et_suppressions_connues(self):
        srv = FauxServeur({"config-a-la-main.php": b"x"})
        deploy_ftp.deploy(self.site, srv, log=lambda *_: None)
        (self.site / "app.js").write_text("b")
        (self.site / "data/index.json").unlink()
        srv.ordre.clear()
        up, rm = deploy_ftp.deploy(self.site, srv, log=lambda *_: None)
        self.assertEqual(up, ["app.js"])
        self.assertEqual(rm, ["data/index.json"])
        self.assertIn("config-a-la-main.php", srv.fichiers)  # jamais touché : absent du manifeste

    def test_simulation(self):
        srv = FauxServeur()
        up, _ = deploy_ftp.deploy(self.site, srv, dry_run=True, log=lambda *_: None)
        self.assertTrue(up)
        self.assertEqual(srv.fichiers, {})


class SourceMembresTest(unittest.TestCase):
    def test_lecture_export_api(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "membres.csv"
            self.assertEqual(membres.fetch(p), [])  # site pas encore sur OVH
            p.write_text("id,nom,date,ville,distance_km,notes\n"
                         "membre-4,Trail du Test,2027-06-01,Millau,12,'-- remarque\n"
                         "autre-1,Intrus,2027-06-01,Millau,12,\n", encoding="utf-8")
            rows = membres.fetch(p)
        self.assertEqual([r["id"] for r in rows], ["membre-4"])
        self.assertEqual(rows[0]["source"], "membres")
        self.assertEqual(rows[0]["notes"], "-- remarque")


if __name__ == "__main__":
    unittest.main()
