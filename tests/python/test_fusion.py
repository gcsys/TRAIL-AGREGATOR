"""Fusion des sources (scripts/enrich.py)."""
import csv
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aide import course

import enrich


def ev(*rows):
    return list(rows)


class Outils(unittest.TestCase):
    def test_tokens_ignore_les_mots_vides(self):
        self.assertEqual(enrich.tokens("Trail des Gorges de l'Ardèche 2027"), {"gorges", "ardeche"})

    def test_distances_proches(self):
        self.assertTrue(enrich.close(20, 21.5))
        self.assertTrue(enrich.close(100, 109))  # 10 %
        self.assertFalse(enrich.close(20, 23))
        self.assertFalse(enrich.close(None, 20))

    def test_ecart_en_mois(self):
        self.assertEqual(enrich._month_gap("2027-05", "2027-06-12"), 1)
        self.assertEqual(enrich._month_gap("2026-12-01", "2027-01"), 1)
        self.assertEqual(enrich._month_gap("", "2027-01"), 99)


class MemeEvenement(unittest.TestCase):
    def test_meme_commune_meme_mois_nom_commun(self):
        a = course(nom="Trail des Templiers", ville="Millau", date="2027-10-24")
        b = course(nom="Festival des Templiers", ville="Millau", date="2027-10-24", source="runtrail")
        self.assertTrue(enrich._same_event([a], [b]))

    def test_meme_commune_nom_colle(self):
        a = course(nom="La Saintlo", ville="Saint-Laurent-d'Agny", date="2027-01")
        b = course(nom="La Saint Lo", ville="Saint-Laurent-d'Agny", date="2027-01-17", source="runtrail")
        self.assertTrue(enrich._same_event([a], [b]))

    def test_meme_commune_noms_differents(self):
        a = course(nom="Trail des Templiers", ville="Millau", date="2027-10-24")
        b = course(nom="Course du Viaduc", ville="Millau", date="2027-10-10", source="runtrail")
        self.assertFalse(enrich._same_event([a], [b]))

    def test_date_au_mois_decalee_d_un_mois(self):
        a = course(nom="Trail du Larzac Sauvage", ville="Millau", date="2027-05")
        b = course(nom="Trail du Larzac Sauvage", ville="Millau", date="2027-06-05", source="runtrail")
        self.assertTrue(enrich._same_event([a], [b]))

    def test_dates_exactes_mois_differents(self):
        a = course(nom="Trail du Larzac", ville="Millau", date="2027-05-29")
        b = course(nom="Trail du Larzac", ville="Millau", date="2027-06-05", source="runtrail")
        self.assertFalse(enrich._same_event([a], [b]))

    def test_commune_voisine_nom_quasi_identique(self):
        a = course(nom="Trail des Crêtes du Lévezou", ville="Salles-Curan", date="2027-06-12")
        b = course(nom="Trail des crêtes du Levezou", ville="Villefranche-de-Panat", date="2027-06-12", source="gotrail")
        self.assertTrue(enrich._same_event([a], [b]))

    def test_commune_voisine_nom_generique(self):
        # « Trail nocturne » seul ne suffit pas à identifier un événement
        a = course(nom="Trail nocturne", ville="Salles-Curan", date="2027-06-12")
        b = course(nom="Trail nocturne", ville="Rodez", date="2027-06-12", source="gotrail")
        self.assertFalse(enrich._same_event([a], [b]))

    def test_nom_generique_meme_commune(self):
        # dans la même commune et le même mois, un nom générique suffit
        a = course(nom="Trail nocturne", ville="Rodez", date="2027-06-12")
        b = course(nom="Trail nocturne", ville="Rodez", date="2027-06-12", source="gotrail")
        self.assertTrue(enrich._same_event([a], [b]))

    def test_nom_distinctif_identique_commune_voisine(self):
        a = course(nom="Beille Trail", ville="Les Cabannes", departement="09", date="2027-01-03")
        b = course(nom="Beille Trail", ville="Albiès", departement="09", date="2027-01-03", source="gotrail")
        self.assertTrue(enrich._same_event([a], [b]))

    def test_commune_voisine_autre_departement(self):
        a = course(nom="Trail des Crêtes du Lévezou", ville="Salles-Curan", date="2027-06-12")
        b = course(nom="Trail des Crêtes du Lévezou", ville="Lodève", departement="34", date="2027-06-12", source="gotrail")
        self.assertFalse(enrich._same_event([a], [b]))


