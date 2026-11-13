"""Nouveautés : courses ajoutées, dates confirmées et D+ ajoutés, en page (site/nouveautes/) et en flux Atom
(site/flux/ : national, « dates confirmées », par région, par département).

- data/archive/premiere_vue.json (versionné, mis à jour par build_db.py) : pour chaque événement (même clé
  que l'historique des éditions : nom sans numéro d'édition ni année, et commune), le jour du build où il
  est apparu, la dernière date confirmée relevée et le nombre de formats dont le D+ est connu, avec le jour
  où ils ont changé. Ce qui arrive d'un coup (premier build, nouvelle source) n'est pas une nouveauté :
  ce sont de nouvelles données, pas de nouvelles courses.
- La page et les flux sont générés au déploiement à partir de races.json (non versionnés).

Bibliothèque standard uniquement.

    python scripts/nouveautes.py      # écrit site/nouveautes/index.html et site/flux/*.xml
"""
import html
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import historique  # noqa: E402  (même clé d'événement)

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data" / "archive" / "premiere_vue.json"
RACES = ROOT / "site" / "data" / "races.json"
PAGE = ROOT / "site" / "nouveautes" / "index.html"
FLUX = ROOT / "site" / "flux"
SITE = "https://gcsys.github.io/TRAIL-AGREGATOR/"

MASSIF = (100, 0.05)  # au-delà de 100 événements et de 5 % de la base d'un coup : nouvelle source, pas des nouveautés
SEMAINES_PAGE = 4
JOURS_FLUX = 60
MAX_FLUX = 100
E = html.escape

TYPES = {  # clé : (titre de section, préfixe d'entrée de flux, champ « le » de l'archive)
    "nouvelle": ("Nouvelles courses", "Nouvelle course", "le"),
    "confirmee": ("Dates confirmées", "Date confirmée", "conf_le"),
    "dplus": ("D+ ajoutés", "D+ ajouté", "dplus_le"),
}


# ----- Archive -----

def _etat(rows):
    """Date confirmée (premier jour confirmé) et nombre de formats avec D+ d'un événement."""
    conf = min((r["date"] for r in rows if r.get("date_confirmee") and len(r["date"]) == 10), default=None)
    return conf, sum(1 for r in rows if r.get("denivele_pos_m") is not None)


def _massif(n, base):
    return n > max(MASSIF[0], MASSIF[1] * base)


def noter(vues, races, aujourdhui):
    """Met `vues` à jour avec `races`. Renvoie le nombre de nouveautés retenues par type."""
    par_cle = {}
    for r in races:
        if r.get("date"):
            par_cle.setdefault(historique.cle(r), []).append(r)
    premier, base = not vues, len(vues)
    nouveaux = [k for k in par_cle if k not in vues]
    confirmes, dplus = [], []
    for k, rows in par_cle.items():
        if k in vues:
            v = vues[k]
            conf, nd = _etat(rows)
            if conf and conf != v.get("conf"):
                confirmes.append((k, conf))
            if nd > v.get("dplus", 0):
                dplus.append((k, nd))
            elif nd < v.get("dplus", 0):
                v["dplus"] = nd  # D+ retiré : on suit, sans le signaler
    compte = {}
    for typ, items in (("nouvelle", nouveaux), ("confirmee", confirmes), ("dplus", dplus)):
        silencieux = premier or _massif(len(items), base)
        compte[typ] = 0 if silencieux else len(items)
        for it in items:
            if typ == "nouvelle":
                conf, nd = _etat(par_cle[it])
                vues[it] = {"le": aujourdhui, "dplus": nd, **({"conf": conf} if conf else {})}
                if silencieux:
                    vues[it]["massif"] = True
            else:
                k, val = it
                champ = "conf" if typ == "confirmee" else "dplus"
                vues[k][champ] = val
                vues[k][TYPES[typ][2]] = aujourdhui
                vues[k].pop(f"{champ}_massif", None)
                if silencieux:
                    vues[k][f"{champ}_massif"] = True
    return compte


