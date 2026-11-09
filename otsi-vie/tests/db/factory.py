"""A schema-driven row factory for database tests: builds a minimal VALID row for any table straight from information_schema.

Required columns get values that satisfy their type, ENUM and CHECK-list constraints; required foreign keys get a parent row created first, in
the SAME organization when the parent is tenant-owned. Nothing here is match/player data: values are synthetic test identifiers.
"""
from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import dataclass, field


@dataclass
class Meta:
    columns: dict[str, list[dict]] = field(default_factory=dict)
    fks: dict[str, list[dict]] = field(default_factory=dict)          # child table -> [{name, cols, parent, pcols}]
    checks: dict[str, list[str]] = field(default_factory=dict)
    pk: dict[str, list[str]] = field(default_factory=dict)


def load_meta(cur) -> Meta:
    m = Meta()
    cur.execute("""SELECT table_name, column_name, data_type, column_type, is_nullable, column_default, extra, character_maximum_length
                   FROM information_schema.columns WHERE table_schema=DATABASE() ORDER BY table_name, ordinal_position""")
    for t, c, dtp, ctp, nul, dflt, extra, ln in cur.fetchall():
        m.columns.setdefault(t, []).append({"name": c, "type": dtp, "ctype": ctp, "nullable": nul == "YES", "default": dflt, "extra": extra or "", "len": ln})
    cur.execute("""SELECT k.table_name, k.constraint_name, k.column_name, k.referenced_table_name, k.referenced_column_name
                   FROM information_schema.key_column_usage k WHERE k.table_schema=DATABASE() AND k.referenced_table_name IS NOT NULL
                   ORDER BY k.table_name, k.constraint_name, k.ordinal_position""")
    tmp: dict[tuple, dict] = {}
    for t, name, col, pt, pc in cur.fetchall():
        d = tmp.setdefault((t, name), {"name": name, "cols": [], "parent": pt, "pcols": []})
        d["cols"].append(col)
        d["pcols"].append(pc)
    for (t, _), d in tmp.items():
        m.fks.setdefault(t, []).append(d)
    cur.execute("""SELECT tc.table_name, cc.check_clause FROM information_schema.check_constraints cc
                   JOIN information_schema.table_constraints tc ON tc.constraint_schema=cc.constraint_schema AND tc.constraint_name=cc.constraint_name
                   WHERE cc.constraint_schema=DATABASE()""")
    for t, clause in cur.fetchall():
        m.checks.setdefault(t, []).append(clause)
    cur.execute("""SELECT table_name, column_name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND constraint_name='PRIMARY'
                   ORDER BY table_name, ordinal_position""")
    for t, c in cur.fetchall():
        m.pk.setdefault(t, []).append(c)
    return m


def _allowed(meta: Meta, table: str, col: str) -> str | None:
    for clause in meta.checks.get(table, []):
        clause = clause.replace("\\'", "'")      # information_schema stores the quotes escaped: _utf8mb4\'VALUE\'
        mm = re.search(r"`" + re.escape(col) + r"`\s+in\s*\((.*?)\)", clause, re.I)
        if mm:
            v = re.search(r"'([^']*)'", mm.group(1))
            if v:
                return v.group(1)
    return None


