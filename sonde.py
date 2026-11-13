import csv, io, json, re, sys, urllib.request, collections
from datetime import date
sys.path.insert(0, "main/scripts")
from sources import datatourisme as D
csv.field_size_limit(10**9)
for u in [D.DATASET_API, "https://www.data.gouv.fr/api/1/datasets/?q=datatourisme&page_size=20", "https://www.data.gouv.fr/api/1/datasets/datatourisme-2/"]:
    try:
        j = json.loads(D._get(u, 60)); print("OK", u)
        for d in j.get("data", [j]):
            print("DS", d.get("id"), d.get("slug"), d.get("title"), d.get("organization", {}) and d["organization"].get("name"), d.get("last_update"), d.get("archived"), d.get("deleted"))
            for r in [r for r in d.get("resources", []) if not r.get("title","").endswith(".nt.zip")][:12]:
                print("   RES", r.get("title"), r.get("filesize"), r.get("format"), r.get("last_modified"), r.get("url"))
    except Exception as e:
        print("ERR", u, e)
print("FIN RECHERCHE"); sys.exit(0)
for r in meta["resources"]:
    print("RES", r["title"], r.get("filesize"), r.get("format"), r["url"])
url = next(r["url"] for r in meta["resources"] if r["title"] == D.RESOURCE_TITLE)
raw = D._get(url).decode("utf-8", "replace")
rd = csv.DictReader(io.StringIO(raw))
print("COLONNES", rd.fieldnames)
rows = list(rd); print("LIGNES", len(rows))
today = date.today().isoformat()
fut = [r for r in rows if D.first_date(r.get("Periodes_regroupees") or "", today)]
print("A VENIR", len(fut))
nom = [r for r in fut if D.TRAIL_WORDS.search(r["Nom_du_POI"] or "")]
nom_ok = [r for r in nom if not D.EXCLUDE_WORDS.search(r["Nom_du_POI"])]
print("NOM TRAIL", len(nom), "APRES EXCLUSION", len(nom_ok))
desc = [r for r in fut if not D.TRAIL_WORDS.search(r["Nom_du_POI"] or "") and D.TRAIL_WORDS.search(r.get("Description") or "")]
print("DESC SEULE TRAIL", len(desc))
cols = [c for c in rd.fieldnames if re.search(r"cat|type|th[eè]m|class", c, re.I)]
print("COLS CAT", cols)
for c in cols:
    cnt = collections.Counter(v.strip() for r in nom_ok for v in re.split(r"[|#,]", r.get(c) or "") if v.strip())
    print("VALEURS", c, cnt.most_common(40))
    cnt2 = collections.Counter(v.strip() for r in fut for v in re.split(r"[|#,]", r.get(c) or "") if v.strip())
    print("VALEURS TOUT", c, cnt2.most_common(80))
dep = collections.Counter((r.get("Code_postal_et_commune") or "")[:2] for r in nom_ok)
print("DEPS", sorted(dep.items()))
print("EXEMPLES DESC SEULE")
for r in desc[:60]:
    print("  ", r["Nom_du_POI"], "|", (r.get("Code_postal_et_commune") or ""), "|", re.sub(r"\s+", " ", (r.get("Description") or ""))[:160])
print("EXEMPLES NOM EXCLUS")
for r in [r for r in nom if D.EXCLUDE_WORDS.search(r["Nom_du_POI"])][:40]:
    print("  ", r["Nom_du_POI"])
print("EXEMPLE LIGNE", json.dumps({k: (v or "")[:200] for k, v in nom_ok[0].items()}, ensure_ascii=False, indent=1) if nom_ok else "")
for kw in ["course à pied", "course a pied", "course nature", "running", "ultra", "skyrunning", "marathon", "semi-marathon", "corrida", "cross"]:
    n = sum(1 for r in fut if re.search(r"\b" + kw + r"\b", r["Nom_du_POI"] or "", re.I))
    print("MOT NOM", kw, n)
