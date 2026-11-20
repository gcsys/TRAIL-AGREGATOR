<?php
/* Courses ajoutées sur le site.
 *  GET  ?action=publiees  courses validées (JSON, public) : affichées tout de suite sur la carte
 *  GET  ?action=csv       courses validées au format du catalogue (public) : relu par le build hebdomadaire
 *  POST ?action=proposer  un membre connecté propose une course (un ou plusieurs formats), en attente de validation
 *  GET  ?action=mes       les propositions du membre connecté et leur état */
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/courses.php';

$action = $_GET['action'] ?? '';
$publiques = fn() => at_db()->query("SELECT * FROM at_courses WHERE statut = 'publiee' ORDER BY date, nom, distance_km");

switch ($action) {
    case 'publiees':
        $out = [];
        foreach ($publiques() as $c) {
            if ($c['date'] < gmdate('Y-m-d', time() - 86400 * 2)) continue;
            $l = at_ligne_catalogue($c);
            $l['heure_depart'] = $c['heure_depart'];
            $out[] = $l;
        }
        header('Cache-Control: public, max-age=300');
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['courses' => $out], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;

    case 'csv':
        $lignes = [];
        foreach ($publiques() as $c) $lignes[] = at_ligne_catalogue($c);
        at_csv('membres.csv', AT_COLONNES, $lignes);

    case 'proposer':
        at_require_post();
        $u = at_require_user();
        if (!$u['verifie_le']) at_err('Confirmez d\'abord votre adresse e-mail.', 403);
        at_throttle('proposer', 20, 86400);
        $in = at_input();
        $formats = $in['formats'] ?? null;
        if (!is_array($formats) || !$formats) at_err('Ajoutez au moins un format (distance).');
        if (count($formats) > 12) at_err('12 formats au plus par course.');
        $lignes = [];
        foreach (array_values($formats) as $i => $f) {
            if (!is_array($f)) at_err('Format illisible.');
            [$r, $e] = at_valider(array_merge($in, $f));
            if ($e) at_err('Vérifiez ' . implode(', ', $e) . (count($formats) > 1 ? ' (format ' . ($i + 1) . ')' : '') . '.');
            $lignes[] = $r;
        }
        $db = at_db();
        $groupe = bin2hex(random_bytes(8));
        $statut = $u['role'] === 'admin' ? 'publiee' : 'attente';
        $db->beginTransaction();
        foreach ($lignes as $r) at_inserer($db, $r, $groupe, (int)$u['id'], $statut, 'membre');
        $db->commit();
        if ($statut === 'attente') {
            foreach (at_config()['admin_emails'] as $admin) {
                at_mail($admin, 'Course à valider : ' . $lignes[0]['nom'], "{$u['nom']} ({$u['email']}) propose « {$lignes[0]['nom']} » le {$lignes[0]['date']} à {$lignes[0]['ville']} (" . count($lignes) . " format(s)).\n\nÀ valider ici : " . at_url('admin/') . "\n");
            }
        }
        at_json(['ok' => true, 'statut' => $statut, 'message' => $statut === 'publiee'
            ? 'Course publiée.'
            : 'Merci ! Votre course sera visible dès qu\'elle aura été validée. Vous recevrez un e-mail.']);

    case 'mes':
        $u = at_require_user();
        $st = at_db()->prepare('SELECT id, groupe, statut, nom, course, date, ville, distance_km, denivele_pos_m, note_admin, cree_le FROM at_courses WHERE user_id = ? ORDER BY cree_le DESC, id');
        $st->execute([$u['id']]);
        at_json(['courses' => $st->fetchAll()]);

    default:
        at_err('Action inconnue.', 404);
}
