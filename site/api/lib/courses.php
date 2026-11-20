<?php
/* Courses ajoutées sur le site (membres et imports de l'administrateur) :
 * validation d'un format, conversion vers les colonnes du catalogue CSV. */
declare(strict_types=1);

// Colonnes de data/sources/catalogue.csv, dans l'ordre : l'export se relit tel quel par le build.
const AT_COLONNES = ['id', 'nom', 'course', 'date', 'date_confirmee', 'ville', 'code_postal', 'departement', 'lat', 'lon',
    'distance_km', 'denivele_pos_m', 'organisateur', 'site_web', 'lien_inscription', 'utmb_world_series', 'type',
    'nocturne', 'prix_eur', 'notes', 'source_url'];
const AT_TYPES = ['trail', 'ultra', 'course nature', 'kv', 'skyrace', 'canicross', 'autre'];

function at_num($v, float $min, float $max): ?float
{
    if ($v === null || $v === '') return null;
    $v = str_replace(',', '.', trim((string)$v));
    if (!is_numeric($v)) return null;
    $f = (float)$v;
    return ($f < $min || $f > $max) ? null : $f;
}

function at_bool($v): int
{
    return in_array(strtolower(trim((string)$v)), ['1', 'true', 'oui', 'yes', 'on', 'vrai'], true) ? 1 : 0;
}

function at_lien(string $v): string
{
    if ($v === '') return '';
    if (!preg_match('~^https?://~i', $v)) $v = 'https://' . $v;
    return filter_var($v, FILTER_VALIDATE_URL) && preg_match('~^https?://~i', $v) ? $v : '';
}

/* Valide un format (événement + format) ; renvoie [ligne, erreurs]. */
function at_valider(array $in, bool $strict = true): array
{
    $e = [];
    $r = [
        'nom' => at_str($in, 'nom', 160),
        'course' => at_str($in, 'course', 120),
        'date' => at_str($in, 'date', 10),
        'date_confirmee' => array_key_exists('date_confirmee', $in) ? at_bool($in['date_confirmee']) : 1,
        'ville' => at_str($in, 'ville', 120),
        'code_postal' => preg_replace('/\D/', '', at_str($in, 'code_postal', 10)),
        'departement' => strtoupper(at_str($in, 'departement', 3)),
        'lat' => at_num($in['lat'] ?? null, 41, 51.5),
        'lon' => at_num($in['lon'] ?? null, -5.5, 10),
        'distance_km' => at_num($in['distance_km'] ?? null, 0.5, 500),
        'denivele_pos_m' => ($d = at_num($in['denivele_pos_m'] ?? null, 0, 30000)) === null ? null : (int)round($d),
        'heure_depart' => preg_match('/^([01]\d|2[0-3])[:h]([0-5]\d)$/', at_str($in, 'heure_depart', 5), $m) ? "$m[1]:$m[2]" : '',
        'organisateur' => at_str($in, 'organisateur', 160),
        'site_web' => at_lien(at_str($in, 'site_web', 300)),
        'lien_inscription' => at_lien(at_str($in, 'lien_inscription', 300)),
        'type' => in_array($t = strtolower(at_str($in, 'type', 20)), AT_TYPES, true) ? $t : 'trail',
        'nocturne' => at_bool($in['nocturne'] ?? ''),
        'prix_eur' => at_num($in['prix_eur'] ?? null, 0, 2000),
        'notes' => at_str($in, 'notes', 1000),
    ];
    if (mb_strlen($r['nom']) < 3) $e[] = 'le nom de la course';
    $dt = DateTime::createFromFormat('!Y-m-d', $r['date']);
    if (!$dt || $dt->format('Y-m-d') !== $r['date']) $e[] = 'la date (AAAA-MM-JJ)';
    elseif ($strict && $r['date'] < gmdate('Y-m-d')) $e[] = 'une date à venir';
    if (mb_strlen($r['ville']) < 2) $e[] = 'la commune';
    if ($r['distance_km'] === null) $e[] = 'la distance en km';
    if ($r['code_postal'] !== '' && strlen($r['code_postal']) !== 5) $r['code_postal'] = '';
    if ($r['departement'] === '' && $r['code_postal'] !== '') {
        $r['departement'] = str_starts_with($r['code_postal'], '97') ? substr($r['code_postal'], 0, 3) : substr($r['code_postal'], 0, 2);
        if ($r['departement'] === '20') $r['departement'] = ((int)$r['code_postal'] < 20200) ? '2A' : '2B';
    }
    if (($r['lat'] === null) !== ($r['lon'] === null)) $r['lat'] = $r['lon'] = null;
    return [$r, $e];
}

function at_inserer(PDO $db, array $r, string $groupe, ?int $uid, string $statut, string $origine): int
{
    $cols = array_keys($r);
    $sql = 'INSERT INTO at_courses (groupe, user_id, statut, origine, cree_le, ' . implode(', ', $cols) . ') VALUES (?, ?, ?, ?, ?, '
        . implode(', ', array_fill(0, count($cols), '?')) . ')';
    $db->prepare($sql)->execute(array_merge([$groupe, $uid, $statut, $origine, at_now()], array_values($r)));
    return (int)$db->lastInsertId();
}

/* Ligne au format du catalogue (pour l'export CSV relu par scripts/sources/membres.py). */
function at_ligne_catalogue(array $c): array
{
    $f = fn($v) => $v === null ? '' : (is_float($v) || is_numeric($v) ? rtrim(rtrim(number_format((float)$v, 5, '.', ''), '0'), '.') : (string)$v);
    return [
        'id' => 'membre-' . $c['id'], 'nom' => $c['nom'], 'course' => $c['course'], 'date' => $c['date'],
        'date_confirmee' => $c['date_confirmee'] ? 'true' : 'false', 'ville' => $c['ville'], 'code_postal' => $c['code_postal'],
        'departement' => $c['departement'], 'lat' => $f($c['lat']), 'lon' => $f($c['lon']), 'distance_km' => $f($c['distance_km']),
        'denivele_pos_m' => $c['denivele_pos_m'] === null ? '' : (string)(int)$c['denivele_pos_m'], 'organisateur' => $c['organisateur'],
        'site_web' => $c['site_web'], 'lien_inscription' => $c['lien_inscription'], 'utmb_world_series' => 'false',
        'type' => $c['type'], 'nocturne' => $c['nocturne'] ? 'true' : 'false', 'prix_eur' => $f($c['prix_eur']),
        'notes' => $c['notes'], 'source_url' => '',
    ];
}

/* Neutralise les formules (=, +, -, @) quand le CSV est ouvert dans un tableur. */
function at_csv_cellule(string $v): string
{
    return preg_match('/^[=+\-@\t\r]/', $v) && !is_numeric($v) ? "'" . $v : $v;
}

function at_csv(string $fichier, array $entetes, iterable $lignes): never
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $fichier . '"');
    header('Cache-Control: no-store');
    $out = fopen('php://output', 'w');
    fputcsv($out, $entetes, ',', '"', '');
    foreach ($lignes as $l) {
        fputcsv($out, array_map(fn($k) => at_csv_cellule((string)($l[$k] ?? '')), $entetes), ',', '"', '');
    }
    fclose($out);
    exit;
}
