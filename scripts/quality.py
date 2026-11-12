"""Tableau de bord qualité des données (page site/qualite/index.html).

Lit site/data/races.json (la base générée par build_db.py) et produit :
- des taux de remplissage par région et par source (D+, jour précis, date confirmée…) ;
- des listes d'anomalies à vérifier : doublons probables, coordonnées manquantes ou
  hors des régions couvertes, distances ou dénivelés incohérents.

La page est générée au déploiement (elle n'est pas versionnée). Bibliothèque standard
uniquement.

    python scripts/quality.py                      # écrit site/qualite/index.html
    python scripts/quality.py --summary FICHIER    # ajoute aussi un résumé Markdown à FICHIER
                                                   # (dans l'Action : "$GITHUB_STEP_SUMMARY")
"""
import html
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import enrich  # noqa: E402  (mêmes règles de nom que la fusion des sources)

ROOT = Path(__file__).resolve().parents[1]
RACES = ROOT / "site" / "data" / "races.json"
OUT = ROOT / "site" / "qualite" / "index.html"

REGIONS = {"76": "Occitanie", "93": "Provence-Alpes-Côte d'Azur", "84": "Auvergne-Rhône-Alpes"}
SOURCES = {"catalogue": "Miles Republic", "runtrail": "RunTrail", "gotrail": "GoTrail", "datatourisme": "DATAtourisme"}
MAX_LIGNES = 150  # lignes affichées par liste d'anomalies (le total est toujours donné)

# Taux de remplissage : (clé, libellé, test sur un format)
CHAMPS = [
    ("dplus", "D+ connu", lambda r: r["denivele_pos_m"] is not None),
    ("jour", "Jour précis", lambda r: bool(r["date"]) and len(r["date"]) == 10),
    ("confirmee", "Date confirmée", lambda r: bool(r["date"]) and len(r["date"]) == 10 and r["date_confirmee"]),
    ("coords", "Coordonnées", lambda r: r["lat"] is not None),
    ("site", "Site web", lambda r: bool(r["site_web"])),
    ("inscription", "Lien d'inscription", lambda r: bool(r["lien_inscription"])),
    ("organisateur", "Organisateur", lambda r: bool(r["organisateur"])),
    ("heure", "Heure de départ", lambda r: bool(r["heure_depart"])),
]


def cle_evenement(r):
    """Même clé d'événement que le site (app.js, evKey)."""
    return (enrich.norm(r["nom"]), enrich.norm(r["ville"]), (r["date"] or "")[:7])


