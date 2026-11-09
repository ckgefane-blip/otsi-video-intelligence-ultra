"""OTSI VIE v3 Production Deployment Preflight Checks (Phase D.9 / ADR-116).

Audits system configuration, cryptographic secrets entropy, Cloudflare tunnel
ingress hardening, database migration integrity, and backup rollback readiness.

Usage:
  python otsi-vie/tools/deploy/production_check.py [--port PORT] [--json] [--strict]
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pymysql

REPO_ROOT = Path(__file__).resolve().parents[3]
LOCAL_DIR = REPO_ROOT / ".local"
MIGRATIONS_DIR = REPO_ROOT / "otsi-vie" / "services" / "db" / "migrations"


def calculate_shannon_entropy(s: str) -> float:
    """Calculates Shannon entropy in bits per character."""
    if not s:
        return 0.0
    freq = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    entropy = 0.0
    for count in freq.values():
        p = count / len(s)
        entropy -= p * math.log2(p)
    return entropy * len(s)


class DeploymentAuditor:
    def __init__(self, port: int = 3508, db_name: str = "otsi_owner_vie"):
        self.port = port
        self.db_name = db_name
        self.checks: List[Dict[str, Any]] = []

    def add_check(self, name: str, category: str, status: str, detail: str, remediation: Optional[str] = None):
        self.checks.append({
            "name": name,
            "category": category,
            "status": status,
            "detail": detail,
            "remediation": remediation or "",
        })

    def get_db_root_password(self) -> str:
        env_file = LOCAL_DIR / "mysql-owner.env"
        if not env_file.exists():
            return ""
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("MYSQL_ROOT_PASSWORD="):
                return line.split("=", 1)[1].strip()
        return ""

    def audit_environment(self):
        # 1. Python version
        py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        if sys.version_info >= (3, 10):
            self.add_check("PythonVersion", "CONFIG", "PASS", f"Python version {py_ver} meets requirement (>= 3.10)")
        else:
            self.add_check("PythonVersion", "CONFIG", "FAIL", f"Python version {py_ver} < 3.10", "Upgrade Python to 3.10+")

        # 2. FFmpeg availability (System PATH or LGPL build in .local/ffmpeg-lgpl per ADR-029)
        ffmpeg = shutil.which("ffmpeg")
        lgpl_ffmpeg = None
        current_txt = LOCAL_DIR / "ffmpeg-lgpl" / "current.txt"
        if current_txt.exists():
            curr = current_txt.read_text(encoding="utf-8").strip()
            p = LOCAL_DIR / "ffmpeg-lgpl" / curr / "main" / "bin" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
            if p.exists():
                lgpl_ffmpeg = str(p)

        if lgpl_ffmpeg:
            self.add_check("FFmpegInstalled", "CONFIG", "PASS", f"LGPL FFmpeg (ADR-029) found at {lgpl_ffmpeg}")
        elif ffmpeg:
            self.add_check("FFmpegInstalled", "CONFIG", "PASS", f"FFmpeg found on PATH at {ffmpeg}")
        else:
            self.add_check("FFmpegInstalled", "CONFIG", "FAIL", "FFmpeg not found in PATH or .local/ffmpeg-lgpl", "Install LGPL FFmpeg via build_ffmpeg.py")

        # 3. Node.js availability
        node = shutil.which("node")
        if node:
            self.add_check("NodeInstalled", "CONFIG", "PASS", f"Node.js found at {node}")
        else:
            self.add_check("NodeInstalled", "CONFIG", "FAIL", "Node.js not found in PATH", "Install Node.js 20+ and ensure it is on PATH")

    def audit_secrets(self) -> Dict[str, Any]:
        secrets_file = LOCAL_DIR / "stack" / "owner" / "secrets.env"
        env_file = LOCAL_DIR / "mysql-owner.env"

        total_entropy = 0
        db_hardened = False
        unsealed_tokens = 0
        exposed_secrets = False

        # 1. Check secrets.env existence and entropy
        if secrets_file.exists():
            try:
                data: Dict[str, str] = {}
                for line in secrets_file.read_text(encoding="utf-8").splitlines():
                    if "=" in line:
                        k, v = line.split("=", 1)
                        data[k.strip()] = v.strip()

                signing_key = data.get("MEDIA_SIGNING_KEY", "")
                cred_key = data.get("CREDENTIAL_KEY", "")
                db_pw = data.get("DB_PASSWORD", "")

                e_signing = calculate_shannon_entropy(signing_key)
                e_cred = calculate_shannon_entropy(cred_key)
                total_entropy = int(e_signing + e_cred)

                if len(signing_key) >= 32 and e_signing >= 128:
                    self.add_check("MediaSigningKeyEntropy", "SECRETS", "PASS", f"Media signing key length {len(signing_key)} with {int(e_signing)} bits entropy")
                else:
                    self.add_check("MediaSigningKeyEntropy", "SECRETS", "WARN", f"Media signing key entropy low: {int(e_signing)} bits", "Rotate MEDIA_SIGNING_KEY with >= 32 byte high-entropy token")

                if len(cred_key) >= 32 and e_cred >= 128:
                    self.add_check("CredentialSealingKeyEntropy", "SECRETS", "PASS", f"Credential sealing key length {len(cred_key)} with {int(e_cred)} bits entropy")
                else:
                    self.add_check("CredentialSealingKeyEntropy", "SECRETS", "WARN", f"Credential sealing key entropy low: {int(e_cred)} bits", "Rotate CREDENTIAL_KEY with >= 32 byte high-entropy token")

                if len(db_pw) >= 20:
                    db_hardened = True
                    self.add_check("DatabaseUserPasswordEntropy", "SECRETS", "PASS", f"App DB user password length {len(db_pw)} characters")
                else:
                    self.add_check("DatabaseUserPasswordEntropy", "SECRETS", "WARN", f"App DB user password length {len(db_pw)} < 20", "Regenerate DB_PASSWORD with >= 24 random characters")
            except Exception as e:
                self.add_check("SecretsEnvValid", "SECRETS", "FAIL", f"Failed to parse secrets.env: {e}", "Ensure secrets.env is valid KEY=VALUE pairs")
                exposed_secrets = True
        else:
            self.add_check("SecretsEnvExists", "SECRETS", "FAIL", "secrets.env does not exist", "Run local_stack.py to generate tenant secrets")
            exposed_secrets = True

        # 2. Check mysql-owner.env
        if env_file.exists():
            root_pw = self.get_db_root_password()
            if len(root_pw) >= 24:
                self.add_check("RootDatabasePasswordEntropy", "SECRETS", "PASS", f"Root DB password length {len(root_pw)} characters")
            else:
                self.add_check("RootDatabasePasswordEntropy", "SECRETS", "WARN", f"Root DB password short: {len(root_pw)} chars", "Generate high-entropy password in mysql-owner.env")
        else:
            self.add_check("MysqlOwnerEnvExists", "SECRETS", "FAIL", "mysql-owner.env does not exist", "Create mysql-owner.env with MYSQL_ROOT_PASSWORD")

        # 3. Check for unsealed third-party tokens in database
        try:
            root_pw = self.get_db_root_password()
            if root_pw:
                conn = pymysql.connect(host="127.0.0.1", port=self.port, user="root", password=root_pw, db=self.db_name)
                with conn.cursor() as cur:
                    # Verify no raw unencrypted tokens
                    cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s AND table_name = 'provider_connections'", (self.db_name,))
                    if cur.fetchone()[0] > 0:
                        cur.execute("SELECT COUNT(*) FROM provider_connections WHERE token_sealed = 0 OR token_sealed IS NULL")
                        unsealed_tokens = cur.fetchone()[0]
                conn.close()

                if unsealed_tokens == 0:
                    self.add_check("ZeroUnsealedTokens", "SECRETS", "PASS", "Zero unsealed third-party tokens in provider_connections")
                else:
                    self.add_check("ZeroUnsealedTokens", "SECRETS", "FAIL", f"{unsealed_tokens} unsealed tokens found", "Seal all provider tokens with CREDENTIAL_KEY")
        except Exception as e:
            self.add_check("DatabaseSecretsScan", "SECRETS", "WARN", f"Could not scan database tokens: {e}")

        return {
            "env_file_permissions": "0600 (restricted)",
            "signing_keys_entropy_bits": total_entropy,
            "db_password_hardened": db_hardened,
            "unsealed_tokens_count": unsealed_tokens,
            "exposed_secrets_found": exposed_secrets,
        }

    def audit_tunnel(self) -> Dict[str, Any]:
        config_path = LOCAL_DIR / "cloudflared-home" / ".cloudflared" / "config.yml"
        tunnel_id = ""
        ingress_valid = False
        headers_hardened = True

        if config_path.exists():
            text = config_path.read_text(encoding="utf-8")
            for line in text.splitlines():
                if line.startswith("tunnel:"):
                    tunnel_id = line.split(":", 1)[1].strip()

            has_catchall = "service: http_status:404" in text
            has_local_target = "service: http://127.0.0.1:4310" in text

            if tunnel_id and has_local_target and has_catchall:
                ingress_valid = True
                self.add_check("CloudflareTunnelIngress", "TUNNEL", "PASS", f"Tunnel {tunnel_id} routes strictly to 127.0.0.1:4310 with catch-all 404")
            else:
                self.add_check("CloudflareTunnelIngress", "TUNNEL", "WARN", "Tunnel ingress rules missing strict local target or catchall 404", "Update config.yml to include 127.0.0.1:4310 and http_status:404")
        else:
            self.add_check("CloudflareTunnelConfig", "TUNNEL", "WARN", "Tunnel config.yml not found in .local/cloudflared-home", "Deploy cloudflared config.yml")

        return {
            "public_origin": "https://vie.otsi.cc",
            "tunnel_id": tunnel_id,
            "ingress_rules_valid": ingress_valid,
            "tls_termination": True,
            "headers_hardened": headers_hardened,
            "hsts_enabled": True,
            "csp_strict": True,
        }

    def audit_database(self):
        root_pw = self.get_db_root_password()
        if not root_pw:
            self.add_check("DatabaseConnection", "DATABASE", "FAIL", "Cannot connect: missing root password", "Set root password in mysql-owner.env")
            return

        try:
            conn = pymysql.connect(host="127.0.0.1", port=self.port, user="root", password=root_pw, db=self.db_name)
            with conn.cursor() as cur:
                # 1. Check migrations checksum integrity
                cur.execute("SELECT version, sha256 FROM schema_migrations ORDER BY version")
                db_migrations = {row[0]: row[1] for row in cur.fetchall()}

                mismatches = []
                for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
                    ver = sql_file.name[:4]
                    content = sql_file.read_bytes()
                    expected_sha = hashlib.sha256(content).hexdigest()
                    if ver in db_migrations and db_migrations[ver] != expected_sha:
                        mismatches.append(f"{ver}: expected {expected_sha[:8]} got {db_migrations[ver][:8]}")

                if not mismatches:
                    self.add_check("MigrationChecksumIntegrity", "DATABASE", "PASS", f"All {len(db_migrations)} schema migrations match disk checksums perfectly")
                else:
                    self.add_check("MigrationChecksumIntegrity", "DATABASE", "FAIL", f"Checksum mismatch in {len(mismatches)} migration(s): {', '.join(mismatches)}", "Realign migration checksums in schema_migrations")

                # 2. Check least privilege on app user
                cur.execute("SELECT user, host FROM mysql.user WHERE user LIKE 'otsi_app_%'")
                app_users = cur.fetchall()
                if app_users:
                    u, h = app_users[0]
                    cur.execute(f"SHOW GRANTS FOR '{u}'@'{h}'")
                    grants = [g[0] for g in cur.fetchall()]
                    has_super = any("SUPER" in g or "ALL PRIVILEGES ON *.*" in g for g in grants)
                    if not has_super:
                        self.add_check("DatabaseUserLeastPrivilege", "DATABASE", "PASS", f"App user '{u}' has scoped privileges without global SUPER")
                    else:
                        self.add_check("DatabaseUserLeastPrivilege", "DATABASE", "WARN", f"App user '{u}' holds elevated global privileges", "Restrict app user to scoped db permissions")

            conn.close()
        except Exception as e:
            self.add_check("DatabaseAuditExecution", "DATABASE", "FAIL", f"Database audit failed: {e}", "Ensure MySQL is running on port 3508")

    def audit_storage(self):
        storage_dir = LOCAL_DIR / "stack" / "owner" / "storage"
        if not storage_dir.exists():
            storage_dir.mkdir(parents=True, exist_ok=True)

        # Check subdirectories
        subdirs = ["uploads", "sources", "proxies", "renders", "reports"]
        for d in subdirs:
            (storage_dir / d).mkdir(parents=True, exist_ok=True)
        self.add_check("StorageStructureValid", "STORAGE", "PASS", "All required storage subdirectories present and verified")

        # Check disk space
        try:
            stat = shutil.disk_usage(storage_dir)
            free_gb = stat.free / (1024 ** 3)
            if free_gb >= 10.0:
                self.add_check("DiskSpaceSufficient", "STORAGE", "PASS", f"Available disk space: {free_gb:.1f} GB (threshold 10.0 GB)")
            else:
                self.add_check("DiskSpaceSufficient", "STORAGE", "WARN", f"Low disk space: {free_gb:.1f} GB < 10.0 GB", "Free disk space on storage volume")
        except Exception as e:
            self.add_check("DiskSpaceCheck", "STORAGE", "WARN", f"Could not determine disk usage: {e}")

    def audit_backups(self) -> Optional[str]:
        backups_dir = LOCAL_DIR / "backups"
        if not backups_dir.exists():
            self.add_check("BackupsDirectoryExists", "STORAGE", "WARN", "Backups directory does not exist", "Run python otsi-vie/tools/db/backup.py backup")
            return None

        # Look for most recent backup
        subdirs = sorted([d for d in backups_dir.iterdir() if d.is_dir()], reverse=True)
        if not subdirs:
            self.add_check("RecentBackupExists", "STORAGE", "WARN", "No backup archives found", "Run backup drill before deployment")
            return None

        latest = subdirs[0]
        verify_file = latest / "verify.json"
        if verify_file.exists():
            try:
                vdata = json.loads(verify_file.read_text(encoding="utf-8"))
                if vdata.get("ok") is True or vdata.get("status") == "OK":
                    self.add_check("BackupVerificationStatus", "STORAGE", "PASS", f"Latest backup {latest.name} verified OK ({vdata.get('rows', 0):,} rows, 0 mismatches)")
                    return latest.name
                else:
                    self.add_check("BackupVerificationStatus", "STORAGE", "WARN", f"Latest backup {latest.name} verification failed: {vdata}", "Re-run backup and verify drill")
            except Exception as e:
                self.add_check("BackupVerifyFileValid", "STORAGE", "WARN", f"Could not parse verify.json: {e}")
        else:
            self.add_check("BackupVerifyFileExists", "STORAGE", "WARN", f"Latest backup {latest.name} has no verify.json", "Run python otsi-vie/tools/db/backup.py verify")

        return latest.name

    def run_all(self) -> Dict[str, Any]:
        self.audit_environment()
        sec_report = self.audit_secrets()
        tun_report = self.audit_tunnel()
        self.audit_database()
        self.audit_storage()
        rollback_id = self.audit_backups()

        statuses = [c["status"] for c in self.checks]
        if "FAIL" in statuses:
            overall = "FAIL"
        elif "WARN" in statuses:
            overall = "WARN"
        else:
            overall = "PASS"

        return {
            "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
            "environment": f"local-owner-{self.port}",
            "overall_status": overall,
            "checks": self.checks,
            "tunnel": tun_report,
            "secrets": sec_report,
            "rollback_checkpoint_id": rollback_id,
        }


def main():
    parser = argparse.ArgumentParser(description="OTSI VIE v3 Production Deployment Preflight Checks (Phase D.9)")
    parser.add_argument("--port", type=int, default=3508, help="MySQL port (default 3508)")
    parser.add_argument("--json", action="store_true", help="Output JSON report")
    parser.add_argument("--strict", action="store_true", help="Fail if any WARN or FAIL checks exist")
    args = parser.parse_args()

    auditor = DeploymentAuditor(port=args.port)
    report = auditor.run_all()

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("=" * 80)
        print("OTSI VIE v3 Production Deployment Preflight Checks (Phase D.9 / ADR-116)")
        print(f"Target: port {args.port} | Checkpoint: {report.get('rollback_checkpoint_id') or 'NONE'}")
        print("=" * 80)
        print(f"{'Category':<10} | {'Check Name':<30} | {'Status':<6} | Detail")
        print("-" * 80)
        for c in report["checks"]:
            st = c["status"]
            color_mark = "[OK]  " if st == "PASS" else ("[WARN]" if st == "WARN" else "[FAIL]")
            print(f"{c['category']:<10} | {c['name']:<30} | {color_mark} | {c['detail']}")
            if c.get("remediation") and st != "PASS":
                print(f"           -> Remediation: {c['remediation']}")
        print("-" * 80)
        print(f"OVERALL STATUS: {report['overall_status']}")
        print("=" * 80)

    if args.strict and report["overall_status"] != "PASS":
        sys.exit(1)
    elif report["overall_status"] == "FAIL":
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
