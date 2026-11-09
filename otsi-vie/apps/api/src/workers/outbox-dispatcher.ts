/**
 * Process entry for the `outbox-dispatcher` worker (DEPLOYMENT_OPERATIONS.md). Runs with the least-privilege runtime account; any
 * number of copies may run at once (claims never overlap). SIGINT / SIGTERM stop polling and let the current batch settle.
 */
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { loadWorkerConfig } from "../core/config";
import { Db } from "../core/db";
import { OutboxDispatcher } from "../core/outbox/dispatcher";
import { productionSubscribers } from "../core/outbox/subscribers";

async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  const db = new Db(cfg);
  const dispatcher = new OutboxDispatcher(db, productionSubscribers(db));
  const log = new Logger("outbox-dispatcher");
  dispatcher.start(cfg.pollMs);
  log.log(`started as ${dispatcher.opts.workerId}, polling every ${cfg.pollMs} ms`);
  const shutdown = async () => {
    await dispatcher.stop();
    await db.onModuleDestroy();
    log.log("stopped");
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main();