def ecrire_archive(races, aujourdhui=None, chemin=ARCHIVE):
    aujourdhui = aujourdhui or date.today().isoformat()
    vues = json.loads(chemin.read_text(encoding="utf-8")) if chemin.exists() else {}
    n = noter(vues, races, aujourdhui)
    chemin.parent.mkdir(parents=True, exist_ok=True)
    lignes = ",\n".join(f" {json.dumps(k, ensure_ascii=False)}:{json.dumps(v, sort_keys=True)}" for k, v in sorted(vues.items()))
    chemin.write_text(f"{{\n{lignes}\n}}\n", encoding="utf-8")
    print(f"nouveautés : {n['nouvelle']} courses nouvelles, {n['confirmee']} dates confirmées, {n['dplus']} D+ ajoutés "
          f"({len(vues)} événements suivis)")


# ----- Sélection -----

def nouveautes(races, vues, depuis):
    """Nouveautés depuis `depuis` (AAAA-MM-JJ) : une par événement et par type, de la plus récente à la plus ancienne."""
    par_cle = {}
    for r in races:
        if r.get("date"):
            par_cle.setdefault(historique.cle(r), []).append(r)
    out = []
    for k, rows in par_cle.items():
        v = vues.get(k)
        if not v:
            continue
        r0 = min(rows, key=lambda r: (r["date"], r["nom"]))
        ev = {"cle": k, "nom": r0["nom"], "ville": r0["ville"], "dep": r0.get("departement_code") or "",
              "region": r0.get("region_code") or "", "date": r0["date"],
              "formats": {r["distance_km"] for r in rows if r.get("distance_km") is not None},
              "avec_dplus": sorted((r["distance_km"], r["denivele_pos_m"]) for r in rows
                                   if r.get("distance_km") is not None and r.get("denivele_pos_m") is not None)}
        if not v.get("massif") and v["le"] >= depuis:
            out.append({**ev, "type": "nouvelle", "le": v["le"]})
        if v.get("conf_le", "") >= depuis and not v.get("conf_massif") and v.get("conf") == _etat(rows)[0]:
            out.append({**ev, "type": "confirmee", "le": v["conf_le"], "date": v["conf"]})
        if v.get("dplus_le", "") >= depuis and not v.get("dplus_massif") and ev["avec_dplus"]:
            out.append({**ev, "type": "dplus", "le": v["dplus_le"]})
    return sorted(out, key=lambda e: (-_ordinal(e["le"]), list(TYPES).index(e["type"]), e["date"], e["nom"]))


def _ordinal(d):
    return date.fromisoformat(d).toordinal()


# ----- Textes -----

MOIS = historique.MOIS
JOURS = historique.JOURS


def _jour(d):
    j = date.fromisoformat(d)
    return f"{JOURS[j.weekday()]} {'1er' if j.day == 1 else j.day} {MOIS[j.month - 1]} {j.year}"


def date_course(d):
    return f"{MOIS[int(d[5:7]) - 1]} {d[:4]} (jour à confirmer)" if len(d) == 7 else _jour(d)


def _km(k):
    return f"{k:g} km".replace(".", ",")


def kms(formats):
    return ", ".join(_km(k) for k in sorted(formats)) or "distances à venir"


def detail(ev):
    """Ce qui est nouveau, en une ligne."""
    if ev["type"] == "dplus":
        return ", ".join(f"{_km(k)} : {round(d)} m D+" for k, d in ev["avec_dplus"])
    return kms(ev["formats"])


def lieu(ev):
    return f"{ev['ville']} ({ev['dep']})" if ev["dep"] else ev["ville"]


def lien(ev, base=""):
    return f"{base}?q={quote(ev['nom'])}"


# ----- Page -----

