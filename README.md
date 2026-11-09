# ⛰️ Trail Agrégateur

Agrégateur de courses de trail en France : sélectionnez une zone sur la carte
(départements, régions, périmètre dessiné à main levée, polygone, rectangle ou
cercle), puis filtrez les courses dans un tableau.

**Site :** https://gcsys.github.io/TRAIL-AGREGATOR/

## Fonctionnalités

- Carte Leaflet / OpenStreetMap avec contours des départements et régions cliquables.
- Dessin de périmètres (main levée, polygone, rectangle, cercle), combinables entre eux.
- Filtres : recherche texte, dates, distance min/max, D+ min/max, km-effort,
  catégorie UTMB Index (20K/50K/100K/100M), UTMB World Series, points ITRA,
  type (trail/ultra/KV), nocturne.
- Tableau triable, clic sur une ligne pour centrer la carte, export CSV.

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
