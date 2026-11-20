<?php
/* Création des tables au premier appel (MySQL sur OVH, SQLite pour les tests).
 * Les dates sont stockées en texte UTC « AAAA-MM-JJ HH:MM:SS ». */
declare(strict_types=1);

function at_schema(PDO $db): void
{
    $mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    try {
        $v = (int)$db->query("SELECT valeur FROM at_meta WHERE cle = 'schema'")->fetchColumn();
        if ($v >= AT_VERSION_SCHEMA) return;
    } catch (PDOException $e) {
        // tables absentes : première installation
    }
    $id = $mysql ? 'INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $ref = $mysql ? 'INT UNSIGNED' : 'INTEGER';
    $fin = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $sql = [
        "CREATE TABLE IF NOT EXISTS at_meta (cle VARCHAR(40) NOT NULL PRIMARY KEY, valeur VARCHAR(255) NOT NULL)$fin",
        "CREATE TABLE IF NOT EXISTS at_users (
            id $id,
            email VARCHAR(190) NOT NULL UNIQUE,
            nom VARCHAR(80) NOT NULL,
            mdp VARCHAR(255) NOT NULL,
            role VARCHAR(10) NOT NULL DEFAULT 'membre',
            cree_le VARCHAR(19) NOT NULL,
            verifie_le VARCHAR(19) NULL,
            jeton_verif CHAR(64) NULL,
            jeton_reset CHAR(64) NULL,
            reset_expire VARCHAR(19) NULL,
            bloque TINYINT NOT NULL DEFAULT 0
        )$fin",
        // Une ligne = un format de course, au format du catalogue (data/sources/catalogue.csv).
        "CREATE TABLE IF NOT EXISTS at_courses (
            id $id,
            groupe CHAR(16) NOT NULL,
            user_id $ref NULL,
            statut VARCHAR(10) NOT NULL DEFAULT 'attente',
            origine VARCHAR(10) NOT NULL DEFAULT 'membre',
            nom VARCHAR(160) NOT NULL,
            course VARCHAR(120) NOT NULL DEFAULT '',
            date VARCHAR(10) NOT NULL,
            date_confirmee TINYINT NOT NULL DEFAULT 1,
            ville VARCHAR(120) NOT NULL,
            code_postal VARCHAR(5) NOT NULL DEFAULT '',
            departement VARCHAR(3) NOT NULL DEFAULT '',
            lat DOUBLE NULL,
            lon DOUBLE NULL,
            distance_km DOUBLE NULL,
            denivele_pos_m INT NULL,
            heure_depart VARCHAR(5) NOT NULL DEFAULT '',
            organisateur VARCHAR(160) NOT NULL DEFAULT '',
            site_web VARCHAR(300) NOT NULL DEFAULT '',
            lien_inscription VARCHAR(300) NOT NULL DEFAULT '',
            type VARCHAR(20) NOT NULL DEFAULT 'trail',
            nocturne TINYINT NOT NULL DEFAULT 0,
            prix_eur DOUBLE NULL,
            notes VARCHAR(1000) NOT NULL DEFAULT '',
            note_admin VARCHAR(500) NOT NULL DEFAULT '',
            cree_le VARCHAR(19) NOT NULL,
            modere_le VARCHAR(19) NULL
        )$fin",
        "CREATE TABLE IF NOT EXISTS at_essais (cle VARCHAR(120) NOT NULL, le VARCHAR(19) NOT NULL)$fin",
    ];
    foreach ($sql as $q) $db->exec($q);
    foreach (['CREATE INDEX at_courses_statut ON at_courses (statut)', 'CREATE INDEX at_courses_user ON at_courses (user_id)', 'CREATE INDEX at_essais_cle ON at_essais (cle, le)'] as $q) {
        try {
            $db->exec($q);
        } catch (PDOException $e) {
            // index déjà présent
        }
    }
    $db->prepare('DELETE FROM at_meta WHERE cle = ?')->execute(['schema']);
    $db->prepare('INSERT INTO at_meta (cle, valeur) VALUES (?, ?)')->execute(['schema', (string)AT_VERSION_SCHEMA]);
}
