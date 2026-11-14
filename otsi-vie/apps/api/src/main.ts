import "./ensure-contracts"; // FIRST: install the vendored @otsi-vie/contracts into node_modules if the postinstall missed them (cPanel runs it with the wrong cwd). Must run before any import of the contracts.
import { loadConfig } from "./core/config";
import { createApp } from "./app";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await createApp(cfg);
  await app.listen(cfg.port, "127.0.0.1");      // local development binds to this machine only; deployment sets its own ingress
}

void main();
