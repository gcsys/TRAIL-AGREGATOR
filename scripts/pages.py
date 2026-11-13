"""Pages par événement (site/course/<slug>/), sitemap et table des pages pour la fiche.

Une page statique par événement à venir : nom, date, lieu, formats (distance, D+, heure, prix), liens vers
l'organisateur et la source, lien vers la carte, et données structurées schema.org/SportsEvent.

Indexation (décision du 2026-11-12) : seules les pages dont tous les formats viennent de sources ouvertes
(DATAtourisme, Licence Ouverte) sont indexables et listées dans le sitemap. Les autres sont publiées en
`noindex` : elles servent aux liens partagés, pas aux moteurs de recherche.

Générées au déploiement à partir de races.json (non versionnées) :
- site/course/<slug>/index.html
- site/sitemap.xml (accueil + pages indexables)
- site/data/pages.json : {"nom|ville|AAAA-MM": slug}, lu par la fiche pour son lien « Page de la course » ;
- site/trails/ : sommaire par région, puis une page par région (site/trails/<region>/) et par département
  (site/trails/<departement>-<code>/), courses classées par mois avec un lien vers la carte filtrée.
  Même règle d'indexation : une liste n'est indexable que si toutes ses courses le sont.

Bibliothèque standard uniquement.

    python scripts/pages.py
"""
import html
import json
import re
import shutil
import sys
import unicodedata
from datetime import date
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import enrich  # noqa: E402  (même clé d'événement que le site)

ROOT = Path(__file__).resolve().parents[1]
RACES = ROOT / "site" / "data" / "races.json"
PAGES = ROOT / "site" / "course"
LISTES = ROOT / "site" / "trails"
SITEMAP = ROOT / "site" / "sitemap.xml"
TABLE = ROOT / "site" / "data" / "pages.json"
SITE = "https://gcsys.github.io/TRAIL-AGREGATOR/"

SOURCES_OUVERTES = {"datatourisme"}
SOURCES = {"catalogue": ("Miles Republic", None), "runtrail": ("RunTrail", None), "gotrail": ("GoTrail", None),
           "datatourisme": ("DATAtourisme", "Licence Ouverte 2.0")}
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre",
        "décembre"]
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
E = html.escape