# columns whose CHECK is a pattern rather than a value list (0009, 0010): a valid sample value (callables give unique values)
PATTERNED = {
    ("audit_events", "action"): "test.factory_row",
    ("local_credentials", "password_hash"): "scrypt$16384$8$1$c2FsdA$aGFzaA",
    ("local_credentials", "email_normalized"): lambda: f"f{uuid.uuid4().hex[:12]}@test.invalid",
    ("auth_sessions", "expires_at"): dt.datetime(2099, 1, 1),     # must follow created_at, which defaults to now
    ("organization_invitations", "email_normalized"): lambda: f"i{uuid.uuid4().hex[:12]}@test.invalid",   # 0036
    ("organization_invitations", "expires_at"): dt.datetime(2099, 1, 1),
    ("organization_invitations", "accepted_at"): dt.datetime(2099, 1, 1),   # an accepted invitation (accepted_by is a filled foreign key)
    ("organization_invitations", "accepted_by"): None,             # listed so the factory fills it from a users row
    ("organization_invitations", "revoked_at"): None,              # used once: accepted, so not withdrawn
    ("user_totp", "secret_sealed"): "v1.aXY.Y3Q",                  # 0037
    ("worker_jobs", "claim_token"): None,                          # a QUEUED job (the default state) is unclaimed: no token, no lease
    ("worker_jobs", "lease_expires_at"): None,
    ("worker_jobs", "paused_at"): None,                            # 0045: never held (paused_at / paused_by come as a pair)
    ("worker_jobs", "paused_by"): None,
    ("track_links", "method"): "APPEARANCE",                    # 0014: value list inside a combined CHECK
    ("track_links", "score"): 0.5,
    ("track_links", "gap_us"): 0,
    ("track_jersey_evidence", "state"): "UNREADABLE",            # 0016: a recognised state requires a number
    ("track_jersey_evidence", "side"): "UNKNOWN",
    ("jersey_number_decisions", "state"): "UNREADABLE",
    ("jersey_number_decisions", "number"): "7",
    ("track_jersey_evidence", "number"): "7",
    ("pitch_calibration_requests", "pitch_length_m"): 105,        # 0024: a real pitch is 90-120 m by 45-90 m
    ("pitch_calibration_requests", "pitch_width_m"): 68,
    ("pitch_cameras", "pitch_length_m"): 105,                     # 0025: the same pitch rule, a camera above the pitch, at least two clicks
    ("pitch_cameras", "pitch_width_m"): 68,
    ("pitch_cameras", "height_m"): 11.0,
    ("pitch_cameras", "points"): 6,
    ("pitch_cameras", "click_rms_px"): 1.5,
    ("ball_marks", "visible"): 0,                                 # 0027: a hidden ball has no position
    ("ball_marks", "x"): None,
    ("ball_marks", "y"): None,
    ("ball_marks", "pts_us"): 1_000_000,
    ("video_quality_assessments", "status"): "QUEUED",          # 0017: a SUCCEEDED assessment requires metrics and a profile
    ("video_quality_assessments", "recommended_profile"): "STANDARD",
    ("match_roster_changes", "action"): "ADDED",
    ("match_rosters", "role"): "STARTER",
}


def _value(meta: Meta, table: str, c: dict):
    if (table, c["name"]) in PATTERNED:
        v = PATTERNED[(table, c["name"])]
        return v() if callable(v) else v
    a = _allowed(meta, table, c["name"])
    if a is not None:
        return a
    if c["type"] == "enum":
        return re.search(r"'([^']*)'", c["ctype"]).group(1)
    name = c["name"].lower()
    big = any(k in name for k in ("end", "_out", "out_", "max", "until", "expires", "to_"))
    if c["type"] in ("char", "varchar"):
        if c["len"] == 36:
            return str(uuid.uuid4())
        if c["len"] == 64:
            return uuid.uuid4().hex + uuid.uuid4().hex
        return ("t" + uuid.uuid4().hex)[: max(1, min(c["len"] or 20, 24))]
    if c["type"] in ("text", "mediumtext", "longtext", "tinytext"):
        return "test"
    if c["type"] == "json":
        return "{}"
    if c["type"] == "tinyint" and "(1)" in c["ctype"]:
        return 0
    if c["type"] in ("tinyint", "smallint", "mediumint", "int", "bigint"):
        return 2 if big else 1
    if c["type"] in ("decimal", "double", "float"):
        return 0.4 if not big else 0.5          # normalized boxes and scores live in [0, 1]; x + w <= 1
    if c["type"] in ("datetime", "timestamp"):
        now = dt.datetime(2026, 1, 1, 12, 0, 0)
        return now + dt.timedelta(days=1) if big else now
    if c["type"] == "date":
        return dt.date(2026, 1, 2) if big else dt.date(2026, 1, 1)
    if c["type"] in ("binary", "varbinary", "blob", "mediumblob"):
        return b"\x00"
    raise ValueError(f"no test value for {table}.{c['name']} ({c['ctype']})")


