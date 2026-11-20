#!/usr/bin/env python3
"""Envoie le site construit (dossier site/) sur l'hébergement OVH par FTP.

N'envoie que les fichiers qui ont changé depuis le dernier envoi : un manifeste
(chemin -> empreinte SHA-256) est conservé sur le serveur dans .deploy-manifest.json.
Les fichiers supprimés du site sont supprimés du serveur, mais seulement s'ils
figuraient dans le manifeste : rien d'autre n'est jamais touché (config.php,
fichiers déposés à la main…).

Variables d'environnement (secrets GitHub, jamais dans le dépôt) :
  OVH_FTP_HOST      ex. ftp.clusterXXX.hosting.ovh.net
  OVH_FTP_USER      identifiant FTP
  OVH_FTP_PASSWORD  mot de passe FTP
  OVH_FTP_DIR       dossier racine du site sur le serveur, ex. agregatrail
  OVH_FTP_TLS       « 0 » pour désactiver le chiffrement (déconseillé), par défaut essai en FTPS

Configuration de l'API (facultatif) : si DB_PASSWORD est fourni, le fichier
agregatrail-prive/config.php est écrit à côté du dossier du site, hors de la racine web,
à partir de DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD, SITE_URL, ADMIN_EMAIL (une ou
plusieurs adresses séparées par des virgules) et MAIL_FROM.

Bibliothèque standard uniquement.
"""
import argparse
import ftplib
import hashlib
import io
import json
import os
import posixpath
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ".deploy-manifest.json"
# Jamais envoyés : fichiers de config locaux, caches, fichiers d'exemple de secrets.
EXCLUDE_NAMES = {"config.php", ".DS_Store", "__pycache__"}