def slug(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def cle_site(r):
    """Clé de la table lue par la fiche : nom, ville et mois tels que publiés."""
    return f"{r['nom']}|{r['ville']}|{(r['date'] or '')[:7]}"


def evenements(races):
    """Formats regroupés par événement (même clé que le site : nom, ville et mois normalisés)."""
    evs = {}
    for r in races:
        k = (enrich.norm(r["nom"]), enrich.norm(r["ville"]), (r["date"] or "")[:7])
        evs.setdefault(k, []).append(r)
    out = []
    for rows in evs.values():
        rows.sort(key=lambda r: (r["date"] or "9999", r["distance_km"] if r["distance_km"] is not None else 1e9))
        out.append(rows)
    return sorted(out, key=lambda rows: (rows[0]["date"] or "9999", rows[0]["nom"]))


def attribuer_slugs(evs):
    """Slug lisible et unique : nom-ville-annee, puis -2, -3… en cas d'homonymie."""
    pris, out = set(), []
    for rows in evs:
        r = rows[0]
        base = "-".join(x for x in (slug(r["nom"])[:60].strip("-"), slug(r["ville"])[:30].strip("-"),
                                    (r["date"] or "")[:4]) if x) or "course"
        s, n = base, 2
        while s in pris:
            s, n = f"{base}-{n}", n + 1
        pris.add(s)
        out.append(s)
    return out


def indexable(rows):
    return all(r.get("source") in SOURCES_OUVERTES for r in rows)


# ----- Textes -----

def date_txt(rows):
    d = rows[0]["date"] or ""
    if len(d) == 7:
        return f"{MOIS[int(d[5:7]) - 1]} {d[:4]}", "jour à préciser"
    if not d:
        return "date inconnue", ""
    jours = sorted({r["date"] for r in rows if r["date"] and len(r["date"]) == 10})
    j = date.fromisoformat(jours[0])
    txt = f"{JOURS[j.weekday()]} {'1er' if j.day == 1 else j.day} {MOIS[j.month - 1]} {j.year}"
    if len(jours) > 1:
        f = date.fromisoformat(jours[-1])
        txt += f" au {JOURS[f.weekday()]} {'1er' if f.day == 1 else f.day} {MOIS[f.month - 1]}"
    conf = all(r.get("date_confirmee") for r in rows)
    return txt, "" if conf else "date à confirmer par l'organisateur"


def km(v):
    return f"{v:g}".replace(".", ",") + " km" if v is not None else "distance inconnue"


def lieu(r):
    return f"{r['ville']} ({r['departement_code']})" if r.get("departement_code") else r["ville"]


def description(rows):
    r = rows[0]
    d, _ = date_txt(rows)
    dists = sorted({x["distance_km"] for x in rows if x["distance_km"] is not None})
    f = ", ".join(km(x) for x in dists) or "formats à venir"
    return f"{r['nom']}, trail à {lieu(r)}, {d}. Formats : {f}. Dates, distances et dénivelés, lien vers l'organisateur."


def json_ld(rows, url):
    r = rows[0]
    jours = sorted(x["date"] for x in rows if x["date"])
    site = next((x["site_web"] for x in rows if x.get("site_web")), "")
    orga = next((x["organisateur"] for x in rows if x.get("organisateur")), "")
    ev = {"@context": "https://schema.org", "@type": "SportsEvent", "name": r["nom"], "sport": "Trail",
          "url": url, "eventStatus": "https://schema.org/EventScheduled",
          "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
          "location": {"@type": "Place", "name": r["ville"],
                       "address": {"@type": "PostalAddress", "addressLocality": r["ville"], "addressCountry": "FR",
                                   **({"postalCode": r["code_postal"]} if r.get("code_postal") else {}),
                                   **({"addressRegion": r["region"]} if r.get("region") else {})}},
          "description": description(rows)}
    if jours:
        ev["startDate"] = jours[0]
        if jours[-1] != jours[0]:
            ev["endDate"] = jours[-1]
    if r.get("lat") is not None:
        ev["location"]["geo"] = {"@type": "GeoCoordinates", "latitude": r["lat"], "longitude": r["lon"]}
    if orga or site:
        ev["organizer"] = {"@type": "Organization", "name": orga or r["nom"], **({"url": site} if site else {})}
    subs = [{"@type": "SportsEvent", "name": x["course"] or km(x["distance_km"]),
             **({"startDate": x["date"]} if x["date"] else {}),
             **({"description": f"{km(x['distance_km'])}, {x['denivele_pos_m']} m D+"} if x["denivele_pos_m"] is not None else {})}
            for x in rows]
    if len(subs) > 1:
        ev["subEvent"] = subs
    return json.dumps(ev, ensure_ascii=False).replace("</", "<\\/")


# ----- Page -----

CSS = """
:root{--bg:#f6f5f1;--card:#fff;--fg:#17201b;--muted:#5d675f;--border:#e2e0d8;--accent:#177a4c;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#101512;--card:#18201b;--fg:#e8ece8;--muted:#9aa59d;--border:#2a342e;--accent:#4cc38a;--warn:#f0c674}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:20px 16px 48px}a{color:var(--accent)}
h1{font-size:1.9rem;line-height:1.2;margin:.5em 0 .2em}h2{font-size:1.1rem;margin:1.6em 0 .5em}
.quand{font-weight:600;color:var(--accent);margin:0}.lieu{margin:.2em 0 0;color:var(--muted)}.warn{color:var(--warn);font-size:.92rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-x:auto}.lib{color:var(--muted);font-size:.85rem}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border)}
tr:last-child td{border-bottom:0}th{font-size:.8rem;color:var(--muted);font-weight:600}td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.liens{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.btn{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:7px 14px;text-decoration:none;background:var(--card);font-weight:500}
.btn.primaire{background:var(--accent);border-color:var(--accent);color:#fff}
.note{color:var(--muted);font-size:.9rem}
"""


def page(rows, slug_, generated_at):
    r = rows[0]
    url = f"{SITE}course/{slug_}/"
    quand, avert = date_txt(rows)
    idx = indexable(rows)
    site = next((x["site_web"] for x in rows if x.get("site_web")), "")
    inscr = next((x["lien_inscription"] for x in rows if x.get("lien_inscription")), "")
    orga = next((x["organisateur"] for x in rows if x.get("organisateur")), "")
    avec_heure = any(x.get("heure_depart") for x in rows)
    avec_prix = any(x.get("prix_eur") is not None for x in rows)
    def ligne(x):
        dist = km(x["distance_km"])
        lib = x["course"] if x.get("course") and x["course"] != dist else ""
        sous = f'<br><span class="lib">{E(lib)}</span>' if lib else ""
        dplus = f"{x['denivele_pos_m']} m" if x["denivele_pos_m"] is not None else "inconnu"
        cells = [f"<td><b>{E(dist)}</b>{sous}</td>", f'<td class="n">{E(dplus)}</td>']
        if avec_heure:
            cells.append(f'<td class="n">{E(x.get("heure_depart") or "–")}</td>')
        if avec_prix:
            prix = f"{x['prix_eur']:g}".replace(".", ",") + " €" if x.get("prix_eur") is not None else "–"
            cells.append(f'<td class="n">{E(prix)}</td>')
        return "<tr>" + "".join(cells) + "</tr>"
    entetes = "<th>Distance</th><th>D+</th>" + ("<th>Départ</th>" if avec_heure else "") + ("<th>Prix</th>" if avec_prix else "")
    if all(x["distance_km"] is None for x in rows):
        formats = '<p class="note">Distances pas encore publiées : voir le site de l\'organisateur.</p>'
    else:
        formats = f'<div class="card"><table><thead><tr>{entetes}</tr></thead><tbody>{"".join(ligne(x) for x in rows)}</tbody></table></div>'
    sources = sorted({x["source"] for x in rows if x.get("source")})
    src_txt = ", ".join(
        (f'<a href="{E(next(x["source_url"] for x in rows if x["source"] == s and x.get("source_url")))}" rel="nofollow">{E(SOURCES.get(s, (s,))[0])}</a>'
         if any(x["source"] == s and x.get("source_url") for x in rows) else E(SOURCES.get(s, (s,))[0]))
        + (f" ({E(SOURCES[s][1])})" if SOURCES.get(s, (None, None))[1] else "")
        for s in sources)
    liens = []
    if site:
        liens.append(f'<a class="btn primaire" href="{E(site)}" rel="nofollow noopener">Site officiel</a>')
    if inscr and inscr != site:
        liens.append(f'<a class="btn" href="{E(inscr)}" rel="nofollow noopener">Inscription</a>')
    liens.append(f'<a class="btn" href="../../?q={E(quote(r["nom"]))}">Voir sur la carte</a>')
    titre = f"{r['nom']} · {lieu(r)} · {quand}"
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(titre)} · Agregatrail</title>
<meta name="description" content="{E(description(rows))}">
{'<link rel="canonical" href="' + E(url) + '">' if idx else '<meta name="robots" content="noindex">'}
<meta property="og:title" content="{E(titre)}"><meta property="og:description" content="{E(description(rows))}">
<meta property="og:type" content="website"><meta property="og:url" content="{E(url)}">
<script type="application/ld+json">{json_ld(rows, url)}</script>
<style>{CSS}</style></head><body><main class="wrap">
<a href="../../">← Toutes les courses</a>
<p class="quand" style="margin-top:1.2em">{E(quand)}</p>
<h1>{E(r['nom'])}</h1>
<p class="lieu">{E(r['ville'])}{' · <a href="../../trails/' + slug_dep(r) + '/">' + E(r['departement'] + ' (' + r['departement_code'] + ')') + '</a>' if r.get('departement') and r.get('departement_code') else ''}{E(' · ' + r['region']) if r.get('region') else ''}</p>
{f'<p class="warn">{E(avert[0].upper() + avert[1:])}.</p>' if avert else ''}
<div class="liens">{''.join(liens)}</div>
<h2>Formats</h2>
{formats}
{f'<p class="note">Organisateur : {E(orga)}.</p>' if orga else ''}
<p class="note">Source : {src_txt}. Données mises à jour chaque semaine (base du {E('/'.join(reversed(generated_at[:10].split('-'))))}).
Vérifiez toujours les informations auprès de l'organisateur avant de vous inscrire.
<a href="https://github.com/gcsys/TRAIL-AGREGATOR/issues/new?template=completer-course.yml">Signaler une erreur</a>.</p>
</main></body></html>
"""


# ----- Listes par région et département -----

def slug_dep(r):
    return f"{slug(r['departement'])}-{r['departement_code'].lower()}"


def slug_reg(r):
    return slug(r["region"])


def regrouper(evs, slugs):
    """{region_code: {"nom", "slug", "evs": [(rows, slug)], "deps": {code: {"nom", "slug", "evs"}}}}."""
    regs = {}
    for rows, s in zip(evs, slugs):
        r = rows[0]
        if not r.get("region_code") or not r.get("departement_code"):
            continue
        g = regs.setdefault(r["region_code"], {"nom": r["region"], "slug": slug_reg(r), "evs": [], "deps": {}})
        g["evs"].append((rows, s))
        d = g["deps"].setdefault(r["departement_code"], {"nom": r["departement"], "slug": slug_dep(r), "evs": []})
        d["evs"].append((rows, s))
    return regs


def liste_indexable(items):
    return bool(items) and all(indexable(rows) for rows, _ in items)


def annees(items):
    a = sorted({rows[0]["date"][:4] for rows, _ in items if rows[0]["date"]})
    return a[0] if len(a) == 1 else f"{a[0]}-{a[-1]}" if a else ""


def jour_court(d):
    if len(d) < 10:
        return "jour à préciser"
    j = date.fromisoformat(d[:10])
    return f"{JOURS[j.weekday()][:3]}. {'1er' if j.day == 1 else j.day}"


def par_mois(items):
    """Courses classées par mois : <h2> par mois, une ligne par événement."""
    blocs, mois = [], None
    for rows, s in items:
        r = rows[0]
        m = r["date"][:7]
        if m != mois:
            if mois:
                blocs.append("</ul>")
            mois = m
            blocs.append(f'<h2>{E(MOIS[int(m[5:7]) - 1].capitalize())} {E(m[:4])}</h2><ul class="evs">')
        dists = sorted({x["distance_km"] for x in rows if x["distance_km"] is not None})
        f = ", ".join(km(x) for x in dists) or "formats à venir"
        conf = "" if all(x.get("date_confirmee") for x in rows) else ' <span class="tag">à confirmer</span>'
        blocs.append(f'<li><span class="j">{E(jour_court(r["date"]))}</span><span><a href="../../course/{E(s)}/">'
                     f'{E(r["nom"])}</a>{conf}<br><span class="lib">{E(r["ville"])} · {E(f)}</span></span></li>')
    if mois:
        blocs.append("</ul>")
    return "".join(blocs)


LISTE_CSS = """
.evs{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--border);border-radius:12px}
.evs li{display:flex;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border)}.evs li:last-child{border-bottom:0}
.evs .j{flex:0 0 4.6em;color:var(--muted);font-variant-numeric:tabular-nums;font-size:.92rem;padding-top:1px}
.tag{font-size:.75rem;border:1px solid var(--border);border-radius:999px;padding:1px 7px;color:var(--warn)}
.deps{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.deps .n{color:var(--muted)}
.regs{list-style:none;padding:0}.regs>li{margin:0 0 18px}.regs h2{margin:0 0 6px}
"""


def page_liste(titre, h1, intro, corps, url, idx, retour, generated_at):
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(titre)} · Agregatrail</title>
<meta name="description" content="{E(intro)}">
{'<link rel="canonical" href="' + E(url) + '">' if idx else '<meta name="robots" content="noindex">'}
<meta property="og:title" content="{E(titre)}"><meta property="og:description" content="{E(intro)}">
<meta property="og:type" content="website"><meta property="og:url" content="{E(url)}">
<style>{CSS}{LISTE_CSS}</style></head><body><main class="wrap">
{retour}
<h1>{E(h1)}</h1>
<p class="lieu">{E(intro)}</p>
{corps}
<p class="note">Données mises à jour chaque semaine (base du {E('/'.join(reversed(generated_at[:10].split('-'))))}),
issues de RunTrail, GoTrail, Miles Republic et DATAtourisme. Vérifiez toujours les informations auprès de
l'organisateur avant de vous inscrire.</p>
</main></body></html>
"""


def pluriel(n, mot):
    return f"{n} {mot}{'s' if n > 1 else ''}"


def pages_listes(regs, generated_at):
    """{chemin relatif à site/trails/: (html, indexable)} ; chemin "" = sommaire."""
    out = {}
    racine = '<a href="../../">← Toutes les courses</a> · <a href="../">Toutes les régions</a>'
    for code, g in sorted(regs.items(), key=lambda kv: kv[1]["nom"]):
        idx = liste_indexable(g["evs"])
        deps = "".join(f'<li><a class="btn" href="../{E(d["slug"])}/">{E(d["nom"])} ({E(c)})</a></li>'
                       for c, d in sorted(g["deps"].items(), key=lambda kv: kv[1]["nom"]))
        an = annees(g["evs"])
        corps = (f'<div class="liens"><a class="btn primaire" href="../../?reg={E(code)}">Voir sur la carte</a></div>'
                 f'<ul class="deps">{deps}</ul>{par_mois(g["evs"])}')
        out[g["slug"]] = (page_liste(f"Trails en {g['nom']} {an} : calendrier", f"Trails · {g['nom']}",
                                     f"{pluriel(len(g['evs']), 'course')} à venir en {g['nom']} ({an}), classées par mois : "
                                     "dates, lieux et distances.",
                                     corps, f"{SITE}trails/{g['slug']}/", idx, racine, generated_at), idx)
        for c, d in g["deps"].items():
            idx_d = liste_indexable(d["evs"])
            an = annees(d["evs"])
            retour = racine + f' · <a href="../{E(g["slug"])}/">{E(g["nom"])}</a>'
            corps = (f'<div class="liens"><a class="btn primaire" href="../../?dep={E(c)}">Voir sur la carte</a></div>'
                     f'{par_mois(d["evs"])}')
            out[d["slug"]] = (page_liste(f"Trails {d['nom']} ({c}) {an} : calendrier", f"Trails · {d['nom']} ({c})",
                                         f"{pluriel(len(d['evs']), 'course')} à venir dans le département {d['nom']} ({c}, "
                                         f"{g['nom']}) en {an}, classées par mois : dates, lieux et distances.",
                                         corps, f"{SITE}trails/{d['slug']}/", idx_d, retour, generated_at), idx_d)
    items = []
    for code, g in sorted(regs.items(), key=lambda kv: -len(kv[1]["evs"])):
        deps = "".join(f'<li><a href="{E(d["slug"])}/">{E(d["nom"])}</a> <span class="n">{len(d["evs"])}</span></li>'
                       for c, d in sorted(g["deps"].items(), key=lambda kv: kv[1]["nom"]))
        items.append(f'<li><h2><a href="{E(g["slug"])}/">{E(g["nom"])}</a> <span class="n">'
                     f'{E(pluriel(len(g["evs"]), "course"))}</span></h2><ul class="deps">{deps}</ul></li>')
    n = sum(len(g["evs"]) for g in regs.values())
    out[""] = (page_liste("Trails par région et département", "Trails par région",
                          f"{pluriel(n, 'course')} à venir, classées par région et par département.",
                          f'<ul class="regs">{"".join(items)}</ul>', f"{SITE}trails/", True,
                          '<a href="../">← Toutes les courses</a>', generated_at), True)
    return out


def sitemap(urls):
    lignes = "\n".join(f"<url><loc>{E(u)}</loc></url>" for u in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{lignes}\n</urlset>\n'


def main():
    payload = json.loads(RACES.read_text(encoding="utf-8"))
    races = [r for r in payload["races"] if r.get("date")]
    evs = evenements(races)
    slugs = attribuer_slugs(evs)
    if PAGES.exists():
        shutil.rmtree(PAGES)
    table, urls, n_idx = {}, [SITE], 0
    for rows, s in zip(evs, slugs):
        d = PAGES / s
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(rows, s, payload.get("generated_at", "")), encoding="utf-8")
        for r in rows:
            table.setdefault(cle_site(r), s)
        if indexable(rows):
            urls.append(f"{SITE}course/{s}/")
            n_idx += 1
    if LISTES.exists():
        shutil.rmtree(LISTES)
    listes, n_listes = pages_listes(regrouper(evs, slugs), payload.get("generated_at", "")), 0
    for chemin, (contenu, idx) in listes.items():
        d = LISTES / chemin
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(contenu, encoding="utf-8")
        if idx:
            urls.append(f"{SITE}trails/{chemin + '/' if chemin else ''}")
            n_listes += 1
    SITEMAP.write_text(sitemap(urls), encoding="utf-8")
    TABLE.write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"pages : {len(evs)} événements dans site/course/, dont {n_idx} indexables ; "
          f"{len(listes)} listes dans site/trails/, dont {n_listes} indexables (sitemap.xml)")


if __name__ == "__main__":
    main()
