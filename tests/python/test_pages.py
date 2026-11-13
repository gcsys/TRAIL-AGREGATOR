"""Pages par événement (scripts/pages.py)."""
import json
import re
import unittest
import xml.dom.minidom

import aide  # noqa: F401  (chemins)

import pages as P


def f(nom="Trail des Templiers", ville="Millau", date="2027-05-16", km=20.0, dplus=900, source="datatourisme", **kw):
    r = {"id": f"{nom}-{km}", "nom": nom, "course": f"{km:g} km" if km else "", "date": date, "date_confirmee": True,
         "ville": ville, "code_postal": "12100", "lat": 44.1, "lon": 3.08, "distance_km": km, "denivele_pos_m": dplus,
         "prix_eur": None, "organisateur": "", "site_web": "https://templiers.example", "lien_inscription": "",
         "heure_depart": "", "source": source, "source_url": "https://data.datatourisme.fr/x", "departement_code": "12",
         "departement": "Aveyron", "region_code": "76", "region": "Occitanie"}
    r.update(kw)
    return r


class Regroupement(unittest.TestCase):
    def test_evenements_et_slugs(self):
        evs = P.evenements([f(km=42.0), f(km=20.0), f(nom="Trail des Templiers", ville="Nant"),
                            f(nom="TRAIL DES TEMPLIERS", ville="Millau", km=80.0, date="2027-05-15")])
        self.assertEqual([len(e) for e in evs], [3, 1])
        self.assertEqual([r["distance_km"] for r in evs[0]], [80.0, 20.0, 42.0])
        self.assertEqual(P.attribuer_slugs(evs), ["trail-des-templiers-millau-2027", "trail-des-templiers-nant-2027"])
        self.assertEqual(P.attribuer_slugs([[f()], [f()]]), ["trail-des-templiers-millau-2027", "trail-des-templiers-millau-2027-2"])

    def test_indexable_seulement_sources_ouvertes(self):
        self.assertTrue(P.indexable([f(), f(km=42.0)]))
        self.assertFalse(P.indexable([f(), f(km=42.0, source="runtrail")]))


class Page(unittest.TestCase):
    def test_page_indexable(self):
        rows = [f(km=80.0, date="2027-05-15", dplus=4000, prix_eur=95.0, heure_depart="05:00"), f()]
        h = P.page(rows, "trail-des-templiers-millau-2027", "2026-11-16T04:00:00+00:00")
        self.assertIn('<link rel="canonical" href="https://gcsys.github.io/TRAIL-AGREGATOR/course/trail-des-templiers-millau-2027/">', h)
        self.assertNotIn("noindex", h)
        self.assertIn("samedi 15 mai 2027 au dimanche 16 mai", h)
        self.assertIn("95 €", h)
        self.assertIn("DATAtourisme</a> (Licence Ouverte 2.0)", h)
        ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', h, re.S).group(1))
        self.assertEqual((ld["@type"], ld["startDate"], ld["endDate"]), ("SportsEvent", "2027-05-15", "2027-05-16"))
        self.assertEqual(ld["location"]["geo"]["latitude"], 44.1)
        self.assertEqual(len(ld["subEvent"]), 2)

    def test_page_noindex_date_a_confirmer_et_echappement(self):
        h = P.page([f(nom="Trail <x> </script>", source="catalogue", date="2027-05", date_confirmee=False, dplus=None)],
                   "trail-x-millau-2027", "2026-11-16")
        self.assertIn('<meta name="robots" content="noindex">', h)
        self.assertNotIn("canonical", h)
        self.assertIn("Jour à préciser.", h)
        self.assertIn("Trail &lt;x&gt;", h)
        self.assertEqual(h.count("</script>"), 1)  # le nom ne ferme pas le bloc JSON-LD
        self.assertIn(">inconnu<", h)

    def test_sitemap(self):
        x = P.sitemap([P.SITE, P.SITE + "course/a/"])
        self.assertEqual(len(xml.dom.minidom.parseString(x.encode()).getElementsByTagName("loc")), 2)


if __name__ == "__main__":
    unittest.main()
