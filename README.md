# ⛰️ Agregatrail

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
- Temps de route : dans « Choisir une zone », bascule « Distance / Temps de route » (15 min à 3 h).
  La zone devient l'isochrone calculée par l'[API Géoplateforme de l'IGN](https://geoservices.ign.fr/documentation/services/services-geoplateforme/isochrone)
  (sans clé, 5 requêtes par seconde au plus) ; chaque fiche affiche une durée estimée (« ≈ 30 à 45 min »),
  déduite de paliers emboîtés (15, 30, 45, 60, 90, 120… min), et le tri « les plus proches » suit ces tranches.
  Durées estimées en voiture, sans trafic. Si le service ne répond pas, la recherche repasse en distance.
  Logique dans `site/route.js` (requêtes espacées, cache de session) ; adresse `?autour=…&route=60`.
- Fiche d'une course (bouton « Fiche et courses proches ») : tous les formats, liens, et
  **courses qui ressemblent** (3 à 5) pour le format choisi, puis « Même profil, à une autre date »
  (au moins 4 semaines d'écart). Calcul dans le navigateur (`site/similaires.js`) : écart de distance,
  de D+ par km, de période dans l'année et de lieu ; les raisons du rapprochement sont affichées.
- Estimation de temps (dans la fiche) : à partir d'un chrono de référence (10 km, semi, marathon
  ou un trail déjà couru), une fourchette de temps pour chaque format dont le D+ est connu.
  Méthode km-effort + formule de Riegel (exposant 1,06), facteur de terrain selon le profil, fourchette
  -8 % / +15 % ; toujours affichée comme une estimation. Chrono gardé dans le navigateur
  (`localStorage`, clé `ta.chrono.v1`) ; logique dans `site/estimation.js`.
- Export agenda (bouton « Agenda » d'une liste) : fichier `.ics` (iCalendar, RFC 5545) à importer
  dans Google Agenda, Apple Calendrier ou Outlook. Un événement « journée entière » par format, avec
  lieu, coordonnées, distance, D+, heure de départ si connue et lien ; « (date à confirmer) » quand
  l'organisateur ne l'a pas confirmée. Les courses datées au mois près ne sont pas exportées (le
  message de confirmation en donne le nombre). Fichier construit dans le navigateur (`site/ical.js`).
- Historique des éditions (section « Éditions » de la fiche) : éditions précédentes avec leurs
  distances, habitude de calendrier (« 3e week-end de mai », marquée « estimation »), date probable
  quand la course n'est annoncée qu'au mois (« à confirmer par l'organisateur »), et changements de
  date relevés d'une semaine à l'autre. Calculé au build (`scripts/historique.py`), affiché par
  `site/historique.js` à partir de `site/data/historique.json` (environ 15 Ko, 3 Ko compressé).
- Nouveautés : page `/nouveautes/` (lien sous le compteur de l'accueil et en pied de page) avec les
  courses apparues, les dates confirmées et les D+ ajoutés des 4 dernières semaines, et flux Atom pour
  un lecteur de flux : `/flux/nouveautes.xml` (tout), `/flux/dates-confirmees.xml`,
  `/flux/region-<code>.xml` et `/flux/dep-<code>.xml`. Une nouveauté est datée du build où elle est
  relevée ; ce qui arrive d'un coup (premier build, nouvelle source : plus de 100 événements et plus de
  5 % de la base) n'est pas compté. Page et flux générés au déploiement (`scripts/nouveautes.py`, non versionnés).
- Couverture : sous le compteur de l'accueil, « couverture complète en Occitanie, PACA et
  Auvergne-Rhône-Alpes, partielle ailleurs » ; le lien ouvre le nombre de courses à venir par région,
  avec le niveau de couverture et le lien vers /qualite (`site/couverture.js`).
- Pages par événement : `/course/<nom>-<ville>-<année>/`, une page statique par course à venir (date,
  lieu, formats, liens officiels, données structurées schema.org `SportsEvent`, lien « Voir sur la carte »).
  La fiche de l'application y renvoie (« Page de la course »). Seules les pages dont toutes les données
  viennent d'une source ouverte (DATAtourisme, Licence Ouverte) sont indexables et listées dans
  `sitemap.xml` ; les autres portent `noindex`. Générées au déploiement (`scripts/pages.py`, non versionnées).
  Le site étant servi sous `/TRAIL-AGREGATOR/`, un `robots.txt` n'y serait pas lu : le sitemap se déclare
  dans Google Search Console.
- Trails par région et département : `/trails/` (lien en pied de page) puis `/trails/<region>/` et
  `/trails/<departement>-<code>/` (ex. `/trails/gard-30/`) : courses à venir classées par mois, liens vers
  les pages des courses et bouton « Voir sur la carte » (carte filtrée sur la région ou le département).
  Même règle d'indexation que les pages de courses : une liste n'est indexable que si toutes ses courses
  viennent d'une source ouverte. Générées au déploiement par `scripts/pages.py`.
- À propos : `/a-propos/` (lien en pied de page), page écrite à la main (`site/a-propos/index.html`) :
  engagements (rien n'est vendu, pas de compte ni de mesure d'audience), sources et licences, méthode,
  valeurs estimées, limites, comment contribuer. À tenir à jour quand une source ou une estimation change.
- Carte : points regroupés, fonds Plan (Plan IGN v2 de la Géoplateforme, sans clé), Relief (OpenTopoMap) et Satellite (Esri).
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
- Disponibilités (bêta) : puce « Week-ends dispo » (première des filtres rapides). Un clic retire
  les courses qui tombent un week-end indisponible (un sur deux, toute l'année) et
  affiche une pastille verte (date confirmée, week-end libre) ou orange (date à
  confirmer). Un bandeau résume l'effet ; le rythme se règle via « Régler l'alternance » (week-end de référence, période, garder
  ou non les rouges) ; réglage stocké dans le navigateur (`site/dispo.js`).

## Architecture

Site 100 % statique, hébergé sur GitHub Pages, sans serveur ni base à administrer.

```
data/sources/catalogue.csv   catalogue des courses, éditable à la main ou par PR
data/geocode_cache.json      cache du géocodage des villes
data/archive/editions.json   archive des éditions (dates, formats, changements), jamais vidée
data/archive/premiere_vue.json  apparition, date confirmée et D+ de chaque événement (nouveautés)
data/archive/sources.json    derniers relevés de chaque source (surveillance)
scripts/build_db.py          import des sources -> site/data/races.json, index.json et detail/
scripts/site_data.py         format des fichiers lus par le site (index léger + détail par région)
scripts/quality.py           tableau de bord qualité -> site/qualite/index.html (généré au déploiement)
scripts/nouveautes.py        nouveautés -> site/nouveautes/ et site/flux/*.xml (au déploiement)
scripts/pages.py             pages par événement et par région/département -> site/course/, site/trails/,
                             sitemap.xml, data/pages.json (au déploiement)
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
5. met à jour l'archive des éditions et `site/data/historique.json` (`scripts/historique.py`) ;
6. ne garde que les courses à venir ;
7. écrit les fichiers lus par le site (`scripts/site_data.py`).

### Fichiers de données du site

Pour un premier affichage rapide, le site ne charge pas `races.json` (4,7 Mo) :

- `site/data/index.json` (environ 0,75 Mo, 160 Ko compressé) : tout ce qu'il faut aux filtres,
  à la liste, à la carte et aux fiches, en colonnes, avec les textes répétés stockés une seule fois ;
- `site/data/detail/<code région>.json` : champs secondaires (code postal, heure de départ,
  participants, prix, notes, source), chargés seulement quand il le faut (export CSV).

Le km-effort, la catégorie UTMB et les points ITRA estimés ne sont pas publiés dans l'index :
`site/donnees.js` les recalcule avec les mêmes règles (et le même arrondi) que `build_db.py`.
`races.json` reste publié, complet, pour les versions du site encore en cache et pour qui
veut réutiliser les données ; il sera retiré plus tard.
Pour régénérer seulement l'index et le détail à partir de `races.json` :
`python3 scripts/build_db.py --export-only`.

Les contours `site/geo/*.geojson` sont arrondis à 4 décimales (environ 10 m,
`scripts/tools/arrondir_contours.py`) : deux fois plus légers, sans changement de rattachement.

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

### Qualité des données

La page [/qualite](https://gcsys.github.io/TRAIL-AGREGATOR/qualite/) (lien en pied de page) est
recalculée à chaque déploiement par `scripts/quality.py` à partir de `races.json` :

- taux de remplissage par région et par source d'origine (D+, jour précis, date confirmée,
  coordonnées, site web, lien d'inscription, organisateur, heure de départ) ;
- doublons probables : deux événements distincts le même jour (ou à un mois près si une date
  n'est connue qu'au mois), à moins de 15 km, avec un mot distinctif du nom en commun et une
  distance proche ;
- distances ou D+ incohérents (distance inconnue ou improbable, libellé « 42 km » pour 21 km,
  plus de 150 m D+/km hors kilomètre vertical, D+ nul) ;
- formats sans coordonnées ou hors des trois régions couvertes.

Le même résumé s'affiche dans l'onglet *Actions*, à la fin de chaque exécution. La page n'est pas
versionnée (`site/qualite/` est ignoré par git) ; pour la voir en local : `python3 scripts/quality.py`.

### Surveillance des sources

À chaque build, `scripts/surveillance.py` compare chaque source à son relevé précédent
(`data/archive/sources.json` : nombre de lignes, colonnes renseignées, remplissage de la date, de la
ville, de la distance, du D+, des coordonnées et du site). Une issue « surveillance » est ouverte
(ou complétée si elle l'est déjà) quand :

- une source perd plus de 20 % de ses lignes (et au moins 10), ou n'en renvoie plus aucune ;
- son format change : une colonne n'est plus jamais renseignée, ou un champ perd au moins 30 points
  de remplissage ;
- la collecte échoue (DATAtourisme : jeu de données injoignable, fichier ou colonnes absents) et la
  dernière version connue a été utilisée.

Une même alerte n'est signalée qu'une fois, pas à chaque build. Fermez l'issue une fois vérifié.

### Compléter un D+

Ouvrez une issue « Compléter ou corriger une course », ou ajoutez une ligne à
`data/sources/denivele.csv` (nom, ville, distance, D+, site).

### Ajouter une course

Ajoutez une ligne à `data/sources/catalogue.csv`. `lat`/`lon` sont facultatifs :
s'ils sont vides, la ville est géocodée automatiquement.

### Ajouter une source

Créez `scripts/sources/ma_source.py` avec `NAME` et une fonction `fetch()` qui
renvoie des dictionnaires aux mêmes colonnes que le catalogue, puis ajoutez-la à
`SOURCES`. Facultatif : une variable `ETAT` (« direct », ou la raison d'un échec) que la
surveillance des sources signale. N'utilisez que des sources dont les conditions d'utilisation autorisent
la réutilisation (open data, API publiques, flux fournis par les organisateurs).

## Tests

```bash
python3 -m unittest discover -s tests/python   # fusion des sources, calculs, géographie, index, qualité
node --test tests/js/*.test.js                 # filtres, zone, disponibilités, favoris, décodage de l'index
```

Aucune dépendance : `unittest` (Python) et `node --test` (Node 18 ou plus) sont fournis d'origine.
La logique des filtres et de la zone est dans `site/filtres.js`, sans DOM, pour être testable.
Dans GitHub Actions, le workflow `tests.yml` tourne sur chaque PR et avant chaque mise à jour du site :
si un test échoue, rien n'est publié. Après la collecte, un contrôle vérifie aussi que
l'index publié correspond bien à `races.json`.

### Dédoublonnage

Une même course peut venir de plusieurs sources. `scripts/enrich.py` rapproche les événements
(même commune et même mois, ou commune voisine du même département avec un nom quasi identique ;
une date connue au mois près peut être décalée d'un mois), puis fusionne les formats de distance
proche (à 2 km ou 10 % près) : la fiche garde la date exacte, le D+, le site et l'heure de départ
apportés par chaque source.

- Un événement absent du catalogue mais vu par RunTrail et GoTrail donne une seule fiche.
- Le département des courses GoTrail (qui n'en donnent pas) est déduit de leurs coordonnées,
  pour les comparer aux courses du même département.
- Un nom générique (« Trail nocturne », « Corrida ») ne suffit pas à rapprocher deux communes.
- « La Saintlo » et « La Saint Lo » dans la même commune sont reconnus comme un seul événement.

Les cas restants sont listés dans la page [/qualite](https://gcsys.github.io/TRAIL-AGREGATOR/qualite/).

## Lancer en local

```bash
python3 scripts/build_db.py        # NO_GEOCODE=1 : géocodage par le cache seulement
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
