<?php
/* Comptes : inscription, confirmation de l'e-mail, connexion, déconnexion,
 * mot de passe oublié. Réponses en JSON, sauf le lien de confirmation (redirection). */
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'me':
        $u = at_user();
        at_json(['connecte' => (bool)$u, 'utilisateur' => $u ? at_public_user($u) : null]);

    case 'inscription':
        at_require_post();
        at_throttle('inscription', 5, 3600);
        $in = at_input();
        $email = strtolower(at_str($in, 'email', 190));
        $nom = at_str($in, 'nom', 80);
        $mdp = (string)($in['mdp'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) at_err('Adresse e-mail invalide.');
        if (mb_strlen($nom) < 2) at_err('Indiquez un nom ou un pseudo (2 caractères au moins).');
        if (mb_strlen($mdp) < 10) at_err('Le mot de passe doit faire au moins 10 caractères.');
        if (strlen($mdp) > 200) at_err('Mot de passe trop long.');
        $db = at_db();
        $st = $db->prepare('SELECT id, verifie_le FROM at_users WHERE email = ?');
        $st->execute([$email]);
        $existant = $st->fetch();
        [$jeton, $hash] = at_token();
        if ($existant) {
            // Même réponse qu'une inscription normale : on ne révèle pas qui a un compte.
            if (!$existant['verifie_le']) {
                $db->prepare('UPDATE at_users SET jeton_verif = ? WHERE id = ?')->execute([$hash, $existant['id']]);
                at_mail($email, 'Confirmez votre adresse sur Agregatrail', at_mail_verif($nom, $jeton));
            } else {
                at_mail($email, 'Votre compte Agregatrail', "Bonjour,\n\nQuelqu'un a tenté de créer un compte Agregatrail avec votre adresse, qui en a déjà un.\nSi c'est vous, connectez-vous ou utilisez « Mot de passe oublié » : " . at_url('compte/') . "\n\nSinon, ignorez ce message.\n");
            }
            at_json(['ok' => true, 'message' => 'Un e-mail de confirmation vient de partir. Cliquez sur le lien qu\'il contient.']);
        }
        $role = at_is_admin_email($email) ? 'admin' : 'membre';
        $db->prepare('INSERT INTO at_users (email, nom, mdp, role, cree_le, jeton_verif) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$email, $nom, password_hash($mdp, PASSWORD_DEFAULT), $role, at_now(), $hash]);
        at_mail($email, 'Confirmez votre adresse sur Agregatrail', at_mail_verif($nom, $jeton));
        at_json(['ok' => true, 'message' => 'Un e-mail de confirmation vient de partir. Cliquez sur le lien qu\'il contient.']);

    case 'verifier':
        $jeton = (string)($_GET['jeton'] ?? '');
        $ok = false;
        if (preg_match('/^[0-9a-f]{64}$/', $jeton)) {
            $db = at_db();
            $st = $db->prepare('SELECT id FROM at_users WHERE jeton_verif = ?');
            $st->execute([hash('sha256', $jeton)]);
            $id = $st->fetchColumn();
            if ($id) {
                $db->prepare('UPDATE at_users SET verifie_le = ?, jeton_verif = NULL WHERE id = ?')->execute([at_now(), $id]);
                at_session();
                session_regenerate_id(true);
                $_SESSION['uid'] = (int)$id;
                $ok = true;
            }
        }
        header('Location: ' . at_url('compte/?' . ($ok ? 'verifie=1' : 'lien=invalide')), true, 303);
        exit;

    case 'connexion':
        at_require_post();
        at_throttle('connexion', 10, 900);
        $in = at_input();
        $email = strtolower(at_str($in, 'email', 190));
        $mdp = (string)($in['mdp'] ?? '');
        $st = at_db()->prepare('SELECT id, mdp, verifie_le, bloque FROM at_users WHERE email = ?');
        $st->execute([$email]);
        $u = $st->fetch();
        if (!$u || !password_verify($mdp, $u['mdp'])) at_err('E-mail ou mot de passe incorrect.', 401);
        if ($u['bloque']) at_err('Ce compte est suspendu.', 403);
        if (!$u['verifie_le']) at_err('Confirmez d\'abord votre adresse avec le lien reçu par e-mail.', 403);
        if (password_needs_rehash($u['mdp'], PASSWORD_DEFAULT)) {
            at_db()->prepare('UPDATE at_users SET mdp = ? WHERE id = ?')->execute([password_hash($mdp, PASSWORD_DEFAULT), $u['id']]);
        }
        at_session();
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id'];
        at_json(['ok' => true, 'utilisateur' => at_public_user(at_user())]);

    case 'deconnexion':
        at_require_post();
        at_session();
        $_SESSION = [];
        session_destroy();
        at_json(['ok' => true]);

    case 'oubli':
        at_require_post();
        at_throttle('oubli', 5, 3600);
        $email = strtolower(at_str(at_input(), 'email', 190));
        $db = at_db();
        $st = $db->prepare('SELECT id, nom FROM at_users WHERE email = ? AND bloque = 0');
        $st->execute([$email]);
        if ($u = $st->fetch()) {
            [$jeton, $hash] = at_token();
            $db->prepare('UPDATE at_users SET jeton_reset = ?, reset_expire = ? WHERE id = ?')
                ->execute([$hash, gmdate('Y-m-d H:i:s', time() + 3600), $u['id']]);
            at_mail($email, 'Nouveau mot de passe Agregatrail', "Bonjour {$u['nom']},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable une heure) :\n" . at_url('compte/?reset=' . $jeton) . "\n\nSi vous n'avez rien demandé, ignorez ce message.\n");
        }
        at_json(['ok' => true, 'message' => 'Si un compte existe pour cette adresse, un e-mail vient de partir.']);

    case 'reset':
        at_require_post();
        at_throttle('reset', 10, 3600);
        $in = at_input();
        $jeton = (string)($in['jeton'] ?? '');
        $mdp = (string)($in['mdp'] ?? '');
        if (mb_strlen($mdp) < 10 || strlen($mdp) > 200) at_err('Le mot de passe doit faire au moins 10 caractères.');
        $db = at_db();
        $st = $db->prepare('SELECT id, reset_expire, verifie_le FROM at_users WHERE jeton_reset = ?');
        $st->execute([hash('sha256', $jeton)]);
        $u = $st->fetch();
        if (!$u || $u['reset_expire'] < at_now()) at_err('Lien expiré ou déjà utilisé. Refaites une demande.');
        // Le lien reçu par e-mail prouve aussi que l'adresse est valide.
        $db->prepare('UPDATE at_users SET mdp = ?, jeton_reset = NULL, reset_expire = NULL, verifie_le = COALESCE(verifie_le, ?) WHERE id = ?')
            ->execute([password_hash($mdp, PASSWORD_DEFAULT), at_now(), $u['id']]);
        at_session();
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id'];
        at_json(['ok' => true, 'utilisateur' => at_public_user(at_user())]);

    default:
        at_err('Action inconnue.', 404);
}

function at_mail_verif(string $nom, string $jeton): string
{
    return "Bonjour $nom,\n\nPour activer votre compte Agregatrail, ouvrez ce lien :\n"
        . at_url('api/auth.php?action=verifier&jeton=' . $jeton)
        . "\n\nSi vous n'avez pas créé de compte, ignorez ce message.\n";
}
