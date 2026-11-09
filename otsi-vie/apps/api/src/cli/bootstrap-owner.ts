/**
 * Create the first organization and its OWNER on a fresh installation.
 *   node dist/cli/bootstrap-owner.js --email you@example.com --name "Your Name" --organization "Your Club" [--additional-organization]
 * The password is read from OTSI_VIE_BOOTSTRAP_PASSWORD, or asked for on the terminal (not echoed). It is never written anywhere.
 */
import "reflect-metadata";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { loadWorkerConfig } from "../core/config";
import { Db } from "../core/db";
import { bootstrapOwner } from "../modules/auth/bootstrap";

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => { if (s.includes(prompt)) out.output.write(prompt); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, organization: { type: "string" }, "additional-organization": { type: "boolean", default: false } },
  });
  if (!values.email || !values.name || !values.organization) {
    console.error('usage: bootstrap-owner --email you@example.com --name "Your Name" --organization "Your Club"');
    process.exit(2);
  }
  let password = process.env.OTSI_VIE_BOOTSTRAP_PASSWORD ?? "";
  if (!password) {
    password = await askHidden("Password (at least 12 characters): ");
    if ((await askHidden("Repeat the password: ")) !== password) { console.error("the passwords differ"); process.exit(2); }
  }
  const db = new Db(loadWorkerConfig());
  try {
    const r = await bootstrapOwner(db, { email: values.email, displayName: values.name, organizationName: values.organization, password, allowAdditional: values["additional-organization"] });
    console.log(`created organization ${r.organizationId} with owner ${values.email}. Sign in at the web app.`);
  } catch (e) {
    console.error(`not created: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await db.onModuleDestroy();
  }
}

void main();
