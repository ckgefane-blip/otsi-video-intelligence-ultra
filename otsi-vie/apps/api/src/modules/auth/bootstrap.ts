/**
 * First-run setup of a fresh installation (ADR-021): one organization and its OWNER with a local password. Real data only — the owner's
 * own name, email and organization. Refuses to run once an organization exists unless explicitly asked to add another.
 * Self-service organization registration and invitations are F01 (commercial onboarding), built later.
 */
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { writeAudit } from "../../core/audit";
import type { Db } from "../../core/db";
import { hashPassword, passwordProblem } from "../../core/passwords";

export interface BootstrapInput { email: string; displayName: string; organizationName: string; password: string; allowAdditional?: boolean }
export interface BootstrapResult { organizationId: string; userId: string }

export function slugify(name: string): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "organization"}-${uuidv7().slice(-6)}`;
}

export async function bootstrapOwner(db: Db, input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("a valid email address is required");
  const name = input.displayName.trim(), org = input.organizationName.trim();
  if (name.length < 2 || org.length < 2) throw new Error("name and organization name need at least 2 characters");
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  const hash = await hashPassword(input.password);
  return db.tx(async (c) => {
    const [existing] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM organizations FOR UPDATE");
    if (Number(existing[0]!.n) > 0 && !input.allowAdditional) {
      throw new Error("this installation already has an organization; sign in, or pass --additional-organization to create another");
    }
    const [taken] = await c.query<RowDataPacket[]>("SELECT 1 FROM local_credentials WHERE email_normalized = ?", [email]);
    if (taken.length > 0) throw new Error("that email already has an account");
    const organizationId = uuidv7(), userId = uuidv7();
    await c.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [organizationId, org, slugify(org)]);
    await c.query("INSERT INTO users (id, external_subject, email, display_name) VALUES (?, ?, ?, ?)", [userId, `local:${userId}`, email, name]);
    await c.query("INSERT INTO memberships (organization_id, user_id, role, status) VALUES (?, ?, 'OWNER', 'ACTIVE')", [organizationId, userId]);
    await c.query("INSERT INTO local_credentials (user_id, email_normalized, password_hash) VALUES (?, ?, ?)", [userId, email, hash]);
    const actor = { kind: "SYSTEM" as const, service: "bootstrap", organizationId };
    await writeAudit(c, actor, { action: "organization.created", entityType: "organization", entityId: organizationId, after: { name: org } });
    await writeAudit(c, actor, { action: "membership.created", entityType: "user", entityId: userId, after: { email, display_name: name, role: "OWNER" } });
    return { organizationId, userId };
  });
}
