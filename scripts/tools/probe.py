"""Sonde manuelle : affiche la structure HTML de quelques pages sources (lancé par Actions)."""
import re, sys, time, urllib.request

UA = "Mozilla/5.0 (compatible; trail-agregator/1.0; projet perso)"
URLS = sys.argv[1:]

def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Language": "fr"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.geturl(), r.read().decode("utf-8", "replace")

for u in URLS:
    print("=" * 100, "\n", u, flush=True)
    try:
        st, final, html = get(u)
    except Exception as e:
        print("ERREUR", e); continue
    print("status", st, "final", final, "len", len(html))
    if u.endswith("robots.txt"):
        print(html[:3000]); continue
    for tag in ("application/ld+json", "__NEXT_DATA__", "__NUXT__", "wire:", "x-data", "data-page="):
        print(tag, html.count(tag))
    body = re.sub(r"<script(?![^>]*ld\+json)[\s\S]*?</script>|<style[\s\S]*?</style>|<svg[\s\S]*?</svg>", "", html)
    body = re.sub(r"\s+", " ", body)
    i = max(0, (re.search(r"\d\s?km", body) or re.search(r"<main", body) or re.search("x", body)).start() - 1500)
    if "TEXT" in __import__("os").environ:
        txt = re.sub(r"<[^>]+>", " | ", body); txt = re.sub(r"(\s*\|\s*)+", " | ", txt)
        print("TEXT:", txt[:20000])
    else:
        print(body[i:i + 7000])
    for m in re.findall(r'<script type="application/ld\+json">([\s\S]*?)</script>', html)[:2]:
        print("LDJSON:", m[:2500])
    hrefs = list(dict.fromkeys(re.findall(r'href="([^"]+)"', html)))
    print("HREFS", len(hrefs)); print("\n".join(h for h in hrefs if not h.startswith("https://storage"))[:6000])
    time.sleep(2)
