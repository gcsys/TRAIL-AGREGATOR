"""Collecte des trails sur GoTrail (gotrail.run) -> data/sources/gotrail.csv.

GoTrail autorise l'exploration de ses calendriers (robots.txt). Chaque page de
calendrier régional contient une liste schema.org (ItemList de SportsEvent) :
nom, date exacte, commune, coordonnées GPS et une description qui cite les
distances. Pas de D+ en général. Une requête toutes les ~1,5 s.
"""
import csv
import html as htmlmod
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources.datatourisme import parse_courses, slug  # noqa: E402

BASE = "https://gotrail.run/calendrier-trails/france/"
REGIONS = ["occitanie", "provence-alpes-cote-dazur", "auvergne-rhone-alpes"]
UA = "Mozilla/5.0 (compatible; trail-agregator/1.0; projet perso non commercial)"
OUT = Path(__file__).resolve().parents[1] / "data" / "sources" / "gotrail.csv"
FIELDS = ["id", "nom", "course", "date", "date_confirmee", "ville", "code_postal", "departement", "lat", "lon",
          "distance_km", "denivele_pos_m", "organisateur", "site_web", "lien_inscription", "utmb_world_series",
          "type", "nocturne", "prix_eur", "notes", "source_url"]


def get(url):
    time.sleep(1.5)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"  {url} : {e}", file=sys.stderr)
            if getattr(e, "code", None) == 404:
                break
            time.sleep(5 * (attempt + 1))
    return None


def events_of(html):
    for block in re.findall(r'<script type="application/ld\+json">([\s\S]*?)</script>', html):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("@type") == "ItemList":
            for it in data.get("itemListElement", []):
                ev = it.get("item") or {}
                if ev.get("@type") == "SportsEvent":
                    yield ev


def main():
    today = date.today().isoformat()
    events = {}
    for reg in sys.argv[1:] or REGIONS:
        for page in range(1, 60):
            html = get(BASE + reg + (f"?page={page}" if page > 1 else ""))
            if not html:
                break
            new = 0
            for ev in events_of(html):
                if ev.get("url") and ev["url"] not in events:
                    events[ev["url"]] = ev
                    new += 1
            print(f"{reg} p{page}: {new} nouveaux ({len(events)} au total)", flush=True)
            if new == 0:
                break
    rows = []
    for url, ev in events.items():
        d = (ev.get("startDate") or "")[:10]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) or d < today:
            continue
        name = htmlmod.unescape(ev.get("name", "")).strip()
        desc = htmlmod.unescape(ev.get("description", ""))
        loc = ev.get("location") or {}
        ville = (loc.get("address") or {}).get("addressLocality", "").strip()
        geo = loc.get("geo") or {}
        for km, dp in parse_courses(name + " " + desc) or [(None, None)]:
            rows.append({
                "id": f"gt-{slug(url.rsplit('/', 1)[-1])[:60]}-{d}" + (f"-{('%g' % km).replace('.', '-')}k" if km else ""),
                "nom": name,
                "course": ("%g km" % km).replace(".", ",") if km else "",
                "date": d,
                "date_confirmee": "true",
                "ville": ville,
                "code_postal": "",
                "departement": "",
                "lat": geo.get("latitude", ""),
                "lon": geo.get("longitude", ""),
                "distance_km": "%g" % km if km else "",
                "denivele_pos_m": str(dp) if dp else "",
                "organisateur": "",
                "site_web": "",
                "lien_inscription": "",
                "utmb_world_series": "true" if "by utmb" in name.lower() else "false",
                "type": "ultra" if km and km >= 80 else "trail",
                "nocturne": "true" if re.search(r"nocturne|night|nuit", name + " " + desc, re.I) else "false",
                "prix_eur": "",
                "notes": "",
                "source_url": url,
            })
    if not rows:
        sys.exit("Aucune course récupérée : fichier non modifié")
    rows.sort(key=lambda r: (r["date"], r["nom"], r["distance_km"]))
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} formats ({len(events)} événements) écrits dans {OUT.name}")


if __name__ == "__main__":
    main()
