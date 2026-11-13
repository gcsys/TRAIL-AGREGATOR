"""Nouveautés : les courses apparues sur le site, en page (site/nouveautes/) et en flux Atom (site/flux/).

- data/archive/premiere_vue.json (versionné, mis à jour par build_db.py) : pour chaque événement (même clé
  que l'historique des éditions : nom sans numéro d'édition ni année, et commune), le jour du build où il
  est apparu. Les événements déjà là au premier build, ou arrivés en masse avec une nouvelle source, ne
  comptent pas comme des nouveautés (ce ne sont pas de nouvelles courses, seulement de nouvelles données).
- La page et le flux sont générés au déploiement à partir de races.json (non versionnés).

Bibliothèque standard uniquement.

    python scripts/nouveautes.py      # écrit site/nouveautes/index.html et site/flux/nouveautes.xml
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
FLUX = ROOT / "site" / "flux" / "nouveautes.xml"
SITE = "https://gcsys.github.io/TRAIL-AGREGATOR/"

MASSIF = (100, 0.05)  # au-delà de 100 événements et de 5 % de la base d'un coup : nouvelle source, pas des nouveautés
SEMAINES_PAGE = 4
JOURS_FLUX = 60
MAX_FLUX = 100
E = html.escape


# ----- Archive -----

def noter(vues, races, aujourdhui):
    """Ajoute à `vues` les événements de `races` jamais vus. Premier build : tous notés « déjà là ».
    Renvoie le nombre de nouveautés retenues."""
    premier = not vues
    nouveaux = sorted({historique.cle(r) for r in races if r.get("date")} - set(vues))
    massif = premier or len(nouveaux) > max(MASSIF[0], MASSIF[1] * len(vues))
    for k in nouveaux:
        vues[k] = {"le": aujourdhui, "massif": True} if massif else {"le": aujourdhui}
    return 0 if massif else len(nouveaux)


def ecrire_archive(races, aujourdhui=None, chemin=ARCHIVE):
    aujourdhui = aujourdhui or date.today().isoformat()
    vues = json.loads(chemin.read_text(encoding="utf-8")) if chemin.exists() else {}
    n = noter(vues, races, aujourdhui)
    chemin.parent.mkdir(parents=True, exist_ok=True)
    lignes = ",\n".join(f" {json.dumps(k, ensure_ascii=False)}:{json.dumps(v, sort_keys=True)}" for k, v in sorted(vues.items()))
    chemin.write_text(f"{{\n{lignes}\n}}\n", encoding="utf-8")
    print(f"nouveautés : {n} événements nouveaux sur {len(vues)} suivis")


# ----- Sélection -----

def evenements(races, vues, depuis):
    """Événements à venir apparus depuis `depuis` (AAAA-MM-JJ), du plus récent au plus ancien."""
    par_cle = {}
    for r in races:
        if not r.get("date"):
            continue
        k = historique.cle(r)
        v = vues.get(k)
        if not v or v.get("massif") or v["le"] < depuis:
            continue
        ev = par_cle.setdefault(k, {"cle": k, "le": v["le"], "nom": r["nom"], "ville": r["ville"],
                                    "dep": r.get("departement_code") or "", "date": r["date"], "formats": set(),
                                    "site": r.get("site_web") or ""})
        ev["date"] = min(ev["date"], r["date"])
        if r.get("distance_km") is not None:
            ev["formats"].add(r["distance_km"])
        ev["site"] = ev["site"] or r.get("site_web") or ""
    return sorted(par_cle.values(), key=lambda e: (-_ordinal(e["le"]), e["date"], e["nom"]))


def _ordinal(d):
    return date.fromisoformat(d).toordinal()


# ----- Textes -----

MOIS = historique.MOIS
JOURS = historique.JOURS


def date_course(d):
    if len(d) == 7:
        return f"{MOIS[int(d[5:7]) - 1]} {d[:4]} (jour à confirmer)"
    j = date.fromisoformat(d)
    return f"{JOURS[j.weekday()]} {'1er' if j.day == 1 else j.day} {MOIS[j.month - 1]} {j.year}"


def kms(formats):
    return ", ".join(f"{k:g} km".replace(".", ",") for k in sorted(formats)) or "distances à venir"


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
h2{font-size:1.05rem;margin:1.6em 0 .6em;color:var(--muted);font-weight:600}.note{color:var(--muted);font-size:.92rem}
.flux{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border);border-radius:999px;padding:4px 12px;
  text-decoration:none;font-size:.9rem;background:var(--card)}
ul.evs{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.evs li{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.evs a.nom{font-weight:600;text-decoration:none;color:var(--fg)}.evs a.nom:hover{color:var(--accent)}
.evs .quand{color:var(--accent);font-size:.85rem;font-weight:600}.evs .info{color:var(--muted);font-size:.92rem}
"""


