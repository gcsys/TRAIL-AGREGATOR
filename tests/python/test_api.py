"""Tests de l'API PHP (comptes, propositions, modération, import/export).

Lance le serveur intégré de PHP sur site/ avec une base SQLite temporaire et des
e-mails écrits dans un fichier. Ignoré si PHP (avec pdo_sqlite) n'est pas installé.
"""
import csv
import http.cookiejar
import io
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHP = shutil.which("php")


def php_ok():
    if not PHP:
        return False
    r = subprocess.run([PHP, "-m"], capture_output=True, text=True)
    return "pdo_sqlite" in r.stdout


@unittest.skipUnless(php_ok(), "PHP avec pdo_sqlite non disponible")
class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.mails = cls.tmp / "mails.log"
        cfg = cls.tmp / "config.php"
        cfg.write_text(
            "<?php return ['db_dsn' => 'sqlite:%s', 'site_url' => 'http://localhost/', 'admin_emails' => ['admin@exemple.fr'],"
            " 'mail_mode' => 'log', 'mail_log' => '%s', 'cookie_secure' => false, 'limiter_essais' => false];" % (cls.tmp / "db.sqlite", cls.mails)
        )
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        env = dict(os.environ, AGREGATRAIL_CONFIG=str(cfg))
        cls.srv = subprocess.Popen([PHP, "-S", f"127.0.0.1:{cls.port}", "-t", str(ROOT / "site")], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.srv.terminate()
        cls.srv.wait()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ---------- outils ----------
    def client(self):
        jar = http.cookiejar.CookieJar()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())

    def call(self, op, path, data=None, raw=False, headers=None, ctype="application/json"):
        url = f"http://127.0.0.1:{self.port}/api/{path}"
        h = {"X-Agregatrail": "1"}
        h.update(headers or {})
        body = None
        if data is not None:
            body = json.dumps(data).encode() if ctype == "application/json" else data
            h["Content-Type"] = ctype
        req = urllib.request.Request(url, data=body, headers=h, method="POST" if data is not None else "GET")
        try:
            r = op.open(req)
            code, txt, hdr = r.status, r.read().decode(), r.headers
        except urllib.error.HTTPError as e:
            code, txt, hdr = e.code, e.read().decode(), e.headers
        if raw:
            return code, txt, hdr
        return code, json.loads(txt)

    def last_link(self, motif):
        lignes = self.mails.read_text().strip().splitlines()
        for l in reversed(lignes):
            m = re.search(motif, json.loads(l)["texte"])
            if m:
                return m.group(0)
        self.fail("lien introuvable dans les e-mails")

    def compte(self, email, mdp="motdepasse-solide"):
        op = self.client()
        code, r = self.call(op, "auth.php?action=inscription", {"email": email, "nom": "Test", "mdp": mdp})
        self.assertEqual(code, 200, r)
        lien = self.last_link(r"api/auth\.php\?action=verifier&jeton=[0-9a-f]{64}")
        code, _, hdr = self.call(op, lien.replace("api/", ""), raw=True)
        self.assertEqual(code, 303)
        self.assertIn("verifie=1", hdr["Location"])
        return op

    # ---------- tests ----------
    def test_lecture_publique_sans_compte(self):
        code, r = self.call(self.client(), "courses.php?action=publiees")
        self.assertEqual(code, 200)
        self.assertIn("courses", r)
        code, r = self.call(self.client(), "auth.php?action=me")
        self.assertEqual(r, {"connecte": False, "utilisateur": None})

    def test_ecriture_refusee_sans_compte_ou_sans_entete(self):
        op = self.client()
        code, _ = self.call(op, "courses.php?action=proposer", {"nom": "X"})
        self.assertEqual(code, 401)
        code, _ = self.call(op, "auth.php?action=connexion", {"email": "a@b.fr", "mdp": "x"}, headers={"X-Agregatrail": "0"})
        self.assertEqual(code, 403)
        code, _ = self.call(op, "admin.php?action=liste")
        self.assertEqual(code, 401)

    def test_connexion_exige_email_confirme(self):
        op = self.client()
        email = f"{uuid.uuid4().hex[:8]}@exemple.fr"
        self.call(op, "auth.php?action=inscription", {"email": email, "nom": "Lou", "mdp": "motdepasse-solide"})
        code, r = self.call(op, "auth.php?action=connexion", {"email": email, "mdp": "motdepasse-solide"})
        self.assertEqual(code, 403)
        code, r = self.call(op, "auth.php?action=connexion", {"email": email, "mdp": "mauvais"})
        self.assertEqual(code, 401)

    def test_parcours_complet_proposition_validation_export(self):
        membre = self.compte(f"{uuid.uuid4().hex[:8]}@exemple.fr")
        code, r = self.call(membre, "auth.php?action=me")
        self.assertTrue(r["connecte"])
        self.assertFalse(r["utilisateur"]["admin"])
        jour = (date.today() + timedelta(days=60)).isoformat()
        course = {"nom": "Trail du Test", "date": jour, "ville": "Millau", "code_postal": "12100", "lat": 44.1, "lon": 3.08,
                  "site_web": "trail-test.fr", "formats": [{"course": "12 km", "distance_km": "12", "denivele_pos_m": "450"},
                                                           {"course": "25 km", "distance_km": "25,5", "denivele_pos_m": "1200"}]}
        code, r = self.call(membre, "courses.php?action=proposer", course)
        self.assertEqual(code, 200, r)
        self.assertEqual(r["statut"], "attente")
        # pas encore visible
        _, pub = self.call(self.client(), "courses.php?action=publiees")
        self.assertNotIn("Trail du Test", [c["nom"] for c in pub["courses"]])
        # un membre n'a pas accès à l'admin
        code, _ = self.call(membre, "admin.php?action=liste")
        self.assertEqual(code, 403)
        _, mes = self.call(membre, "courses.php?action=mes")
        self.assertEqual(len(mes["courses"]), 2)

        admin = self.compte("admin@exemple.fr")
        _, me = self.call(admin, "auth.php?action=me")
        self.assertTrue(me["utilisateur"]["admin"])
        _, liste = self.call(admin, "admin.php?action=liste&statut=attente")
        ids = [c["id"] for c in liste["courses"] if c["nom"] == "Trail du Test"]
        self.assertEqual(len(ids), 2)
        code, r = self.call(admin, "admin.php?action=moderer", {"ids": ids, "decision": "publier"})
        self.assertEqual(code, 200, r)
        self.assertIn("est maintenant visible", self.mails.read_text())

        _, pub = self.call(self.client(), "courses.php?action=publiees")
        mine = [c for c in pub["courses"] if c["nom"] == "Trail du Test"]
        self.assertEqual(sorted(c["distance_km"] for c in mine), ["12", "25.5"])
        self.assertEqual(mine[0]["site_web"], "https://trail-test.fr")
        self.assertEqual(mine[0]["departement"], "12")

        code, txt, hdr = self.call(self.client(), "courses.php?action=csv", raw=True)
        self.assertIn("text/csv", hdr["Content-Type"])
        rows = list(csv.DictReader(io.StringIO(txt)))
        self.assertIn(f"membre-{ids[0]}", [r["id"] for r in rows])
        self.assertEqual(list(rows[0].keys())[:4], ["id", "nom", "course", "date"])

        # export admin -> modification -> import
        _, txt, _ = self.call(admin, "admin.php?action=export", raw=True)
        rows = list(csv.DictReader(io.StringIO(txt)))
        for r in rows:
            if r["id"] == f"membre-{ids[0]}":
                r["denivele_pos_m"] = "500"
        rows.append(dict(rows[0], id="", nom="Nouvelle course importée", statut=""))
        rows.append(dict(rows[0], id="", nom="", statut=""))  # invalide : sans nom
        out = io.StringIO()
        w = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
        for essai, attendu_nb in (("1", 0), ("", 1)):
            body, ctype = multipart({"essai": essai}, "fichier", "maj.csv", out.getvalue().encode())
            code, r = self.call(admin, "admin.php?action=import", body, ctype=ctype)
            self.assertEqual(code, 200, r)
            self.assertEqual(r["ajoutees"], 1)
            self.assertEqual(r["ignorees"], 1)
            _, pub = self.call(self.client(), "courses.php?action=publiees")
            self.assertEqual(sum(c["nom"] == "Nouvelle course importée" for c in pub["courses"]), attendu_nb)
        _, pub = self.call(self.client(), "courses.php?action=publiees")
        self.assertIn("500", [c["denivele_pos_m"] for c in pub["courses"] if c["id"] == f"membre-{ids[0]}"])

    def test_mot_de_passe_oublie(self):
        email = f"{uuid.uuid4().hex[:8]}@exemple.fr"
        self.compte(email)
        op = self.client()
        code, _ = self.call(op, "auth.php?action=oubli", {"email": email})
        self.assertEqual(code, 200)
        jeton = self.last_link(r"reset=[0-9a-f]{64}").split("=")[1]
        code, r = self.call(op, "auth.php?action=reset", {"jeton": jeton, "mdp": "nouveau-mot-de-passe"})
        self.assertEqual(code, 200, r)
        code, _ = self.call(self.client(), "auth.php?action=connexion", {"email": email, "mdp": "nouveau-mot-de-passe"})
        self.assertEqual(code, 200)
        code, _ = self.call(op, "auth.php?action=reset", {"jeton": jeton, "mdp": "encore-un-autre"})
        self.assertEqual(code, 400)  # lien à usage unique


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def multipart(fields, fname, filename, content):
    b = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{fname}"; filename="{filename}"\r\n'
                 f"Content-Type: text/csv\r\n\r\n".encode() + content + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={b}"


if __name__ == "__main__":
    unittest.main()
