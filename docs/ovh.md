# Mise en ligne sur OVH (agregatrail.gcsports.fr)

Le site reste construit par GitHub Actions (collecte Python, pages générées), puis il est envoyé
par FTP sur l'hébergement mutualisé OVH. Une petite API PHP (`site/api/`) ajoute les comptes,
l'ajout de courses par les membres et l'espace d'administration, avec une base MySQL.
GitHub Pages continue d'être publié tant qu'on ne l'a pas fermé ; sans PHP, il garde son
fonctionnement sans compte.

Prérequis : hébergement OVH avec PHP 8.1 ou plus (8.4 conseillé), une base MySQL, le sous-domaine
en HTTPS.

## 1. Préparer l'hébergement (espace client OVH)

1. **Multisite** : le sous-domaine `agregatrail.gcsports.fr` pointe vers un dossier, par exemple
   `agregatrail/`. Notez ce nom : c'est `OVH_FTP_DIR`.
2. **PHP** : Hébergement > Informations générales > Configuration : PHP 8.4.
3. **Base MySQL** : Hébergement > Bases de données > Créer une base (MySQL 8). Notez le serveur
   (`xxxxx.mysql.db`), le nom de la base, l'utilisateur et le mot de passe.
4. **E-mail d'envoi** : créez l'adresse d'expédition (par exemple `no-reply@gcsports.fr`). Les e-mails
   partent avec la fonction `mail()` de l'hébergement : aucun mot de passe de boîte n'est stocké.

## 2. Le fichier de configuration (jamais dans le dépôt)

Copiez `site/api/config.sample.php`, remplissez-le, puis déposez-le par FTP **à côté** du dossier
du site, pas dedans :

```
/agregatrail/                  <- racine du site (envoyée automatiquement)
/agregatrail-prive/config.php  <- votre configuration, déposée à la main une seule fois
```

L'envoi automatique ne touche jamais ce fichier. Les tables MySQL sont créées toutes seules au
premier appel de l'API.

## 3. Les secrets dans GitHub

Dépôt > Settings > Secrets and variables > Actions :

| Type | Nom | Valeur |
|---|---|---|
| Secret | `OVH_FTP_HOST` | serveur FTP, ex. `ftp.clusterXXX.hosting.ovh.net` |
| Secret | `OVH_FTP_USER` | identifiant FTP |
| Secret | `OVH_FTP_PASSWORD` | mot de passe FTP |
| Variable | `OVH_FTP_DIR` | dossier du site, ex. `agregatrail` |
| Variable | `SITE_URL` | `https://agregatrail.gcsports.fr/` |

Ensuite, Actions > « Mise à jour des données et déploiement » > Run workflow. Le premier envoi
transfère tout le site (quelques minutes) ; les suivants n'envoient que les fichiers modifiés
(`scripts/deploy_ftp.py` garde la liste des empreintes dans `.deploy-manifest.json` sur le serveur).

## 4. Créer le compte administrateur

Sur le site, Mon compte > Créer un compte, avec une adresse listée dans `admin_emails` de la
configuration. Après la confirmation par e-mail, le lien « Administration » apparaît.

## Fonctionnement

- **Lecture** : publique, sans compte, comme avant. Les listes, les semaines libres et les
  corrections restent dans le navigateur (`localStorage`).
- **Ajout de course** : réservé aux membres connectés à l'e-mail confirmé. La course est en attente
  jusqu'à ce que l'administrateur la publie (e-mail envoyé à l'admin, puis au membre).
- **Course publiée** : visible tout de suite sur la carte (`api/courses.php?action=publiees`),
  puis intégrée à la base au build suivant : le workflow télécharge l'export public
  (`api/courses.php?action=csv`) dans `data/sources/membres.csv`, lu par la source `membres`.
- **Import / export** (Administration) : export CSV des courses ajoutées et de toute la base ;
  import CSV au même format (mise à jour par id `membre-N`, ajout sinon), avec simulation.
- **Mise à jour** : chaque lundi (cron du workflow) et à chaque fusion sur `main`.

## Sécurité

- Mots de passe hachés (`password_hash`), jetons d'e-mail stockés hachés, à usage unique.
- Cookie de session `HttpOnly`, `Secure`, `SameSite=Lax` ; chaque écriture exige l'en-tête
  `X-Agregatrail` (un autre site ne peut pas l'ajouter) : protection contre le CSRF.
- Limitation des essais (connexion, inscription, mot de passe oublié) par adresse IP.
- `api/lib/` et les fichiers de configuration sont interdits en accès web (`.htaccess`).
- Les cellules CSV qui commencent par `=`, `+`, `-` ou `@` sont neutralisées pour les tableurs.

## Retour arrière

Supprimer les secrets `OVH_FTP_*` et la variable `SITE_URL` arrête l'envoi sur OVH ; GitHub Pages
reste publié tant qu'il n'est pas désactivé.
