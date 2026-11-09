# ⛰️ Trail Agrégateur

Agrégateur de courses de trail en France : sélectionnez une zone sur la carte
(départements, régions, périmètre dessiné à main levée, polygone, rectangle ou
cercle), puis filtrez les courses dans un tableau.

**Site :** https://gcsys.github.io/TRAIL-AGREGATOR/

## Fonctionnalités

- Page d'accueil avec recherche intelligente : une ville (« autour de Millau »), un département,
  une région ou le nom d'une course.
- Fiches par course : tous les formats d'un même événement (distance, D+, labels) sur une seule fiche.
- Sur ordinateur, liste et carte côte à côte ; sur téléphone, bascule « Carte / Liste » en bas d'écran.
- Zone de recherche pensée pour le tactile : rayon autour d'une ville, de sa position ou d'un point
  touché (centre déplaçable, rayon réglable), « Rechercher dans cette zone » après avoir cadré la carte,
  départements et régions (au toucher ou par liste), tracé au doigt. Sur ordinateur : polygone et rectangle en plus.
- Carte : points regroupés, fonds Plan, Relief (OpenTopoMap) et Satellite.
- Filtres : mois, dates, distance, D+, profil (roulant, vallonné, montagne en m D+/km), km-effort,
  UTMB Index, World Series, ITRA, type, nocturne, D+ connu, date confirmée, site officiel.
  Filtres actifs affichés en étiquettes supprimables ; la recherche est enregistrée dans l'adresse de la page.
- Tri (date, proximité, distance, D+, km-effort, nom), vue tableau sur ordinateur, export CSV.
- Favoris : étoile sur chaque format, listes nommées consultables depuis « Mes listes »
  (adresse `?liste=…`, retour à l'accueil par le bouton « Toutes les courses », le logo ou le retour du téléphone)
  et partageables par lien (`#liste=…`).
- Corrections personnelles (date officielle, km exact, D+, lien d'inscription,
  site, notes) qui remplacent les données affichées et recalculent km-effort,
  UTMB Index et ITRA ; bouton « Proposer à la base » vers le formulaire d'issue.
  Listes et corrections sont stockées dans le navigateur (`localStorage`,
  logique dans `site/favoris.js`) ; les notes perso ne sont pas partagées.

## Architecture

Site 100 % statique, hébergé sur GitHub Pages, sans serveur ni base à administrer.

```
data/sources/catalogue.csv   catalogue des courses, éditable à la main ou par PR
data/geocode_cache.json      cache du géocodage des villes
scripts/build_db.py          import des sources -> site/data/races.json
scripts/sources/             une source = un module avec fetch()
site/                        le site publié (HTML/JS/CSS, données, contours)
.github/workflows/           routine hebdomadaire + déploiement Pages
```

### La « base de données »

`site/data/races.json` est généré par `scripts/build_db.py`, qui :

1. collecte les courses de toutes les sources déclarées dans `scripts/sources/__init__.py` ;
2. géocode les villes sans coordonnées via l'[API Adresse](https://adresse.data.gouv.fr/api-doc/adresse) (avec cache) ;
3. rattache chaque course à son département et sa région (point dans polygone) ;
4. calcule le km-effort (km + D+/100), une catégorie UTMB Index et des points ITRA **estimés** ;
5. ne garde que les courses à venir.

La routine GitHub Actions relance ce script chaque lundi, commit le JSON s'il a
changé et redéploie le site. On peut aussi la lancer à la main depuis l'onglet
*Actions* (« Run workflow »).

### Sources

| Source | Contenu | Conditions |
|---|---|---|
| `data/sources/catalogue.csv` | catalogue principal (dont ~820 trails Occitanie/PACA relevés sur les listes publiques de Miles Republic) | — |
| [DATAtourisme](https://www.data.gouv.fr/fr/datasets/datatourisme-2/) | événements trail saisis par les offices de tourisme : dates exactes, site officiel, parfois le D+ | Licence Ouverte 2.0 |
| [RunTrail](https://www.runtrail.run) | trails Occitanie, PACA, ARA : D+ par format (collecte hebdomadaire incrémentale, 3 s entre requêtes) | robots.txt ouvert, usage perso |
| [GoTrail](https://gotrail.run) | calendriers régionaux : dates exactes, coordonnées GPS, distances | robots.txt ouvert, usage perso |
| `data/sources/denivele.csv` | D+ relevés sur les sites des organisateurs ou proposés via le formulaire | — |

Non utilisées car leurs conditions ou leur robots.txt l'interdisent : Finishers, ATS Sport, Ultra Race Calendar, ITRA, UTMB World, Betrail, Kikourou (robots.txt bloque les IA), Ahotu (refuse les robots).

### Compléter un D+

Ouvrez une issue « Compléter ou corriger une course », ou ajoutez une ligne à
`data/sources/denivele.csv` (nom, ville, distance, D+, site).

### Ajouter une course

Ajoutez une ligne à `data/sources/catalogue.csv`. `lat`/`lon` sont facultatifs :
s'ils sont vides, la ville est géocodée automatiquement.

### Ajouter une source

Créez `scripts/sources/ma_source.py` avec `NAME` et une fonction `fetch()` qui
renvoie des dictionnaires aux mêmes colonnes que le catalogue, puis ajoutez-la à
`SOURCES`. N'utilisez que des sources dont les conditions d'utilisation autorisent
la réutilisation (open data, API publiques, flux fournis par les organisateurs).

## Lancer en local

```bash
python3 scripts/build_db.py
cd site && python3 -m http.server 8000
# puis http://localhost:8000
```

## Avertissement

Les données actuelles sont des **exemples à vérifier** : dates estimées (marquées
« ~ »), distances et dénivelés approximatifs. Les catégories UTMB Index et points
ITRA sont des estimations, pas des valeurs officielles.

## Licences

Code : MIT. Bibliothèques incluses dans `site/vendor/` : Leaflet (BSD-2),
Leaflet.draw (MIT), Turf (MIT). Contours : [france-geojson](https://github.com/gregoiredavid/france-geojson)
(Licence Ouverte, données IGN/INSEE). Fonds de carte © contributeurs OpenStreetMap.