def _required_by_checks(meta: Meta, table: str) -> set[str]:
    """Nullable columns a CHECK demands in some state ("... or `decided_by` is not null"): fill them so every state stays valid."""
    out = set()
    for clause in meta.checks.get(table, []):
        out.update(re.findall(r"`([a-z0-9_]+)` is not null", clause, re.I))
    out.update(col for (t, col) in PATTERNED if t == table)       # a column given a sample value is always filled with it
    return out


# Columns a test row must never invent: the canonical ID is issued only by the allocator, a merge link only by a merge decision (ADR-016).
NEVER_FILL = {("players", "canonical_otsi_id"), ("players", "merged_into_player_id"),
              # 0040: a comment has one author, a team member (the minimal row) or a named guest of one share link, never both
              ("comments", "share_link_id"), ("comments", "guest_name")}
REFERENCE_TABLES = {"countries"}


class Factory:
    def __init__(self, conn, meta: Meta):
        self.conn, self.meta = conn, meta

    def org(self) -> str:
        return self.make("organizations")["id"]

    def make(self, table: str, org: str | None = None, **over) -> dict:
        """Insert one minimal valid row; returns its column values (including the generated primary key)."""
        cols = {c["name"]: c for c in self.meta.columns[table]}
        has_org = "organization_id" in cols
        if has_org and "organization_id" not in over:
            over["organization_id"] = org if org is not None else (self.org() if not cols["organization_id"]["nullable"] else None)
        row: dict = {}
        tenant = over.get("organization_id", org)
        must = _required_by_checks(self.meta, table)
        for fk in self.meta.fks.get(table, []):
            own = [c for c in fk["cols"] if c != "organization_id"]
            if fk["parent"] == "organizations" or (own and all(c in over for c in own)) or any((table, c) in NEVER_FILL for c in own):
                continue
            # MATCH SIMPLE: a composite key with any NULL column is not checked, so it is required only if ALL its columns must be filled
            required = all(not cols[c]["nullable"] or (c in must and (table, c) not in NEVER_FILL) for c in own)
            if not required:
                continue
            if all(c in row for c in fk["cols"]):
                continue
            if fk["parent"] in REFERENCE_TABLES:          # seeded reference data: use an existing row, never invent one
                with self.conn.cursor() as cur:
                    cur.execute(f"SELECT {', '.join(f'`{c}`' for c in fk['pcols'])} FROM `{fk['parent']}` LIMIT 1")
                    for c, v in zip(fk["cols"], cur.fetchone()):
                        row[c] = v
                continue
            parent_over = {}
            if "organization_id" in fk["pcols"]:
                parent_over["organization_id"] = tenant
            p = self.make(fk["parent"], org=tenant, **parent_over)
            for c, pc in zip(fk["cols"], fk["pcols"]):
                row[c] = p[pc]
        row.update({k: v for k, v in over.items() if v is not None or cols[k]["nullable"]})
        for name, c in cols.items():
            if (table, name) in NEVER_FILL and name not in over:
                continue
            if name in row or (c["nullable"] and name not in must) or c["default"] is not None or "auto_increment" in c["extra"] or "DEFAULT_GENERATED" in c["extra"]:
                continue
            row[name] = _value(self.meta, table, c)
        if table == "player_duplicate_candidates" and row["player_a_id"] > row["player_b_id"]:   # the pair is stored in id order
            row["player_a_id"], row["player_b_id"] = row["player_b_id"], row["player_a_id"]
        with self.conn.cursor() as cur:
            names = ", ".join(f"`{k}`" for k in row)
            cur.execute(f"INSERT INTO `{table}` ({names}) VALUES ({', '.join(['%s'] * len(row))})", list(row.values()))
            pk = self.meta.pk.get(table, [])
            if len(pk) == 1 and pk[0] not in row:
                row[pk[0]] = cur.lastrowid
        return row
