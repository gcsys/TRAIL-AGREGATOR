<?php
/* Socle commun de l'API Agregatrail : configuration, base de données, session,
 * réponses JSON, protections (en-tête anti-CSRF, limitation des essais), e-mails.
 * PHP 8.1+, aucune dépendance. Ce dossier est interdit en accès direct (.htaccess). */
declare(strict_types=1);

const AT_VERSION_SCHEMA = 1;

function at_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    // Ordre de recherche : variable d'environnement (tests), dossier privé à côté
    // de la racine du site (recommandé sur OVH), puis api/config.php (protégé par .htaccess).
    $candidats = array_filter([
        getenv('AGREGATRAIL_CONFIG') ?: null,
        dirname(__DIR__, 3) . '/agregatrail-prive/config.php',
        dirname(__DIR__) . '/config.php',
    ]);
    foreach ($candidats as $f) {
        if (is_file($f)) {
            $cfg = require $f;
            break;
        }
    }
    if (!is_array($cfg)) {
        at_json(['erreur' => 'Le service des comptes n\'est pas encore configuré.'], 503);
    }
    $cfg += [
        'db_user' => null, 'db_pass' => null,
        'site_url' => 'https://agregatrail.gcsports.fr/',
        'admin_emails' => [],
        'mail_from' => 'no-reply@gcsports.fr',
        'mail_mode' => 'mail', // 'mail' (fonction mail() d'OVH) ou 'log' (tests : fichier mail_log)
        'mail_log' => null,
        'cookie_secure' => true,
        'limiter_essais' => true,
    ];
    return $cfg;
}

function at_db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = at_config();
    try {
        $pdo = new PDO($c['db_dsn'], $c['db_user'], $c['db_pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (PDOException $e) {
        error_log('Agregatrail BDD : ' . $e->getMessage());
        at_json(['erreur' => 'Base de données indisponible, réessayez plus tard.'], 503);
    }
    require_once __DIR__ . '/schema.php';
    at_schema($pdo);
    return $pdo;
}

function at_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function at_json($data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function at_err(string $msg, int $code = 400): never
{
    at_json(['erreur' => $msg], $code);
}

/* Toute écriture exige la méthode POST et l'en-tête X-Agregatrail, qu'un autre site
 * ne peut pas ajouter sans autorisation CORS : c'est la protection anti-CSRF. */
function at_require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') at_err('Méthode non autorisée.', 405);
    if (($_SERVER['HTTP_X_AGREGATRAIL'] ?? '') !== '1') at_err('Requête refusée.', 403);
}

function at_input(): array
{
    static $in = null;
    if ($in !== null) return $in;
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_starts_with($type, 'application/json')) {
        $in = json_decode(file_get_contents('php://input') ?: '[]', true);
        if (!is_array($in)) at_err('Données illisibles.');
    } else {
        $in = $_POST;
    }
    return $in;
}

function at_str(array $in, string $k, int $max = 200): string
{
    $v = $in[$k] ?? '';
    if (!is_string($v) && !is_numeric($v)) return '';
    $v = trim(preg_replace('/[\x00-\x1F\x7F]/u', ' ', (string)$v) ?? '');
    return mb_substr($v, 0, $max);
}

// ---------- Session ----------
function at_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $c = at_config();
    session_name('agregatrail');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => (bool)$c['cookie_secure'],
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    session_start();
}

function at_user(): ?array
{
    at_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) return null;
    $st = at_db()->prepare('SELECT id, email, nom, role, verifie_le, bloque FROM at_users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u || $u['bloque']) {
        unset($_SESSION['uid']);
        return null;
    }
    return $u;
}

function at_require_user(): array
{
    $u = at_user();
    if (!$u) at_err('Connectez-vous pour continuer.', 401);
    return $u;
}

function at_require_admin(): array
{
    $u = at_require_user();
    if ($u['role'] !== 'admin') at_err('Réservé à l\'administrateur.', 403);
    return $u;
}

function at_public_user(array $u): array
{
    return ['email' => $u['email'], 'nom' => $u['nom'], 'admin' => $u['role'] === 'admin', 'verifie' => (bool)$u['verifie_le']];
}

// ---------- Limitation des essais (connexion, inscription, mot de passe oublié) ----------
function at_throttle(string $action, int $max, int $secondes): void
{
    if (!at_config()['limiter_essais']) return;
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $cle = $action . ':' . hash('sha256', $ip);
    $db = at_db();
    $depuis = gmdate('Y-m-d H:i:s', time() - $secondes);
    $db->prepare('DELETE FROM at_essais WHERE le < ?')->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);
    $st = $db->prepare('SELECT COUNT(*) FROM at_essais WHERE cle = ? AND le >= ?');
    $st->execute([$cle, $depuis]);
    if ((int)$st->fetchColumn() >= $max) at_err('Trop d\'essais. Patientez quelques minutes.', 429);
    $db->prepare('INSERT INTO at_essais (cle, le) VALUES (?, ?)')->execute([$cle, at_now()]);
}

// ---------- Jetons (vérification d'e-mail, mot de passe oublié) ----------
function at_token(): array
{
    $t = bin2hex(random_bytes(32));
    return [$t, hash('sha256', $t)];
}

// ---------- E-mails ----------
function at_mail(string $to, string $sujet, string $texte): bool
{
    $c = at_config();
    if ($c['mail_mode'] === 'log') {
        file_put_contents($c['mail_log'], json_encode(['to' => $to, 'sujet' => $sujet, 'texte' => $texte], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
        return true;
    }
    $from = $c['mail_from'];
    $headers = implode("\r\n", [
        'From: Agregatrail <' . $from . '>',
        'Reply-To: ' . $from,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ]);
    $ok = mail($to, mb_encode_mimeheader($sujet, 'UTF-8'), $texte, $headers, '-f' . $from);
    if (!$ok) error_log("Agregatrail : envoi d'e-mail impossible vers $to");
    return $ok;
}

function at_url(string $chemin): string
{
    return rtrim(at_config()['site_url'], '/') . '/' . ltrim($chemin, '/');
}

function at_is_admin_email(string $email): bool
{
    return in_array(strtolower($email), array_map('strtolower', at_config()['admin_emails']), true);
}