class Fusion(unittest.TestCase):
    def test_enrichit_l_evenement_du_catalogue(self):
        cat = [course(id="c1", nom="Trail des Templiers", date="2027-10", km="80"),
               course(id="c2", nom="Trail des Templiers", date="2027-10", km="35")]
        rt = [course(id="r1", nom="Trail des Templiers", date="2027-10-24", km="81", dplus="3500", source="runtrail", date_confirmee="oui",
                     site_web="https://example.org", organisateur="Asso"),
              course(id="r2", nom="Trail des Templiers", date="2027-10-24", km="12", dplus="400", source="runtrail")]
        out = enrich.merge(cat + rt)
        par_id = {r["id"]: r for r in out}
        self.assertEqual(set(par_id), {"c1", "c2", "r2"})  # r1 fusionné dans c1, r2 ajouté comme format
        self.assertEqual(par_id["c1"]["date"], "2027-10-24")
        self.assertTrue(par_id["c1"]["date_confirmee"])
        self.assertEqual(par_id["c1"]["denivele_pos_m"], 3500)
        self.assertEqual(par_id["c1"]["site_web"], "https://example.org")
        self.assertIsNone(par_id["c2"]["denivele_pos_m"])  # pas de format proche de 35 km
        self.assertEqual(par_id["c2"]["site_web"], "https://example.org")  # site de l'événement
        self.assertEqual(par_id["r2"]["nom"], "Trail des Templiers")

    def test_evenement_inconnu_ajoute(self):
        cat = [course(id="c1", nom="Trail des Templiers", date="2027-10-24")]
        rt = [course(id="r1", nom="Ronde des Causses", date="2027-10-24", source="runtrail")]
        self.assertEqual({r["id"] for r in enrich.merge(cat + rt)}, {"c1", "r1"})

    def test_deux_sources_complementaires_entre_elles(self):
        # un événement absent du catalogue, vu par RunTrail puis GoTrail : une seule fiche
        rt = [course(id="r1", nom="Trail de la Pouncho", ville="Agde", departement="34", date="2027-03-14", source="runtrail")]
        gt = [course(id="g1", nom="Trail de la Pouncho", ville="Agde", departement="34", date="2027-03-14", source="gotrail")]
        self.assertEqual([r["id"] for r in enrich.merge(rt + gt)], ["r1"])

    def test_deux_sources_formats_complementaires(self):
        # RunTrail connaît le 20 et le 40 km, GoTrail le 21 (doublon du 20) et le 10 km, avec la date exacte
        rt = [course(id="r20", nom="Trail de la Pouncho", ville="Agde", departement="34", date="2027-03", km="20", source="runtrail",
                     dplus="600"),
              course(id="r40", nom="Trail de la Pouncho", ville="Agde", departement="34", date="2027-03", km="40", source="runtrail")]
        gt = [course(id="g21", nom="Trail de la Pouncho", ville="Agde", departement="34", date="2027-03-14", km="21", source="gotrail",
                     site_web="https://pouncho.example"),
              course(id="g10", nom="Trail de la Pouncho", ville="Agde", departement="34", date="2027-03-14", km="10", source="gotrail")]
        out = {r["id"]: r for r in enrich.merge(rt + gt)}
        self.assertEqual(set(out), {"r20", "r40", "g10"})
        self.assertEqual(out["r20"]["date"], "2027-03-14")
        self.assertEqual(out["r20"]["site_web"], "https://pouncho.example")
        self.assertEqual(out["r20"]["denivele_pos_m"], 600)
        self.assertEqual(out["g10"]["date"], "2027-03-14")

    def test_source_sans_departement_rapprochee_par_le_point(self):
        # GoTrail ne donne pas le département : il est déduit des coordonnées avant la fusion
        import build_db
        cat = [course(id="c1", nom="Beille Trail", ville="Les Cabannes", departement="09", date="2027-01-03", km="20")]
        gt = [course(id="g1", nom="Beille Trail", ville="Albiès", departement="", date="2027-01-03", km="20", source="gotrail",
                     lat="42.7713", lon="1.7225")]
        build_db.departement_par_point(cat + gt, build_db.load_layer("departements"))
        self.assertEqual(gt[0]["departement_saisi"], "09")
        self.assertEqual([r["id"] for r in enrich.merge(cat + gt)], ["c1"])

    def test_ne_remplace_pas_une_date_exacte(self):
        cat = [course(id="c1", nom="Trail des Templiers", date="2027-10-24")]
        rt = [course(id="r1", nom="Trail des Templiers", date="2027-10-24", source="runtrail", date_confirmee="")]
        out = enrich.merge(cat + rt)
        self.assertEqual(out[0]["date"], "2027-10-24")


class FichierDenivele(unittest.TestCase):
    def test_complete_le_dplus_et_le_site(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "denivele.csv"
            with p.open("w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, ["nom", "ville", "distance_km", "denivele_pos_m", "site_web"])
                w.writeheader()
                w.writerow({"nom": "Templiers", "ville": "Millau", "distance_km": "80", "denivele_pos_m": "3500", "site_web": "https://x.fr"})
                w.writerow({"nom": "Templiers", "ville": "Millau", "distance_km": "abc", "denivele_pos_m": "1"})
            races = [course(id="a", nom="Trail des Templiers", km="81"), course(id="b", nom="Trail des Templiers", km="35"),
                     course(id="c", nom="Trail des Templiers", km="80", dplus="3000")]
            with mock.patch.object(enrich, "DPLUS_CSV", p):
                enrich.apply_dplus_file(races)
        self.assertEqual(races[0]["denivele_pos_m"], 3500.0)
        self.assertEqual(races[0]["site_web"], "https://x.fr")
        self.assertIsNone(races[1]["denivele_pos_m"])
        self.assertEqual(races[2]["denivele_pos_m"], 3000.0)  # une valeur existante n'est pas écrasée


if __name__ == "__main__":
    unittest.main()
