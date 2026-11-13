"""Transforme une issue « Compléter ou corriger une course » en modification des données.

Lancé par .github/workflows/contribution.yml quand une issue reçoit l'étiquette « validé » (que seuls les
mainteneurs peuvent poser). Le texte de l'issue est une donnée non fiable : chaque champ est vérifié
(longueur, nombres dans des bornes, dates AAAA-MM-JJ, liens https) et rien n'est exécuté.

- Course déjà connue (identifiant ou nom + commune) :
  D+ -> data/sources/denivele.csv ; inscriptions (statut, ouverture, mode, lien, prix) ->
  data/sources/inscriptions.csv. Un changement de date est signalé dans la PR, à reporter à la main.
- Course inconnue : une ligne par format dans data/sources/catalogue.csv (date non confirmée).

    python scripts/contribution.py corps_issue.md numero_issue [resume.md]
Code de sortie : 0 si au moins une ligne a été ajoutée, 2 sinon (le résumé dit pourquoi).
Bibliothèque standard uniquement.
"""
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import enrich  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "data" / "sources"
RACES = ROOT / "site" / "data" / "races.json"
VIDE = {"", "_no response_", "je ne sais pas", "none"}
STATUTS = {"pas encore ouvertes": "a_venir", "ouvertes": "ouvertes", "complet": "complet", "closes": "fermees"}
MODES = {"inscription libre": "libre", "tirage au sort": "tirage", "sur qualification": "qualification"}
CHAMPS = {"Nom de la course": "nom", "Commune de départ": "ville", "Département (numéro)": "departement",
          "Date (AAAA-MM-JJ)": "date", "Distances et D+": "formats", "Site officiel": "site",
          "Site officiel ou lien d'inscription": "site", "Lien d'inscription": "inscription",
          "Inscriptions": "statut", "Date d'ouverture des inscriptions (AAAA-MM-JJ)": "ouverture",
          "Mode d'attribution des dossards": "mode", "Prix (si un seul format, ou celui du format principal)": "prix",
          "Où avez-vous trouvé l'information ?": "source", "Identifiant Agregatrail": "ref"}


def lire(corps):
    """Corps d'une issue de formulaire (« ### Libellé » puis la réponse) -> {champ: texte}."""
    out = {}
    for bloc in re.split(r"^### ", corps.replace("\r\n", "\n"), flags=re.M)[1:]:
        libelle, _, valeur = bloc.partition("\n")
        cle = CHAMPS.get(libelle.strip())
        valeur = valeur.strip()
        if cle and valeur.lower() not in VIDE:
            out[cle] = valeur
    return out


def texte(v, n=120):
    """Texte d'une ligne, sans caractère qui ferait une formule dans un tableur."""
    v = re.sub(r"\s+", " ", v or "").strip()[:n]
    return v.lstrip("=+-@\t") if v else ""


def lien(v):
    v = (v or "").strip()
    return v if re.fullmatch(r"https://[^\s\"'<>]{4,300}", v) else ""


def jour(v):
    v = (v or "").strip()
    try:
        return v if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) and date.fromisoformat(v) else ""
    except ValueError:
        return ""


def nombre(v, lo, hi):
    try:
        x = float(re.sub(r"\s|€|km|m$", "", (v or "").strip().lower()).replace(",", "."))
    except ValueError:
        return None
    return x if lo <= x <= hi else None


def formats(v):
    """« 42 ; 2500 » par ligne -> [(km, D+ ou None)], lignes illisibles ignorées."""
    out = []
    for ligne in (v or "").splitlines():
        parts = [p for p in re.split(r"[;|/]", ligne)]
        km = nombre(parts[0], 0.5, 400)
        if km is None:
            continue
        dp = nombre(parts[1], 0, 30000) if len(parts) > 1 and parts[1].strip() else None
        out.append((km, dp))
    return out


def chercher(races, ref, nom, ville):
    if ref:
        rows = [r for r in races if r["id"] == ref]
        if rows:
            r = rows[0]
            return [x for x in races if enrich.norm(x["ville"]) == enrich.norm(r["ville"]) and x["nom"] == r["nom"]]
    return [r for r in races if enrich.norm(r["ville"]) == enrich.norm(ville)
            and (enrich.tokens(r["nom"]) & enrich.tokens(nom) or enrich.norm(r["nom"]) == enrich.norm(nom))]


def ajouter(path, ligne):
    with path.open(encoding="utf-8", newline="") as f:
        entete = next(csv.reader(f))
    with path.open("a", encoding="utf-8", newline="") as f:
        csv.DictWriter(f, fieldnames=entete, extrasaction="ignore", lineterminator="\n").writerow(ligne)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", enrich.norm(s)).strip("-")[:50]


