"""Collecte des trails sur GoTrail (gotrail.run) -> data/sources/gotrail.csv.

GoTrail autorise l'exploration de ses calendriers (robots.txt). Chaque page de
calendrier régional contient une liste schema.org (ItemList de SportsEvent) :
nom, date exacte, commune, coordonnées GPS et une description qui cite les
distances. La page de chaque événement donne en plus le site de l'organisateur,
la liste complète des distances et souvent le D+ dans le texte de présentation.
Collecte incrémentale : seuls les nouveaux événements sont lus (3 s entre requêtes).
"""
import csv
import html as htmlmod
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
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
OWN = ("gotrail.run", "running.life", "walking.life", "peak-agency", "google.", "gstatic", "apple.com", "schema.org",
       "w3.org", "googletagmanager", "cloudflare", "jsdelivr", "unpkg")
# « 107,5 km, D+3400m », « 52 km et 1 300 m D+ », « 42 km / D+ 2 350 m »
KM_DPLUS_BEFORE = re.compile(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:km|kilom[eè]tres)\b[^0-9]{0,20}?D\s*\+\s*:?\s*(\d[\d .\u202f\u00a0]{0,6})\s*m", re.I)
KM_DPLUS_AFTER = re.compile(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:km|kilom[eè]tres)\b[^0-9]{0,25}?(\d[\d .\u202f\u00a0]{1,6})\s*m(?:\s*(?:de\s*)?(?:d\s*\+|dénivel|denivel))", re.I)


def get(url):
    time.sleep(3)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"  {url} : {e}", file=sys.stderr)
            code = getattr(e, "code", None)
            if code == 404:
                break
            time.sleep(60 * (attempt + 1) if code == 429 else 5 * (attempt + 1))
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


def _f(x):
    return float(x.replace(",", "."))


def details(url):
    """Site de l'organisateur, distances et D+ lus sur la page de l'événement (None si illisible)."""
    html = get(url)
    if not html:
        return None
    site = ""
    for h in re.findall(r'href="(https?://[^"]+)"', html):
        if not any(o in h for o in OWN):
            site = htmlmod.unescape(h)
            break
    body = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html)
    txt = htmlmod.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)))
    cut = txt.find("Événements à proximité")
    txt = txt[:cut] if cut > 0 else txt
    kms = []
    for k in re.findall(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*kilom[eè]tres", txt):
        k = _f(k)
        if 5 <= k <= 400 and k not in kms:
            kms.append(k)
    dplus = {}
    for rx in (KM_DPLUS_BEFORE, KM_DPLUS_AFTER):
        for k, d in rx.findall(txt):
            k, d = _f(k), int(re.sub(r"\D", "", d) or 0)
            if 3 <= k <= 400 and 0 < d <= 30000:
                dplus.setdefault(k, d)
    return site, kms, dplus


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
    known = defaultdict(list)
    if OUT.exists():
        with OUT.open(encoding="utf-8") as f:
            rd = csv.DictReader(f)
            if "detail" in (rd.fieldnames or []):
                for r in rd:
                    if r["date"] >= today and r["detail"] == "1":
                        known[r["source_url"]].append(r)
    rows, todo = [], 0
    for url, ev in events.items():
        d = (ev.get("startDate") or "")[:10]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) or d < today:
            continue
        if url in known:
            rows.extend(known[url])
            continue
        todo += 1
        name = htmlmod.unescape(ev.get("name", "")).strip()
        desc = htmlmod.unescape(ev.get("description", ""))
        loc = ev.get("location") or {}
        ville = (loc.get("address") or {}).get("addressLocality", "").strip()
        geo = loc.get("geo") or {}
        det = details(url)
        site, kms, dplus = det if det else ("", [], {})
        courses = [(k, next((dp for kk, dp in dplus.items() if abs(kk - k) <= max(1.0, 0.05 * k)), None)) for k in kms]
        if not courses:
            courses = parse_courses(name + " " + desc) or [(None, None)]
        for km, dp in courses:
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
                "site_web": site,
                "lien_inscription": "",
                "utmb_world_series": "true" if "by utmb" in name.lower() else "false",
                "type": "ultra" if km and km >= 80 else "trail",
                "nocturne": "true" if re.search(r"nocturne|night|nuit", name + " " + desc, re.I) else "false",
                "prix_eur": "",
                "notes": "",
                "source_url": url,
                "detail": "1" if det else "0",
            })
        if todo % 50 == 0:
            print(f"  {todo} pages lues, {len(rows)} formats", flush=True)
    if not rows:
        sys.exit("Aucune course récupérée : fichier non modifié")
    rows.sort(key=lambda r: (r["date"], r["nom"], r["distance_km"]))
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS + ["detail"])
        w.writeheader()
        w.writerows(rows)
    n_dp = sum(1 for r in rows if r["denivele_pos_m"])
    n_site = len({r["source_url"] for r in rows if r["site_web"]})
    print(f"{len(rows)} formats ({len(events)} événements) dans {OUT.name} : {n_dp} avec D+, {n_site} événements avec site web")


if __name__ == "__main__":
    main()
