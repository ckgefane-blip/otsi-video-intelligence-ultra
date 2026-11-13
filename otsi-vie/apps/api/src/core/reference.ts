/**
 * One reference sequence for every bank transfer OTSI is paid by — plan orders and token top-ups alike — so a
 * reference is unique across both and the owner matches any transfer to exactly one thing (migration 0075).
 * Taken under SELECT ... FOR UPDATE inside the caller's transaction: the year's row is created if missing, read
 * locked and incremented, so two concurrent orders never share a reference and a reference is never reused.
 */
import { formatBankTransferReference } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import type { Db, Executor } from "./db";

export async function nextBankTransferReference(db: Db, ex: Executor, year: number): Promise<string> {
  await ex.query("INSERT IGNORE INTO bank_transfer_reference_seq (`year`, next_seq) VALUES (?, 0)", [year]);
  const row = await db.one<RowDataPacket>("SELECT next_seq FROM bank_transfer_reference_seq WHERE `year` = ? FOR UPDATE", [year], ex);
  const seq = Number(row?.next_seq ?? 0) + 1;
  await ex.query("UPDATE bank_transfer_reference_seq SET next_seq = ? WHERE `year` = ?", [seq, year]);
  return formatBankTransferReference(year, seq);
}
