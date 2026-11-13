"""État des inscriptions (enrich.apply_inscriptions_file, site_data)."""
import json
import tempfile
import unittest
from pathlib import Path

import aide  # noqa: F401  (chemins)

import enrich
import site_data

ENTETE = "nom,ville,distance_km,statut,ouverture,mode,lien_inscription,prix_eur,releve_le,source_url\n"


def course(km, nom="Trail des Templiers", ville="Millau", **kw):
    r = {"id": f"t-{km}", "nom": nom, "course": "", "ville": ville, "distance_km": km, "denivele_pos_m": None,
         "lien_inscription": "", "prix_eur": None, "date": "2027-10-20", "lat": None, "lon": None}
    r.update(kw)
    return r


class Inscriptions(unittest.TestCase):
    def appliquer(self, lignes, races):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "inscriptions.csv"
            p.write_text(ENTETE + lignes, encoding="utf-8")
            return enrich.apply_inscriptions_file(races, p)

    def test_evenement_entier_et_format(self):
        races = [course(20.0), course(80.0), course(30.0, nom="Autre trail")]
        n = self.appliquer("Templiers,Millau,,ouvertes,2026-11-02,tirage,https://insc.example,,2026-11-12,\n"
                           "Templiers,Millau,80,ouvertes,,,,\"95,5\",2026-11-12,\n", races)
        self.assertEqual(n, 3)
        self.assertEqual(races[0]["inscription"], {"statut": "ouvertes", "ouverture": "2026-11-02", "mode": "tirage",
                                                   "releve_le": "2026-11-12"})
        self.assertEqual(races[0]["lien_inscription"], "https://insc.example")
        self.assertIsNone(races[0]["prix_eur"])
        self.assertEqual(races[1]["prix_eur"], 95.5)
        self.assertNotIn("inscription", races[2])

    def test_lignes_invalides_ignorees(self):
        races = [course(20.0)]
        n = self.appliquer("Templiers,Millau,,ouvert,,,,,2026-11-12,\n"       # statut inconnu
                           "Templiers,Millau,,ouvertes,12/11/2026,,,,2026-11-12,\n"  # date mal écrite
                           "Templiers,Millau,,ouvertes,,,,,,\n"                # pas de date de relevé
                           "Templiers,Millau,,complet,,,javascript:alert(1),,2026-11-12,\n", races)
        self.assertEqual(n, 1)
        self.assertEqual(races[0]["inscription"]["statut"], "complet")
        self.assertEqual(races[0]["lien_inscription"], "")  # lien non http refusé

    def test_index_table_creuse(self):
        races = [course(20.0, id="a", prix_eur=35.0, inscription={"statut": "ouvertes", "releve_le": "2026-11-12"}),
                 course(40.0, id="b")]
        for r in races:
            r.update({k: r.get(k) for k in site_data.INDEX_FIELDS})
        idx = json.loads(json.dumps(site_data.build_index(races, "t")))
        self.assertEqual(idx["inscriptions"], {"a": {"statut": "ouvertes", "releve_le": "2026-11-12", "prix": 35}})
        dec = site_data.decode_index(idx)
        self.assertEqual(dec[0]["inscription"], {"statut": "ouvertes", "releve_le": "2026-11-12"})
        self.assertNotIn("inscription", dec[1])

    def test_fichier_versionne_lisible(self):
        self.assertEqual(enrich.INSCR_CSV.read_text(encoding="utf-8"), ENTETE)


if __name__ == "__main__":
    unittest.main()
