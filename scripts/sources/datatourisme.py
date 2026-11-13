"""Source 'datatourisme' : événements trail de DATAtourisme (open data, Licence Ouverte 2.0).

Base nationale des données touristiques publiée sur data.gouv.fr, alimentée par
les offices de tourisme. On lit l'export simplifié des « fêtes et manifestations »
(datatourisme-fma.csv), on garde les événements dont le nom évoque un trail et dont
la date est à venir, puis on extrait distances et D+ de la description quand elles
y figurent (ex. « Trail des Crêtes 30km - 2200m D+ »).
"""
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import date

NAME = "datatourisme"
DATASET_API = "https://www.data.gouv.fr/api/1/datasets/5b598be088ee387c0c353714/"
RESOURCE_TITLE = "datatourisme-fma.csv"
LICENCE_URL = "https://www.data.gouv.fr/fr/datasets/datatourisme-2/"

TRAIL_WORDS = re.compile(r"\b(trail|ultra[- ]?trail|skyrace|sky race|kilom[eè]tre vertical|kv)\b", re.I)
EXCLUDE_WORDS = re.compile(
    r"\b(vtt|v[ée]lo|cyclo|gravel|canicross|cheval|animations?|bal|cr[êe]pes?|brasero|ravitaillements?|concert|"
    r"exposition|soir[ée]e|repas|conf[ée]rence|projection|march[ée]|buvette|stand|bénévoles?)\b",
    re.I,
)
# « 30 km - 2200 m D+ », « 42km / 2 350m D+ », « 18 km et 900 m de dénivelé »
KM_DPLUS = re.compile(
    r"(\d{1,3}(?:[.,]\d{1,2})?)\s*km\b[^0-9]{0,25}?(\d[\d .  ]{1,6})\s*m(?:\s*(?:de\s*)?(?:d\+|dénivel|denivel|d\s*\+))",
    re.I,
)
KM_ONLY = re.compile(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*km\b", re.I)


def _get(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "trail-agregator/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def parse_courses(text):
    """Liste de (km, d+ ou None) trouvées dans un texte libre."""
    out = {}
    for km, dp in KM_DPLUS.findall(text):
        try:
            k = float(km.replace(",", "."))
            d = int(re.sub(r"[^\d]", "", dp))
        except ValueError:
            continue
        if 5 <= k <= 400 and 0 < d <= 30000:
            out[k] = d
    for km in KM_ONLY.findall(text):
        k = float(km.replace(",", "."))
        if 5 <= k <= 400 and k not in out:
            out[k] = None
    return sorted(out.items(), reverse=True)


def first_date(periods, today):
    """« 2027-06-12<->2027-06-12|... » -> première date de début à venir."""
    starts = sorted(p.split("<->")[0].strip() for p in periods.split("|") if p.strip())
    for s in starts:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) and s >= today:
            return s
    return None


def first_url(contacts):
    m = re.search(r"https?://[^\s|#<>]+", contacts or "")
    return m.group(0) if m else ""


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


CACHE = __import__("pathlib").Path(__file__).resolve().parents[2] / "data" / "sources" / "datatourisme_cache.csv"


def fetch():
    """Rows à jour ; en cas d'échec réseau, dernière version connue (cache)."""
    rows = _fetch()
    fields = list(rows[0].keys()) if rows else []
    if rows:
        with CACHE.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
        return rows
    if CACHE.exists():
        today = date.today().isoformat()
        with CACHE.open(encoding="utf-8") as f:
            rows = [r for r in csv.DictReader(f) if r["date"] >= today]
        print(f"  DATAtourisme : cache utilisé ({len(rows)} courses)", file=sys.stderr)
    return rows


COLONNES = ["Nom_du_POI", "Description", "Periodes_regroupees", "Code_postal_et_commune", "Latitude", "Longitude",
            "URI_ID_du_POI", "Contacts_du_POI"]
ETAT = None  # dernier état de la collecte, lu par la surveillance des sources (scripts/surveillance.py)


def _fetch():
    global ETAT
    try:
        meta = json.loads(_get(DATASET_API, timeout=60))
        url = next((r["url"] for r in meta["resources"] if r["title"] == RESOURCE_TITLE), None)
        if url is None:
            ETAT = f"format : fichier « {RESOURCE_TITLE} » absent du jeu de données"
            print(f"  DATAtourisme : {ETAT}", file=sys.stderr)
            return []
        raw = _get(url).decode("utf-8", errors="replace")
    except Exception as e:  # pas de réseau : la source est simplement ignorée
        ETAT = f"indisponible : {e}"
        print(f"  DATAtourisme indisponible : {e}", file=sys.stderr)
        return []
    csv.field_size_limit(10**9)
    today = date.today().isoformat()
    rows = []
    lecteur = csv.DictReader(io.StringIO(raw))
    absentes = [c for c in COLONNES if c not in (lecteur.fieldnames or [])]
    if absentes:
        ETAT = "format : colonnes absentes (" + ", ".join(absentes) + ")"
        print(f"  DATAtourisme : {ETAT}", file=sys.stderr)
        return []
    ETAT = "direct"
    for r in lecteur:
        name = (r.get("Nom_du_POI") or "").strip()
        desc = r.get("Description") or ""
        if not TRAIL_WORDS.search(name) or EXCLUDE_WORDS.search(name):
            continue
        d = first_date(r.get("Periodes_regroupees") or "", today)
        if not d:
            continue
        cp, _, ville = (r.get("Code_postal_et_commune") or "").partition("#")
        try:
            lat, lon = float(r["Latitude"]), float(r["Longitude"])
        except (TypeError, ValueError):
            lat = lon = ""
        dep = cp[:3] if cp.startswith("97") else cp[:2]
        if dep == "20":  # Corse : 2A / 2B selon le code postal
            dep = "2A" if cp.startswith("200") or cp.startswith("201") else "2B"
        courses = parse_courses(name + " " + desc) or [(None, None)]
        uri = r.get("URI_ID_du_POI", "")
        for km, dp in courses:
            rows.append(
                {
                    "id": f"dt-{slug(name)[:60]}-{d}" + (f"-{('%g' % km).replace('.', '-')}k" if km else ""),
                    "nom": name,
                    "course": ("%g km" % km).replace(".", ",") if km else "",
                    "date": d,
                    "date_confirmee": "true",
                    "ville": ville.strip(),
                    "code_postal": cp.strip(),
                    "departement": dep,
                    "lat": lat,
                    "lon": lon,
                    "distance_km": "%g" % km if km else "",
                    "denivele_pos_m": str(dp) if dp else "",
                    "organisateur": "",
                    "site_web": first_url(r.get("Contacts_du_POI")),
                    "lien_inscription": "",
                    "utmb_world_series": "true" if "by utmb" in name.lower() else "false",
                    "type": "ultra" if km and km >= 80 else "trail",
                    "nocturne": "true" if re.search(r"nocturne|night|nuit", name, re.I) else "false",
                    "prix_eur": "",
                    "notes": "",
                    "source": NAME,
                    "source_url": uri or LICENCE_URL,
                }
            )
    return rows
