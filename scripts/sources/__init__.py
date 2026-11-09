"""Sources de données.

Chaque module de ce dossier expose une fonction ``fetch() -> list[dict]`` qui
renvoie des courses au format du catalogue (voir data/sources/catalogue.csv).
Pour ajouter une source : créer un module, puis l'ajouter à SOURCES ci-dessous.

Règle : n'ajouter que des sources dont les conditions d'utilisation autorisent
la réutilisation (API ouvertes, open data, partenariats, flux fournis par les
organisateurs). Pas de scraping de sites qui l'interdisent.
"""
from . import catalogue, datatourisme

SOURCES = [catalogue, datatourisme]
