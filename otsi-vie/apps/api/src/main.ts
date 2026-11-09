import { loadConfig } from "./core/config";
import { createApp } from "./app";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await createApp(cfg);
  await app.listen(cfg.port, "127.0.0.1");      // local development binds to this machine only; deployment sets its own ingress
}

void main();
