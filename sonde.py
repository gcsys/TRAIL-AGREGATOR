import csv, io, json, re, sys, collections
from datetime import date
sys.path.insert(0, "main/scripts")
from sources import datatourisme as D
csv.field_size_limit(10**9)
meta = json.loads(D._get(D.DATASET_API, 60))
res = meta["resources"]
print("NB RES", len(res))
for r in res:
    print("RES", r["title"], r.get("filesize"), r.get("last_modified", "")[:10])
fma = [r for r in res if r["title"] == D.RESOURCE_TITLE]
print("FMA", [(r["url"]) for r in fma])
for r in fma:
    try: D._get(r["url"], 60); print("FMA OK")
    except Exception as e: print("FMA ERR", e)
occ = next(r for r in res if r["title"] == "datatourisme-reg-occ.csv")
raw = D._get(occ["url"]).decode("utf-8", "replace")
rd = csv.DictReader(io.StringIO(raw))
print("COLONNES", rd.fieldnames)
rows = list(rd); print("LIGNES OCC", len(rows))
for c in rd.fieldnames:
    vals = collections.Counter((r.get(c) or "")[:60] for r in rows)
    print("COL", c, "distinct", len(vals), "vides", vals.get("", 0), "ex", [v for v, _ in vals.most_common(4)])
cols = [c for c in rd.fieldnames if re.search(r"cat|type|th[eè]m|class", c, re.I)]
for c in cols:
    cnt = collections.Counter(v.strip() for r in rows for v in re.split(r"[|#,]", r.get(c) or "") if v.strip())
    print("VALEURS", c, cnt.most_common(60))
today = date.today().isoformat()
nomc = next((c for c in rd.fieldnames if "Nom" in c), None)
perc = next((c for c in rd.fieldnames if "riode" in c), None)
print("NOM", nomc, "PERIODES", perc)
if nomc:
    t = [r for r in rows if D.TRAIL_WORDS.search(r[nomc] or "")]
    print("NOM TRAIL", len(t))
    fut = [r for r in t if perc and D.first_date(r.get(perc) or "", today)]
    print("NOM TRAIL A VENIR", len(fut))
    for r in t[:15]:
        print("  EX", json.dumps({k: (v or "")[:90] for k, v in r.items()}, ensure_ascii=False))