def _semaine(d):
    j = date.fromisoformat(d)
    return f"Ajoutées le {JOURS[j.weekday()]} {'1er' if j.day == 1 else j.day} {MOIS[j.month - 1]} {j.year}"


def page(evs, generated_at):
    groupes = {}
    for ev in evs:
        groupes.setdefault(ev["le"], []).append(ev)
    blocs = "".join(
        f"<h2>{E(_semaine(le))} · {len(g)}</h2><ul class=\"evs\">"
        + "".join(f'<li><div class="quand">{E(date_course(ev["date"]))}</div>'
                  f'<a class="nom" href="../{E(lien(ev))}">{E(ev["nom"])}</a>'
                  f'<div class="info">{E(lieu(ev))} · {E(kms(ev["formats"]))}</div></li>' for ev in g)
        + "</ul>" for le, g in groupes.items())
    if not blocs:
        blocs = '<p class="note">Aucune nouvelle course ces dernières semaines.</p>'
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nouvelles courses · Agregatrail</title><meta name="robots" content="noindex">
<link rel="alternate" type="application/atom+xml" title="Nouvelles courses · Agregatrail" href="../flux/nouveautes.xml">
<style>{CSS}</style></head><body><main class="wrap">
<a href="../">← Retour aux courses</a>
<h1>Nouvelles courses</h1>
<p class="note">Les courses apparues sur Agregatrail lors des {SEMAINES_PAGE} dernières semaines (mise à jour chaque lundi),
de la plus récente à la plus ancienne. Base du {E(_quand(generated_at))}.</p>
<p><a class="flux" href="../flux/nouveautes.xml">Suivre avec un lecteur de flux (Atom)</a></p>
{blocs}
<p class="note">Vérifiez toujours les informations auprès de l'organisateur avant de vous inscrire.</p>
</main></body></html>
"""


def _quand(generated_at):
    try:
        return datetime.fromisoformat(generated_at).strftime("%d/%m/%Y")
    except ValueError:
        return generated_at


# ----- Flux Atom (RFC 4287) -----

def flux(evs, generated_at):
    X = lambda s: html.escape(str(s), quote=True)
    maj = max((ev["le"] for ev in evs), default=generated_at[:10])
    entrees = []
    for ev in evs:
        resume = f"{date_course(ev['date'])} · {lieu(ev)} · {kms(ev['formats'])}"
        entrees.append(f"""<entry>
<id>tag:gcsys.github.io,2026:agregatrail/{X(quote(ev['cle']))}</id>
<title>{X(ev['nom'])} · {X(lieu(ev))}</title>
<link href="{X(lien(ev, SITE))}"/>
<updated>{ev['le']}T06:00:00Z</updated>
<summary>{X(resume)}</summary>
</entry>""")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">
<id>{SITE}flux/nouveautes.xml</id>
<title>Agregatrail · nouvelles courses</title>
<subtitle>Les courses de trail apparues sur Agregatrail, chaque semaine.</subtitle>
<link rel="self" href="{SITE}flux/nouveautes.xml"/>
<link href="{SITE}nouveautes/"/>
<author><name>Agregatrail</name></author>
<updated>{maj}T06:00:00Z</updated>
{chr(10).join(entrees)}
</feed>
"""


def main():
    payload = json.loads(RACES.read_text(encoding="utf-8"))
    vues = json.loads(ARCHIVE.read_text(encoding="utf-8")) if ARCHIVE.exists() else {}
    auj = datetime.now(timezone.utc).date()
    evs_page = evenements(payload["races"], vues, (auj - timedelta(weeks=SEMAINES_PAGE)).isoformat())
    evs_flux = evenements(payload["races"], vues, (auj - timedelta(days=JOURS_FLUX)).isoformat())[:MAX_FLUX]
    PAGE.parent.mkdir(parents=True, exist_ok=True)
    FLUX.parent.mkdir(parents=True, exist_ok=True)
    PAGE.write_text(page(evs_page, payload.get("generated_at", "")), encoding="utf-8")
    FLUX.write_text(flux(evs_flux, payload.get("generated_at", auj.isoformat())), encoding="utf-8")
    print(f"{PAGE.relative_to(ROOT)} : {len(evs_page)} événements ; {FLUX.relative_to(ROOT)} : {len(evs_flux)} entrées")


if __name__ == "__main__":
    main()
