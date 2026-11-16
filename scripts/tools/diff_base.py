"""Résumé des changements entre deux versions de site/data/races.json (Markdown).

Usage : python scripts/tools/diff_base.py ancien.json nouveau.json > resume.md
Une course est identifiée par son nom d'événement, sa commune et sa distance
(les identifiants peuvent changer quand une date passe du mois au jour).
"""
import json
import sys
from collections import Counter
from datetime import date


def load(p):
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    return d["races"] if isinstance(d, dict) else d


def key(r):
    return (r["nom"].strip().lower(), r["ville"].strip().lower(), r.get("distance_km"))


def ev(r):
    return (r["nom"].strip().lower(), r["ville"].strip().lower())


def main(old_p, new_p):
    old, new = load(old_p), load(new_p)
    o = {key(r): r for r in old}
    n = {key(r): r for r in new}
    added = [n[k] for k in n.keys() - o.keys()]
    removed = [o[k] for k in o.keys() - n.keys()]
    common = [(o[k], n[k]) for k in n.keys() & o.keys()]
    date_precise = [(a, b) for a, b in common if len(a["date"] or "") == 7 and len(b["date"] or "") == 10]
    date_moved = [(a, b) for a, b in common if (a["date"] or "") != (b["date"] or "") and (a, b) not in date_precise]
    conf = [(a, b) for a, b in common if not a.get("date_confirmee") and b.get("date_confirmee")]
    dplus_new = [(a, b) for a, b in common if a.get("denivele_pos_m") is None and b.get("denivele_pos_m") is not None]
    dplus_chg = [(a, b) for a, b in common if a.get("denivele_pos_m") is not None and b.get("denivele_pos_m") is not None
                 and a["denivele_pos_m"] != b["denivele_pos_m"]]
    fill = Counter()
    for a, b in common:
        for f in ("site_web", "organisateur", "heure_depart", "participants_max"):
            if not a.get(f) and b.get(f):
                fill[f] += 1
    passed = [r for r in removed if (r["date"] or "")[:len(r["date"] or "")] < date.today().isoformat()[:len(r["date"] or "") or 10]]
    out = []
    w = out.append
    w(f"**{len(old)} → {len(new)} formats** · D+ connu : {sum(1 for r in old if r.get('denivele_pos_m') is not None)} → "
      f"{sum(1 for r in new if r.get('denivele_pos_m') is not None)}\n")
    w(f"- Formats ajoutés : **{len(added)}** ({len({ev(r) for r in added})} événements)")
    w(f"- Formats retirés : **{len(removed)}** (dont {len(passed)} courses passées)")
    w(f"- Dates précisées (mois → jour) : **{len(date_precise)}**")
    w(f"- Dates modifiées : **{len(date_moved)}**")
    w(f"- Dates nouvellement confirmées par l'organisateur : **{len(conf)}**")
    w(f"- D+ complétés : **{len(dplus_new)}** · D+ corrigés : **{len(dplus_chg)}**")
    if fill:
        w("- Autres champs complétés : " + ", ".join(f"{k} {v}" for k, v in fill.most_common()))

    def table(title, rows, cols, limit=25):
        if not rows:
            return
        w(f"\n<details><summary>{title} ({len(rows)})</summary>\n")
        w("| " + " | ".join(c for c, _ in cols) + " |")
        w("|" + "---|" * len(cols))
        for r in rows[:limit]:
            w("| " + " | ".join(str(f(r)) for _, f in cols) + " |")
        if len(rows) > limit:
            w(f"\n… et {len(rows) - limit} autres")
        w("\n</details>")

    lbl = lambda r: f"{r['nom']} ({r['ville']}) {r.get('course') or ''}".replace("|", "/")
    table("Nouveaux événements", sorted({ev(r): r for r in added}.values(), key=lambda r: r["date"] or ""),
          [("Date", lambda r: r["date"]), ("Course", lambda r: f"{r['nom']} ({r['ville']})".replace("|", "/")),
           ("Région", lambda r: r.get("region") or "")])
    table("Dates modifiées", date_moved, [("Course", lambda p: lbl(p[1])), ("Avant", lambda p: p[0]["date"]),
                                          ("Après", lambda p: p[1]["date"])])
    table("D+ corrigés", dplus_chg, [("Course", lambda p: lbl(p[1])), ("Avant", lambda p: p[0]["denivele_pos_m"]),
                                     ("Après", lambda p: p[1]["denivele_pos_m"])])
    table("D+ complétés", dplus_new, [("Course", lambda p: lbl(p[1])), ("D+", lambda p: p[1]["denivele_pos_m"]),
                                      ("Source", lambda p: p[1].get("source"))])
    print("\n".join(out))


if __name__ == "__main__":
    main(*sys.argv[1:3])
