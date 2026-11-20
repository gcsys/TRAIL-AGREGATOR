<?php
/* Espace administrateur (comptes dont l'e-mail figure dans admin_emails de la config).
 *  GET  ?action=liste&statut=attente|publiee|refusee|tout
 *  POST ?action=moderer      {ids: [..], decision: publier|refuser|supprimer, note}
 *  POST ?action=modifier     {id, ...champs}
 *  GET  ?action=export       courses ajoutées sur le site, format catalogue + statut (CSV)
 *  POST ?action=import       fichier CSV au format catalogue (champ « fichier »), essai=1 pour simuler
 *  GET  ?action=catalogue    toute la base publiée (site/data/races.json) en CSV
 *  GET  ?action=utilisateurs / POST ?action=bloquer {id, bloque} */
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/courses.php';

$admin = at_require_admin();
$db = at_db();
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'liste':
        $statut = $_GET['statut'] ?? 'attente';
        $sql = 'SELECT c.*, u.nom AS membre, u.email AS membre_email FROM at_courses c LEFT JOIN at_users u ON u.id = c.user_id';
        $args = [];
        if ($statut !== 'tout') {
            $sql .= ' WHERE c.statut = ?';
            $args[] = $statut;
        }
        $st = $db->prepare($sql . ' ORDER BY c.cree_le DESC, c.groupe, c.distance_km LIMIT 2000');
        $st->execute($args);
        $comptes = $db->query("SELECT statut, COUNT(*) AS n FROM at_courses GROUP BY statut")->fetchAll(PDO::FETCH_KEY_PAIR);
        at_json(['courses' => $st->fetchAll(), 'comptes' => $comptes]);

    case 'moderer':
        at_require_post();
        $in = at_input();
        $ids = array_values(array_filter(array_map('intval', (array)($in['ids'] ?? []))));
        $decision = $in['decision'] ?? '';
        $note = at_str($in, 'note', 500);
        if (!$ids) at_err('Aucune course sélectionnée.');
        $marques = implode(',', array_fill(0, count($ids), '?'));
        $st = $db->prepare("SELECT c.id, c.nom, c.date, c.ville, c.statut, u.email, u.nom AS membre FROM at_courses c LEFT JOIN at_users u ON u.id = c.user_id WHERE c.id IN ($marques)");
        $st->execute($ids);
        $cibles = $st->fetchAll();
        if ($decision === 'supprimer') {
            $db->prepare("DELETE FROM at_courses WHERE id IN ($marques)")->execute($ids);
        } elseif ($decision === 'publier' || $decision === 'refuser') {
            $nouveau = $decision === 'publier' ? 'publiee' : 'refusee';
            $db->prepare("UPDATE at_courses SET statut = ?, note_admin = ?, modere_le = ? WHERE id IN ($marques)")
                ->execute(array_merge([$nouveau, $note, at_now()], $ids));
            // Un e-mail par membre et par course (les formats d'une même course sont regroupés).
            $prevenus = [];
            foreach ($cibles as $c) {
                $k = $c['email'] . '|' . $c['nom'];
                if (!$c['email'] || $c['statut'] === $nouveau || isset($prevenus[$k])) continue;
                $prevenus[$k] = true;
                $texte = $nouveau === 'publiee'
                    ? "Bonjour {$c['membre']},\n\nVotre course « {$c['nom']} » ({$c['date']}, {$c['ville']}) est maintenant visible sur Agregatrail :\n" . at_url('') . "\n\nMerci pour votre contribution !\n"
                    : "Bonjour {$c['membre']},\n\nVotre proposition « {$c['nom']} » ({$c['date']}, {$c['ville']}) n'a pas été retenue." . ($note ? "\nMotif : $note" : '') . "\n\nVous pouvez en proposer une version corrigée depuis votre compte : " . at_url('compte/') . "\n";
                at_mail($c['email'], $nouveau === 'publiee' ? 'Votre course est en ligne' : 'Votre proposition de course', $texte);
            }
        } else {
            at_err('Décision inconnue.');
        }
        at_json(['ok' => true, 'n' => count($cibles)]);

    case 'modifier':
        at_require_post();
        $in = at_input();
        $id = (int)($in['id'] ?? 0);
        $st = $db->prepare('SELECT * FROM at_courses WHERE id = ?');
        $st->execute([$id]);
        $avant = $st->fetch();
        if (!$avant) at_err('Course introuvable.', 404);
        [$r, $e] = at_valider(array_merge($avant, $in), false);
        if ($e) at_err('Vérifiez ' . implode(', ', $e) . '.');
        $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($r)));
        $db->prepare("UPDATE at_courses SET $sets WHERE id = ?")->execute(array_merge(array_values($r), [$id]));
        at_json(['ok' => true]);

    case 'export':
        $lignes = [];
        foreach ($db->query('SELECT c.*, u.email AS membre_email FROM at_courses c LEFT JOIN at_users u ON u.id = c.user_id ORDER BY c.id') as $c) {
            $lignes[] = at_ligne_catalogue($c) + ['heure_depart' => $c['heure_depart'], 'statut' => $c['statut'], 'origine' => $c['origine'],
                'ajoute_par' => $c['membre_email'] ?? '', 'ajoute_le' => $c['cree_le'], 'note_admin' => $c['note_admin']];
        }
        at_csv('agregatrail-courses-ajoutees-' . gmdate('Y-m-d') . '.csv',
            array_merge(AT_COLONNES, ['heure_depart', 'statut', 'origine', 'ajoute_par', 'ajoute_le', 'note_admin']), $lignes);

    case 'import':
        at_require_post();
        $essai = !empty($_POST['essai']);
        $f = $_FILES['fichier'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) at_err('Choisissez un fichier CSV.');
        if ($f['size'] > 5 * 1024 * 1024) at_err('Fichier trop lourd (5 Mo au plus).');
        $h = fopen($f['tmp_name'], 'r');
        $premiere = fgets($h) ?: '';
        $sep = substr_count($premiere, ';') > substr_count($premiere, ',') ? ';' : ','; // export Excel français
        rewind($h);
        $entetes = fgetcsv($h, 0, $sep, '"', '');
        if (!$entetes) at_err('Fichier vide.');
        $entetes = array_map(fn($x) => strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string)$x))), $entetes);
        foreach (['nom', 'date', 'ville', 'distance_km'] as $obl) {
            if (!in_array($obl, $entetes, true)) at_err("Colonne « $obl » absente. Partez d'un export pour avoir les bonnes colonnes.");
        }
        $res = ['ajoutees' => 0, 'mises_a_jour' => 0, 'ignorees' => 0, 'erreurs' => []];
        $num = 1;
        if (!$essai) $db->beginTransaction();
        while (($v = fgetcsv($h, 0, $sep, '"', '')) !== false) {
            $num++;
            if ($v === [null] || !array_filter($v, fn($x) => trim((string)$x) !== '')) continue;
            $ligne = [];
            foreach ($entetes as $i => $k) {
                $ligne[$k] = preg_replace('/^\'(?=[=+\-@])/', '', (string)($v[$i] ?? ''));
            }
            [$r, $e] = at_valider($ligne, false);
            if ($e) {
                $res['ignorees']++;
                if (count($res['erreurs']) < 50) $res['erreurs'][] = "ligne $num : vérifiez " . implode(', ', $e);
                continue;
            }
            $statut = in_array($ligne['statut'] ?? '', ['attente', 'publiee', 'refusee'], true) ? $ligne['statut'] : 'publiee';
            $existant = null;
            if (preg_match('/^membre-(\d+)$/', $ligne['id'] ?? '', $m)) {
                $st = $db->prepare('SELECT id FROM at_courses WHERE id = ?');
                $st->execute([(int)$m[1]]);
                $existant = $st->fetchColumn() ?: null;
            }
            if ($existant) {
                $res['mises_a_jour']++;
                if ($essai) continue;
                $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($r)));
                $db->prepare("UPDATE at_courses SET $sets, statut = ? WHERE id = ?")->execute(array_merge(array_values($r), [$statut, $existant]));
            } else {
                $res['ajoutees']++;
                if ($essai) continue;
                at_inserer($db, $r, bin2hex(random_bytes(8)), (int)$admin['id'], $statut, 'import');
            }
        }
        fclose($h);
        if (!$essai) $db->commit();
        $res['essai'] = $essai;
        at_json($res);

    case 'catalogue':
        $fichier = dirname(__DIR__) . '/data/races.json';
        $data = is_file($fichier) ? json_decode((string)file_get_contents($fichier), true) : null;
        $races = $data['races'] ?? (is_array($data) && array_is_list($data) ? $data : null);
        if (!is_array($races)) at_err('Base introuvable sur le serveur.', 404);
        $entetes = array_merge(AT_COLONNES, ['heure_depart', 'participants_max', 'source']);
        $lignes = (function () use ($races, $entetes) {
            foreach ($races as $r) {
                $l = [];
                foreach ($entetes as $k) {
                    $v = $r[$k] ?? '';
                    if ($k === 'departement') $v = $r['departement_code'] ?? $v;
                    $l[$k] = is_bool($v) ? ($v ? 'true' : 'false') : (is_array($v) ? '' : $v);
                }
                yield $l;
            }
        })();
        at_csv('agregatrail-base-' . gmdate('Y-m-d') . '.csv', $entetes, $lignes);

    case 'utilisateurs':
        $us = $db->query('SELECT u.id, u.email, u.nom, u.role, u.cree_le, u.verifie_le, u.bloque, (SELECT COUNT(*) FROM at_courses c WHERE c.user_id = u.id) AS courses FROM at_users u ORDER BY u.cree_le DESC')->fetchAll();
        at_json(['utilisateurs' => $us]);

    case 'bloquer':
        at_require_post();
        $in = at_input();
        $id = (int)($in['id'] ?? 0);
        if ($id === (int)$admin['id']) at_err('Vous ne pouvez pas suspendre votre propre compte.');
        $db->prepare('UPDATE at_users SET bloque = ? WHERE id = ? AND role <> ?')->execute([empty($in['bloque']) ? 0 : 1, $id, 'admin']);
        at_json(['ok' => true]);

    default:
        at_err('Action inconnue.', 404);
}