CSS = """
:root{--bg:#f6f5f1;--card:#fff;--fg:#17201b;--muted:#5d675f;--border:#e2e0d8;--accent:#177a4c}
@media (prefers-color-scheme:dark){:root{--bg:#101512;--card:#18201b;--fg:#e8ece8;--muted:#9aa59d;--border:#2a342e;--accent:#4cc38a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:20px 16px 48px}a{color:var(--accent)}h1{font-size:1.8rem;margin:.4em 0 .2em}
h2{font-size:1.25rem;margin:1.8em 0 .2em}h3{font-size:1rem;margin:1.2em 0 .6em;color:var(--muted);font-weight:600}
.note{color:var(--muted);font-size:.92rem}
nav.sauts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
nav.sauts a,.flux{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border);border-radius:999px;
  padding:4px 12px;text-decoration:none;font-size:.9rem;background:var(--card)}
details{margin:8px 0}summary{cursor:pointer;color:var(--accent)}.liens{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0;font-size:.92rem}
ul.evs{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.evs li{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.evs a.nom{font-weight:600;text-decoration:none;color:var(--fg)}.evs a.nom:hover{color:var(--accent)}
.evs .quand{color:var(--accent);font-size:.85rem;font-weight:600}.evs .info{color:var(--muted);font-size:.92rem}
"""


def _section(typ, items):
    titre = TYPES[typ][0]
    if not items:
        return f'<h2 id="{typ}">{E(titre)}</h2><p class="note">Rien de nouveau ces dernières semaines.</p>'
    groupes = {}
    for ev in items:
        groupes.setdefault(ev["le"], []).append(ev)
    blocs = "".join(
        f"<h3>Relevé le {E(_jour(le))} · {len(g)}</h3><ul class=\"evs\">"
        + "".join(f'<li><div class="quand">{E(date_course(ev["date"]))}</div>'
                  f'<a class="nom" href="../{E(lien(ev))}">{E(ev["nom"])}</a>'
                  f'<div class="info">{E(lieu(ev))} · {E(detail(ev))}</div></li>' for ev in g)
        + "</ul>" for le, g in groupes.items())
    return f'<h2 id="{typ}">{E(titre)} · {len(items)}</h2>{blocs}'


def page(items, generated_at, regions=(), deps=()):
    par_type = {t: [i for i in items if i["type"] == t] for t in TYPES}
    sauts = "".join(f'<a href="#{t}">{E(TYPES[t][0])} · {len(par_type[t])}</a>' for t in TYPES)
    flux_regions = "".join(f'<a href="../flux/region-{E(c)}.xml">{E(n)}</a>' for c, n in regions)
    flux_deps = "".join(f'<a href="../flux/dep-{E(c)}.xml">{E(c)} {E(n)}</a>' for c, n in deps)
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nouveautés · Agregatrail</title><meta name="robots" content="noindex">
<link rel="alternate" type="application/atom+xml" title="Nouveautés · Agregatrail" href="../flux/nouveautes.xml">
<style>{CSS}</style></head><body><main class="wrap">
<a href="../">← Retour aux courses</a>
<h1>Nouveautés</h1>
<p class="note">Ce qui a changé sur Agregatrail lors des {SEMAINES_PAGE} dernières semaines (mise à jour chaque lundi) :
courses apparues, dates confirmées par l'organisateur, dénivelés ajoutés. Base du {E(_quand(generated_at))}.</p>
<nav class="sauts">{sauts}</nav>
<p><a class="flux" href="../flux/nouveautes.xml">Suivre avec un lecteur de flux (Atom)</a>
<a class="flux" href="../flux/dates-confirmees.xml">Flux des dates confirmées</a></p>
<details><summary>Flux par région</summary><div class="liens">{flux_regions}</div></details>
<details><summary>Flux par département</summary><div class="liens">{flux_deps}</div></details>
{"".join(_section(t, par_type[t]) for t in TYPES)}
<p class="note">Vérifiez toujours les informations auprès de l'organisateur avant de vous inscrire.</p>
</main></body></html>
"""


def _quand(generated_at):
    try:
        return datetime.fromisoformat(generated_at).strftime("%d/%m/%Y")
    except ValueError:
        return generated_at


# ----- Flux Atom (RFC 4287) -----

def flux(items, generated_at, nom="nouveautes.xml", titre="Agregatrail · nouveautés",
         sous_titre="Courses ajoutées, dates confirmées et D+ ajoutés sur Agregatrail, chaque semaine."):
    X = lambda s: html.escape(str(s), quote=True)
    maj = max((ev["le"] for ev in items), default=generated_at[:10])
    entrees = []
    for ev in items:
        resume = f"{date_course(ev['date'])} · {lieu(ev)} · {detail(ev)}"
        entrees.append(f"""<entry>