def traiter(champs, numero, races, aujourdhui=None, sources=SOURCES):
    """Ajoute les lignes aux CSV ; renvoie (nombre de lignes, résumé markdown)."""
    aujourdhui = aujourdhui or date.today().isoformat()
    nom, ville = texte(champs.get("nom")), texte(champs.get("ville"), 80)
    if not nom or not ville:
        return 0, "Nom de la course ou commune manquant."
    fmts = formats(champs.get("formats"))
    site, insc, src = lien(champs.get("site")), lien(champs.get("inscription")), lien(champs.get("source"))
    d, ouv = jour(champs.get("date")), jour(champs.get("ouverture"))
    statut = STATUTS.get((champs.get("statut") or "").lower(), "")
    mode = MODES.get((champs.get("mode") or "").lower(), "")
    prix = nombre(champs.get("prix"), 0, 2000)
    connues = chercher(races, texte(champs.get("ref"), 80), nom, ville)
    lignes, notes = [], []
    if connues:
        r0 = connues[0]
        notes.append(f"Course reconnue : **{r0['nom']}** ({r0['ville']}), {len(connues)} format(s) dans la base.")
        nom, ville = r0["nom"], r0["ville"]
        for km, dp in fmts:
            if dp is not None:
                deja = [x["denivele_pos_m"] for x in connues if x.get("denivele_pos_m") is not None
                        and x.get("distance_km") is not None and enrich.close(x["distance_km"], km)]
                if deja and abs(deja[0] - dp) > 1:
                    notes.append(f"⚠️ {km:g} km : la base a déjà {deja[0]:g} m D+ (proposé : {dp:g} m). "
                                 "`denivele.csv` ne remplace pas un D+ existant : à corriger à la source si besoin.")
                ajouter(sources / "denivele.csv", {"nom": nom, "ville": ville, "distance_km": f"{km:g}",
                                                  "denivele_pos_m": f"{dp:g}", "site_web": site, "source_url": src or site})
                lignes.append(f"`denivele.csv` : {km:g} km, {dp:g} m D+")
        if statut or ouv or mode or insc or prix is not None:
            km0 = f"{fmts[0][0]:g}" if prix is not None and fmts else ""
            ajouter(sources / "inscriptions.csv", {"nom": nom, "ville": ville, "distance_km": km0, "statut": statut,
                                                   "ouverture": ouv, "mode": mode, "lien_inscription": insc,
                                                   "prix_eur": f"{prix:g}" if prix is not None and km0 else "",
                                                   "releve_le": aujourdhui, "source_url": src})
            lignes.append("`inscriptions.csv` : " + ", ".join(x for x in (statut, ouv and f"ouverture {ouv}", mode,
                                                                          insc and "lien", km0 and f"{prix:g} € ({km0} km)") if x))
        if d and d not in {x.get("date") for x in connues}:
            notes.append(f"⚠️ Date proposée : {d} (base : {r0.get('date') or 'inconnue'}). Les dates viennent des sources : "
                         "à vérifier et reporter à la main si besoin.")
        if prix is not None and not fmts:
            notes.append("Prix ignoré : aucun format indiqué pour le rattacher.")
    else:
        dep = (champs.get("departement") or "").strip().upper()
        dep = dep.zfill(2) if re.fullmatch(r"\d{1,3}|2[AB]", dep) else ""
        if not fmts:
            return 0, "Course inconnue de la base et aucune distance lisible : rien à ajouter."
        if not (d or dep):
            notes.append("Ni date ni département : la course sera placée par sa commune et datée à la main.")
        for km, dp in fmts:
            ajouter(sources / "catalogue.csv", {
                "id": f"contrib-{numero}-{slug(nom)}-{km:g}".replace(".", "-"), "nom": nom, "course": f"{km:g} km",
                "date": d, "date_confirmee": "false", "ville": ville, "departement": dep, "distance_km": f"{km:g}",
                "denivele_pos_m": "" if dp is None else f"{dp:g}", "site_web": site, "lien_inscription": insc,
                "utmb_world_series": "false", "type": "trail", "nocturne": "false",
                "notes": f"Contribution (issue #{numero})", "source_url": src or site})
            lignes.append(f"`catalogue.csv` : {nom}, {km:g} km" + (f", {dp:g} m D+" if dp is not None else ""))
    resume = [f"Proposition de l'issue #{numero}.", ""] + notes + [""] + [f"- {x}" for x in lignes]
    if not lignes:
        resume.append("Aucune donnée exploitable (D+, inscriptions ou nouvelle course) : rien n'a été modifié.")
    return len(lignes), "\n".join(resume).strip() + "\n"


def main():
    corps, numero = Path(sys.argv[1]).read_text(encoding="utf-8"), int(sys.argv[2])
    races = json.loads(RACES.read_text(encoding="utf-8"))["races"]
    n, resume = traiter(lire(corps), numero, races)
    print(resume)
    if len(sys.argv) > 3:
        Path(sys.argv[3]).write_text(resume, encoding="utf-8")
    sys.exit(0 if n else 2)


if __name__ == "__main__":
    main()
