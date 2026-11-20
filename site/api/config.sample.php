<?php
/* Modèle de configuration de l'API Agregatrail.
 *
 * NE JAMAIS COMMITER LE VRAI FICHIER : le dépôt est public.
 * Sur OVH, copiez ce modèle dans un dossier privé À CÔTÉ de la racine du site,
 * pas dedans, par exemple :
 *     /agregatrail-prive/config.php     (racine du site : /agregatrail/)
 * puis remplissez les valeurs ci-dessous. À défaut, api/config.php fonctionne aussi
 * (son accès web est bloqué par .htaccess), mais il serait effacé si le dossier est vidé.
 */
return [
    // Base MySQL OVH : Web Cloud > Hébergements > Bases de données (hôte du type xxxxx.mysql.db)
    'db_dsn'  => 'mysql:host=XXXXX.mysql.db;port=3306;dbname=XXXXX;charset=utf8mb4',
    'db_user' => 'XXXXX',
    'db_pass' => 'XXXXX',

    // Adresse publique du site (avec la barre finale)
    'site_url' => 'https://agregatrail.gcsports.fr/',

    // Comptes administrateurs : ces adresses obtiennent le rôle admin à l'inscription
    // et reçoivent un e-mail à chaque course proposée.
    'admin_emails' => ['vous@exemple.fr'],

    // Expéditeur des e-mails (adresse existante sur le domaine, envoyée par mail() d'OVH)
    'mail_from' => 'no-reply@gcsports.fr',
];