<id>tag:gcsys.github.io,2026:agregatrail/{ev['type']}/{X(quote(ev['cle']))}/{ev['le']}</id>
<title>{X(TYPES[ev['type']][1])} : {X(ev['nom'])} · {X(lieu(ev))}</title>
<link href="{X(lien(ev, SITE))}"/>
<updated>{ev['le']}T06:00:00Z</updated>
<summary>{X(resume)}</summary>
</entry>""")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">
<id>{SITE}flux/{X(nom)}</id>
<title>{X(titre)}</title>
<subtitle>{X(sous_titre)}</subtitle>
<link rel="self" href="{SITE}flux/{X(nom)}"/>
<link href="{SITE}nouveautes/"/>
<author><name>Agregatrail</name></author>
<updated>{maj}T06:00:00Z</updated>
{chr(10).join(entrees)}
</feed>
"""


def tous_les_flux(items, races, generated_at):
    """{nom de fichier: contenu} : national, dates confirmées, une par région et par département présents."""
    regions = sorted({(r["region_code"], r["region"]) for r in races if r.get("region_code")}, key=lambda x: x[1])
    deps = sorted({(r["departement_code"], r["departement"]) for r in races if r.get("departement_code")})
    out = {"nouveautes.xml": flux(items[:MAX_FLUX], generated_at),
           "dates-confirmees.xml": flux([i for i in items if i["type"] == "confirmee"][:MAX_FLUX], generated_at,
                                        "dates-confirmees.xml", "Agregatrail · dates confirmées",
                                        "Les courses dont l'organisateur vient de confirmer la date.")}
    for c, n in regions:
        out[f"region-{c}.xml"] = flux([i for i in items if i["region"] == c][:MAX_FLUX], generated_at, f"region-{c}.xml",
                                      f"Agregatrail · nouveautés en {n}", f"Nouveautés trail en {n}.")
    for c, n in deps:
        out[f"dep-{c}.xml"] = flux([i for i in items if i["dep"] == c][:MAX_FLUX], generated_at, f"dep-{c}.xml",
                                   f"Agregatrail · nouveautés, {n} ({c})", f"Nouveautés trail dans le département {n}.")
    return out, regions, deps


def main():
    payload = json.loads(RACES.read_text(encoding="utf-8"))
    races = payload["races"]
    vues = json.loads(ARCHIVE.read_text(encoding="utf-8")) if ARCHIVE.exists() else {}
    auj = datetime.now(timezone.utc).date()
    gen = payload.get("generated_at") or auj.isoformat()
    items_page = nouveautes(races, vues, (auj - timedelta(weeks=SEMAINES_PAGE)).isoformat())
    items_flux = nouveautes(races, vues, (auj - timedelta(days=JOURS_FLUX)).isoformat())
    fichiers, regions, deps = tous_les_flux(items_flux, races, gen)
    PAGE.parent.mkdir(parents=True, exist_ok=True)
    FLUX.mkdir(parents=True, exist_ok=True)
    PAGE.write_text(page(items_page, gen, regions, deps), encoding="utf-8")
    for nom, contenu in fichiers.items():
        (FLUX / nom).write_text(contenu, encoding="utf-8")
    compte = {t: sum(1 for i in items_page if i["type"] == t) for t in TYPES}
    print(f"{PAGE.relative_to(ROOT)} : {compte['nouvelle']} courses nouvelles, {compte['confirmee']} dates confirmées, "
          f"{compte['dplus']} D+ ajoutés ; {len(fichiers)} flux dans {FLUX.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
