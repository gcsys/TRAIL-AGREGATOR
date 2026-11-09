"""Collecte des trails sur RunTrail (runtrail.run) -> data/sources/runtrail.csv.

RunTrail autorise l'exploration de ses pages (robots.txt). Les pages « course »
contiennent des données structurées schema.org (SportsEvent) avec, pour chaque
format, la distance et souvent le D+ (« Trail - 20 km - 662 mD+ »).

Lancé par .github/workflows/collect-runtrail.yml (le conteneur de dev n'a pas
accès au site). Une requête toutes les ~1,5 s pour rester discret.
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

BASE = "https://www.runtrail.run"
REGIONS = ["occitanie", "provence-alpes-cote-d-azur", "auvergne-rhone-alpes"]
UA = "Mozilla/5.0 (compatible; trail-agregator/1.0; projet perso non commercial)"
OUT = Path(__file__).resolve().parents[1] / "data" / "sources" / "runtrail.csv"
DELAY = 3.0
FIELDS = ["id", "nom", "course", "date", "date_confirmee", "ville", "code_postal", "departement", "lat", "lon",
          "distance_km", "denivele_pos_m", "organisateur", "site_web", "lien_inscription", "utmb_world_series",
          "type", "nocturne", "prix_eur", "notes", "source_url"]
SKIP_FORMAT = re.compile(r"\b(marche|randonn|rando|enfants?|kids?|jeunes|poussins?|benjamins?|minimes|nordique|"
                         r"canicross|vtt|v[ée]lo|relais enfant|[ée]veil)\b", re.I)
KM = re.compile(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*km\b", re.I)
DPLUS = re.compile(r"(\d[\d\s  .]{0,6})\s*m\s*D\s*\+", re.I)
DEP = re.compile(r"\((\d{2}|2A|2B|97\d)\)")

_last = 0.0


def get(url):
    global _last
    wait = DELAY - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr"})
            with urllib.request.urlopen(req, timeout=60) as r:
                _last = time.time()
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"  {url} : {e}", file=sys.stderr)
            code = getattr(e, "code", None)
            if code == 404:
                break
            if code == 429:  # le site demande de ralentir : on attend franchement
                try:
                    pause = int(e.headers.get("Retry-After", 0))
                except (TypeError, ValueError):
                    pause = 0
                time.sleep(max(pause, 60 * (attempt + 1)))
            else:
                time.sleep(5 * (attempt + 1))
    _last = time.time()
    return None


def list_region(region):
    """{chemin /event/...: département} pour les trails d'une région."""
    found = {}
    for page in range(1, 120):
        html = get(f"{BASE}/events?region={region}&sport=trail&page={page}")
        if not html:
            break
        parts = re.split(r'href="(/event/\d+-[^"#?]+)"', html)
        new = 0
        for i in range(1, len(parts), 2):
            path = parts[i]
            m = DEP.search(htmlmod.unescape(re.sub(r"<[^>]+>", " ", parts[i + 1][:4000])))
            if path not in found:
                new += 1
                found[path] = m.group(1) if m else ""
            elif not found[path] and m:
                found[path] = m.group(1)
        print(f"{region} p{page}: {new} nouveaux ({len(found)} au total)", flush=True)
        if new == 0:
            break
    return found


def flatten(x):
    if isinstance(x, list):
        for y in x:
            yield from flatten(y)
    elif isinstance(x, dict):
        yield x


def sports_event(html):
    for block in re.findall(r'<script type="application/ld\+json">([\s\S]*?)</script>', html):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for d in flatten(data):
            if d.get("@type") == "SportsEvent":
                return d
    return None


def num(s):
    return float(s.replace(",", "."))


def parse_event(path, dep, today):
    html = get(BASE + path)
    if not html:
        return None
    ev = sports_event(html)
    if not ev:
        return []
    name = htmlmod.unescape(ev.get("name", "")).strip()
    addr = (ev.get("location") or {}).get("address") or {}
    ville = htmlmod.unescape(addr.get("addressLocality", "")).strip()
    geo = (ev.get("location") or {}).get("geo") or {}
    subs = list(flatten(ev.get("subEvent") or [])) or [ev]
    rows, seen = [], set()
    for s in subs:
        label = htmlmod.unescape(s.get("name", "")).strip()
        if SKIP_FORMAT.search(label):
            continue
        d = (s.get("startDate") or ev.get("startDate") or "")[:10]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) or d < today:
            continue
        km_m = KM.search(label)
        km = num(km_m.group(1)) if km_m else None
        if km is not None and not 3 <= km <= 400:
            km = None
        dp_m = DPLUS.search(label)
        dp = int(re.sub(r"\D", "", dp_m.group(1))) if dp_m else None
        if dp is not None and not 0 < dp <= 30000:
            dp = None
        key = (km, d)
        if key in seen:
            continue
        seen.add(key)
        course = re.sub(r"\s*-\s*\d[\d\s.,]*\s*m\s*D\s*\+.*$", "", label, flags=re.I).strip(" -")
        rid = path.split("/")[-1].split("-")[0]
        rows.append({
            "id": f"rt-{rid}-{d}" + (f"-{('%g' % km).replace('.', '-')}k" if km else ""),
            "nom": name,
            "course": course or (("%g km" % km).replace(".", ",") if km else ""),
            "date": d,
            "date_confirmee": "true",
            "ville": ville,
            "code_postal": "",
            "departement": dep,
            "lat": geo.get("latitude", ""),
            "lon": geo.get("longitude", ""),
            "distance_km": "%g" % km if km else "",
            "denivele_pos_m": str(dp) if dp else "",
            "organisateur": "",
            "site_web": "",
            "lien_inscription": "",
            "utmb_world_series": "true" if "by utmb" in name.lower() else "false",
            "type": "ultra" if km and km >= 80 else "trail",
            "nocturne": "true" if re.search(r"nocturne|night|nuit", name + " " + label, re.I) else "false",
            "prix_eur": "",
            "notes": "",
            "source_url": BASE + path,
        })
    return rows


def main():
    regions = sys.argv[1:] or REGIONS
    today = date.today().isoformat()
    events = {}
    for reg in regions:
        events.update(list_region(reg))
    # Mode incrémental : les événements déjà collectés (et encore à venir) sont
    # gardés tels quels ; on ne lit que les nouveaux, pour ménager le site.
    known = {}
    if OUT.exists():
        with OUT.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["date"] >= today:
                    known.setdefault(r["source_url"][len(BASE):], []).append(r)
    rows = [r for path, rs in known.items() if path in events for r in rs]
    todo = [(p, d) for p, d in events.items() if p not in known]
    print(f"{len(events)} événements, {len(todo)} nouveaux à lire", flush=True)
    failed = 0
    for i, (path, dep) in enumerate(todo, 1):
        got = parse_event(path, dep, today)
        if got is None:
            failed += 1
        else:
            rows.extend(got)
        if i % 50 == 0:
            print(f"  {i}/{len(todo)} événements, {len(rows)} formats", flush=True)
    print(f"{failed} pages illisibles (retentées au prochain passage)")
    if not rows:
        sys.exit("Aucune course récupérée : fichier non modifié")
    rows.sort(key=lambda r: (r["date"], r["nom"], r["distance_km"]))
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    n_dp = sum(1 for r in rows if r["denivele_pos_m"])
    print(f"{len(rows)} formats écrits dans {OUT.name}, dont {n_dp} avec D+")


if __name__ == "__main__":
    main()