def haversine(lat1, lon1, lat2, lon2):
    rad = math.pi / 180
    a = math.sin((lat2 - lat1) * rad / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin((lon2 - lon1) * rad / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


# ----- Taux de remplissage -----

def taux(races, groupe):
    """{groupe: {"formats": n, "evenements": n, <champ>: part entre 0 et 1}}, plus "Total"."""
    par = defaultdict(list)
    for r in races:
        par[groupe(r)].append(r)
    par["Total"] = list(races)
    out = {}
    for g, rows in par.items():
        n = len(rows)
        out[g] = {"formats": n, "evenements": len({cle_evenement(r) for r in rows})}
        for k, _, test in CHAMPS:
            out[g][k] = sum(1 for r in rows if test(r)) / n if n else 0
    return out


def region_de(r):
    return REGIONS.get(r["region_code"]) or ("Hors France / non située" if not r["region_code"] else "Autres régions")


def source_de(r):
    return SOURCES.get(r["source"], r["source"] or "?")


# ----- Anomalies -----

KM_LIBELLE = re.compile(r"(\d+(?:[.,]\d+)?)\s*km\b", re.I)


def incoherences(races):
    """Formats dont la distance ou le D+ semble faux. Renvoie [(format, raison)]."""
    out = []
    for r in races:
        km, d = r["distance_km"], r["denivele_pos_m"]
        if km is None:
            out.append((r, "distance inconnue"))
            continue
        if km <= 0 or km > 400:
            out.append((r, f"distance improbable ({km:g} km)"))
            continue
        m = KM_LIBELLE.search(r["course"] or "")
        if m:
            lu = float(m.group(1).replace(",", "."))
            if lu > 0 and abs(lu - km) > max(1.5, 0.15 * lu):
                out.append((r, f"libellé « {r['course']} » mais {km:g} km"))
        if d is not None:
            ratio = d / km
            if ratio > 150 and r["type"] != "kv" and km > 5:
                out.append((r, f"D+ très élevé : {ratio:.0f} m/km"))
            elif d == 0 and km >= 10:
                out.append((r, "D+ nul sur un trail de 10 km ou plus"))
        if r["date"] and len(r["date"]) == 7 and r["date_confirmee"]:
            out.append((r, "date confirmée mais connue au mois près"))
    return out


def hors_zone(races):
    """Formats sans coordonnées, ou situés hors des régions couvertes. [(format, raison)]."""
    out = []
    for r in races:
        if r["lat"] is None:
            out.append((r, "sans coordonnées" + (" (département saisi)" if r["departement_code"] else "")))
        elif not r["region_code"]:
            out.append((r, f"hors de France ({r['lat']:.3f}, {r['lon']:.3f})"))
        elif r["region_code"] not in REGIONS:
            out.append((r, f"hors des régions couvertes : {r['region'] or r['region_code']}"))
    return out


def _mois(d):
    return int(d[:4]) * 12 + int(d[5:7])


def _mots(r):
    return enrich.tokens(r["nom"]) - enrich.GENERIC


def doublons(races, rayon_km=15):
    """Paires d'événements distincts qui pourraient être le même : même jour (ou mois voisin
    si une date est au mois près), lieux proches, un mot distinctif du nom en commun et au
    moins une distance proche. [(événement a, événement b, raisons)], du plus sûr au moins sûr."""
    ev = defaultdict(list)
    for r in races:
        if r["date"]:
            ev[cle_evenement(r)].append(r)
    par_mois = defaultdict(list)
    for k, rows in ev.items():
        par_mois[_mois(rows[0]["date"])].append(rows)
    out, vus = [], set()
    for m, groupe in par_mois.items():
        voisins = groupe + par_mois.get(m + 1, [])
        for a in groupe:
            ra = a[0]
            for b in voisins:
                rb = b[0]
                if a is b or (id(b[0]), id(a[0])) in vus:
                    continue
                vus.add((id(a[0]), id(b[0])))
                flou = len(ra["date"]) == 7 or len(rb["date"]) == 7
                if ra["date"] != rb["date"] and not (flou and abs(_mois(ra["date"]) - _mois(rb["date"])) <= 1):
                    continue
                meme_commune = enrich.norm(ra["ville"]) == enrich.norm(rb["ville"])
                if not meme_commune:
                    if ra["lat"] is None or rb["lat"] is None or haversine(ra["lat"], ra["lon"], rb["lat"], rb["lon"]) > rayon_km:
                        continue
                if not (_mots(ra) & _mots(rb)) and not enrich._strong_name(ra, rb):
                    continue
                if not any(enrich.close(x["distance_km"], y["distance_km"]) for x in a for y in b):
                    continue
                ecart = abs(_mois(ra["date"]) - _mois(rb["date"]))
                raisons = ["même jour" if ra["date"] == rb["date"] else "même mois" if ecart == 0 else "mois voisin",
                           "même commune" if meme_commune else "communes proches"]
                if enrich._strong_name(ra, rb):
                    raisons.append("nom quasi identique")
                if ra["source"] != rb["source"]:
                    raisons.append("sources différentes")
                out.append((a, b, raisons))
    out.sort(key=lambda x: (-len(x[2]), x[0][0]["date"], x[0][0]["nom"]))
    return out


def analyser(races):
    return {
        "regions": taux(races, region_de),
        "sources": taux(races, source_de),
        "doublons": doublons(races),
        "incoherences": incoherences(races),
        "hors_zone": hors_zone(races),
    }


# ----- Page HTML -----

E = html.escape


def _pct(v):
    return f"{round(v * 100)} %"


def _lien(r):
    url = r["site_web"] or r["source_url"]
    nom = E(r["nom"])
    return f'<a href="{E(url)}" target="_blank" rel="noopener">{nom}</a>' if re.match(r"https?://", url or "") else nom


def _date(d):
    if not d:
        return "?"
    return f"{d[8:10]}/{d[5:7]}/{d[:4]}" if len(d) == 10 else f"{d[5:7]}/{d[:4]}"


def _table_taux(t, titre_col):
    cols = "".join(f"<th>{E(lib)}</th>" for _, lib, _ in CHAMPS)
    lignes = []
    ordre = sorted((g for g in t if g != "Total"), key=lambda g: -t[g]["formats"]) + ["Total"]
    for g in ordre:
        v = t[g]
        cells = "".join(
            f'<td><span class="bar" style="--p:{round(v[k] * 100)}%"></span>{_pct(v[k])}</td>' for k, _, _ in CHAMPS
        )
        cls = ' class="total"' if g == "Total" else ""
        lignes.append(f"<tr{cls}><th>{E(g)}</th><td class=n>{v['formats']}</td><td class=n>{v['evenements']}</td>{cells}</tr>")
    return (f'<div class="scroll"><table><thead><tr><th>{titre_col}</th><th>Formats</th><th>Événements</th>{cols}</tr></thead>'
            f"<tbody>{''.join(lignes)}</tbody></table></div>")


def _liste(titre, aide, items, ligne):
    n = len(items)
    corps = "".join(ligne(x) for x in items[:MAX_LIGNES])
    plus = f'<p class="note">… et {n - MAX_LIGNES} de plus (non affichés).</p>' if n > MAX_LIGNES else ""
    return (f'<details class="anom"><summary><span>{E(titre)}</span><b>{n}</b></summary>'
            f'<p class="note">{aide}</p><div class="scroll"><table>{corps}</table></div>{plus}</details>')


def _ligne_format(x):
    r, raison = x
    lieu = E(r["ville"]) + (f" ({E(r['departement_code'])})" if r["departement_code"] else "")
    infos = " · ".join(v for v in (E(r["course"] or ""), lieu, E(source_de(r))) if v)
    return (f"<tr><td class=d>{_date(r['date'])}</td><td>{_lien(r)}<br><span class=dim>{infos}</span>"
            f"<br><span class=why>{E(raison)}</span></td></tr>")


def _formats(rows):
    return ", ".join(f"{km:g} km" for km in sorted({r["distance_km"] for r in rows if r["distance_km"] is not None})) or "?"


def _ligne_doublon(x):
    a, b, raisons = x
    cell = lambda e: (f"{_lien(e[0])}<br><span class=dim>{_date(e[0]['date'])} · {E(e[0]['ville'])} · {_formats(e)} · "
                      f"{E(', '.join(sorted({source_de(r) for r in e})))}</span>")
    return f"<tr><td>{cell(a)}</td><td>{cell(b)}</td><td class=why>{E(', '.join(raisons))}</td></tr>"


CSS = """
@font-face{font-family:Inter;src:url(../fonts/inter-latin-wght.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--bg:#f4f5f2;--surface:#fff;--surface-2:#f6f7f4;--text:#121a16;--muted:#6b766f;--border:#e3e6e0;--primary:#15784b;--bar:#cfe9da;--warn:#a85d00}
@media (prefers-color-scheme:dark){:root{--bg:#0f1512;--surface:#171f1b;--surface-2:#1d2622;--text:#e8eee9;--muted:#9aa69f;--border:#2a3530;--primary:#4fcf8c;--bar:#21432f;--warn:#f2b05e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 48px}
a{color:var(--primary)}
h1{font-size:1.6rem;margin:8px 0 4px}h2{font-size:1.15rem;margin:32px 0 8px}
.note,.dim{color:var(--muted);font-size:.85rem}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:20px 0}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.kpi b{display:block;font-size:1.5rem}.kpi span{color:var(--muted);font-size:.85rem}
.scroll{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{padding:7px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
thead th{font-size:.78rem;color:var(--muted);font-weight:600;white-space:nowrap}
tbody th{white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}
tbody td:not(.n){white-space:nowrap;position:relative;font-variant-numeric:tabular-nums}
.bar{display:inline-block;width:44px;height:6px;border-radius:3px;margin-right:6px;vertical-align:middle;
  background:linear-gradient(90deg,var(--primary) var(--p),var(--bar) var(--p))}
tr.total{background:var(--surface-2);font-weight:600}
.anom{margin:10px 0}.anom summary{cursor:pointer;display:flex;justify-content:space-between;gap:12px;padding:12px 14px;
  background:var(--surface);border:1px solid var(--border);border-radius:12px;font-weight:600}
.anom summary b{color:var(--warn)}.anom[open] summary{margin-bottom:8px}
.anom td:not(.n){white-space:normal}.anom td.d:not(.n){white-space:nowrap;font-variant-numeric:tabular-nums}
.why{color:var(--warn);font-size:.85rem}td.why{width:22%;min-width:140px}
@media (max-width:640px){.anom tr{display:block;border-bottom:1px solid var(--border)}.anom td{display:block;border:0;padding:4px 12px}
  .anom td:first-child{padding-top:10px}.anom td:last-child{padding-bottom:10px}}
"""


def page(res, generated_at, n_formats):
    reg, src = res["regions"], res["sources"]
    tot = reg["Total"]
    kpi = lambda v, lib: f'<div class="kpi"><b>{v}</b><span>{lib}</span></div>'
    kpis = "".join([
        kpi(f"{n_formats:,}".replace(",", " "), "formats à venir"),
        kpi(f"{tot['evenements']:,}".replace(",", " "), "événements"),
        kpi(_pct(tot["dplus"]), "avec D+ connu"),
        kpi(_pct(tot["confirmee"]), "avec date confirmée"),
        kpi(len(res["doublons"]), "doublons probables"),
        kpi(len(res["incoherences"]) + len(res["hors_zone"]), "autres points à vérifier"),
    ])
    try:
        quand = datetime.fromisoformat(generated_at).strftime("%d/%m/%Y à %H:%M UTC")
    except ValueError:
        quand = generated_at
    inconnues = [x for x in res["incoherences"] if x[1] == "distance inconnue"]
    incoh = [x for x in res["incoherences"] if x[1] != "distance inconnue"]
    listes = "".join([
        _liste("Doublons probables", "Deux événements différents dans la base, même jour (ou mois voisin si la date est au mois près), "
               "lieux à moins de 15 km, un mot distinctif du nom en commun et une distance proche. À vérifier avant de fusionner.",
               res["doublons"], _ligne_doublon),
        _liste("Distances et dénivelés incohérents", "Distance improbable, libellé qui ne correspond pas à la distance, "
               "D+ par km trop élevé (hors kilomètre vertical) ou nul, date au mois marquée confirmée.", incoh, _ligne_format),
        _liste("Coordonnées manquantes ou hors zone", "Formats sans point sur la carte, ou situés hors d'Occitanie, de PACA et "
               "d'Auvergne-Rhône-Alpes (souvent une commune homonyme mal géocodée).", res["hors_zone"], _ligne_format),
        _liste("Distance inconnue", "Formats sans distance : ils n'apparaissent pas dans les filtres de distance ni dans "
               "les courses qui ressemblent.", inconnues, _ligne_format),
    ])
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qualité des données · Agregatrail</title><meta name="robots" content="noindex">
<style>{CSS}</style></head><body><main class="wrap">
<a href="../">← Retour aux courses</a>
<h1>Qualité des données</h1>
<p class="note">Base du {E(quand)}. Page calculée automatiquement à chaque mise à jour, à partir des seules données publiées sur le site.</p>
<div class="kpis">{kpis}</div>
<h2>Remplissage par région</h2>
{_table_taux(reg, "Région")}
<h2>Remplissage par source</h2>
<p class="note">Source d'origine de chaque format. Un format peut avoir été complété par une autre source lors de la fusion.</p>
{_table_taux(src, "Source")}
<h2>À vérifier</h2>
{listes}
<p class="note">Une erreur ? <a href="https://github.com/gcsys/TRAIL-AGREGATOR/issues/new?template=completer-course.yml">Signalez-la</a>.</p>
</main></body></html>
"""


def resume_md(res, n_formats):
    tot = res["regions"]["Total"]
    lignes = [
        "## Qualité des données",
        "",
        f"{n_formats} formats, {tot['evenements']} événements. "
        + ", ".join(f"{lib} {_pct(tot[k])}" for k, lib, _ in CHAMPS[:4]) + ".",
        "",
        "| Région | Formats | " + " | ".join(lib for _, lib, _ in CHAMPS) + " |",
        "|---|---:|" + "---:|" * len(CHAMPS),
    ]
    for g, v in sorted(res["regions"].items(), key=lambda x: (x[0] == "Total", -x[1]["formats"])):
        lignes.append(f"| {g} | {v['formats']} | " + " | ".join(_pct(v[k]) for k, _, _ in CHAMPS) + " |")
    inconnues = sum(1 for x in res["incoherences"] if x[1] == "distance inconnue")
    lignes += ["", f"À vérifier : {len(res['doublons'])} doublons probables, {len(res['incoherences']) - inconnues} distances "
               f"ou D+ incohérents, {len(res['hors_zone'])} formats sans coordonnées ou hors zone, {inconnues} sans distance.", ""]
    return "\n".join(lignes)


def main(argv):
    payload = json.loads(RACES.read_text(encoding="utf-8"))
    races = payload["races"]
    res = analyser(races)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page(res, payload["generated_at"], len(races)), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)} : {len(res['doublons'])} doublons probables, {len(res['incoherences'])} incohérences, "
          f"{len(res['hors_zone'])} hors zone")
    if "--summary" in argv:
        dest = argv[argv.index("--summary") + 1]
        if dest:
            with open(dest, "a", encoding="utf-8") as f:
                f.write(resume_md(res, len(races)))


if __name__ == "__main__":
    main(sys.argv[1:])