def local_files(site: Path) -> dict:
    """Chemin relatif (séparateur /) -> empreinte SHA-256, pour tous les fichiers à publier."""
    out = {}
    for p in sorted(site.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(site)
        if any(part in EXCLUDE_NAMES for part in rel.parts):
            continue
        out[rel.as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def plan(local: dict, remote: dict):
    """Fichiers à envoyer et à supprimer. Le manifeste est toujours envoyé en dernier."""
    upload = sorted(k for k, h in local.items() if remote.get(k) != h)
    delete = sorted(k for k in remote if k not in local)
    return upload, delete


class Remote:
    """Opérations FTP minimales, isolées pour pouvoir être simulées dans les tests."""

    def __init__(self, ftp, base: str):
        self.ftp = ftp
        self.base = base.strip("/")
        self.dirs = set()

    def _path(self, rel):
        return f"{self.base}/{rel}" if self.base else rel

    def read(self, rel):
        buf = io.BytesIO()
        try:
            self.ftp.retrbinary(f"RETR {self._path(rel)}", buf.write)
        except ftplib.error_perm:
            return None
        return buf.getvalue()

    def mkdirs(self, rel_dir):
        parts = [p for p in self._path(rel_dir).split("/") if p]
        cur = ""
        for p in parts:
            cur = f"{cur}/{p}" if cur else p
            if cur in self.dirs:
                continue
            try:
                self.ftp.mkd(cur)
            except ftplib.error_perm:
                pass  # existe déjà
            self.dirs.add(cur)

    def put(self, rel, data: bytes):
        if "/" in rel:
            self.mkdirs(rel.rsplit("/", 1)[0])
        elif self.base:
            self.mkdirs("")
        self.ftp.storbinary(f"STOR {self._path(rel)}", io.BytesIO(data))

    def delete(self, rel):
        try:
            self.ftp.delete(self._path(rel))
        except ftplib.error_perm:
            pass


def deploy(site: Path, remote: Remote, dry_run=False, log=print):
    local = local_files(site)
    raw = remote.read(MANIFEST)
    try:
        previous = json.loads(raw) if raw else {}
    except ValueError:
        previous = {}
    upload, delete = plan(local, previous)
    log(f"{len(local)} fichiers dans le site, {len(upload)} à envoyer, {len(delete)} à supprimer")
    if dry_run:
        return upload, delete
    # Les données d'abord, la page d'accueil et le service worker en dernier :
    # un visiteur ne charge jamais une page qui pointe vers des fichiers pas encore envoyés.
    last = {"index.html", "sw.js"}
    for rel in [u for u in upload if u not in last] + [u for u in upload if u in last]:
        remote.put(rel, (site / rel).read_bytes())
    for rel in delete:
        remote.delete(rel)
    remote.put(MANIFEST, json.dumps(local, sort_keys=True).encode())
    return upload, delete


def php_str(v: str) -> str:
    """Chaîne PHP entre apostrophes, échappée."""
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"


def config_php(env) -> str:
    """Contenu de config.php construit à partir des secrets (jamais écrit dans le dépôt)."""
    dsn = f"mysql:host={env['DB_SERVER']};port=3306;dbname={env['DB_NAME']};charset=utf8mb4"
    admins = [a.strip() for a in env.get("ADMIN_EMAIL", "").split(",") if a.strip()]
    lignes = [
        "<?php",
        "// Écrit par scripts/deploy_ftp.py à chaque déploiement, depuis les secrets GitHub. Ne pas modifier ici.",
        "return [",
        f"    'db_dsn' => {php_str(dsn)},",
        f"    'db_user' => {php_str(env['DB_USER'])},",
        f"    'db_pass' => {php_str(env['DB_PASSWORD'])},",
        f"    'site_url' => {php_str(env.get('SITE_URL') or 'https://agregatrail.gcsports.fr/')},",
        "    'admin_emails' => [" + ", ".join(php_str(a) for a in admins) + "],",
        f"    'mail_from' => {php_str(env.get('MAIL_FROM') or 'no-reply@gcsports.fr')},",
        "];",
        "",
    ]
    return "\n".join(lignes)


def config_path(base: str) -> str:
    """Dossier privé à côté de la racine du site : <parent>/agregatrail-prive/config.php."""
    parent = posixpath.dirname(base.strip("/"))
    return posixpath.join(parent, "agregatrail-prive", "config.php")


def connect(host, user, password, use_tls=True):
    if use_tls:
        try:
            ftp = ftplib.FTP_TLS(host, timeout=60)
            ftp.login(user, password)
            ftp.prot_p()
            return ftp
        except ftplib.error_perm as e:
            print(f"FTPS refusé ({e}), connexion FTP simple", file=sys.stderr)
    ftp = ftplib.FTP(host, timeout=60)
    ftp.login(user, password)
    return ftp


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", default=str(ROOT / "site"))
    ap.add_argument("--dry-run", action="store_true", help="affiche ce qui serait envoyé sans rien modifier")
    a = ap.parse_args(argv)
    env = os.environ
    missing = [k for k in ("OVH_FTP_HOST", "OVH_FTP_USER", "OVH_FTP_PASSWORD") if not env.get(k)]
    if missing:
        print("Variables manquantes : " + ", ".join(missing), file=sys.stderr)
        return 2
    ftp = connect(env["OVH_FTP_HOST"], env["OVH_FTP_USER"], env["OVH_FTP_PASSWORD"], env.get("OVH_FTP_TLS", "1") != "0")
    try:
        deploy(Path(a.site), Remote(ftp, env.get("OVH_FTP_DIR", "")), dry_run=a.dry_run)
        if env.get("DB_PASSWORD") and not a.dry_run:
            manque = [k for k in ("DB_SERVER", "DB_NAME", "DB_USER") if not env.get(k)]
            if manque:
                print("Configuration de l'API non écrite, il manque : " + ", ".join(manque), file=sys.stderr)
            else:
                chemin = config_path(env.get("OVH_FTP_DIR", ""))
                Remote(ftp, "").put(chemin, config_php(env).encode())
                print(f"Configuration de l'API écrite dans {chemin}")
    finally:
        try:
            ftp.quit()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
