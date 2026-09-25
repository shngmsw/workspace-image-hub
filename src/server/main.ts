/**
 * Production process entry (`node dist/server/main.js`): parse env, compose, listen, drain on
 * SIGTERM. Nothing else.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { composeApp } from "./compose";
import { type Config, ConfigError, loadConfig } from "./config";
import { jsonLogger as log } from "./log";

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      log.log("ERROR", error.message, { issues: error.issues });
      process.exit(78); // EX_CONFIG: restart loops won't fix a bad .env
    }
    throw error;
  }
  for (const warning of config.warnings) log.log("WARNING", warning);

  const clientDir = fileURLToPath(new URL("../client/", import.meta.url));
  const app = await composeApp(config, log, {
    shellTemplate: await readFile(`${clientDir}index.html`, "utf8"),
    clientDir,
  });

  const server = serve({ fetch: app.fetch, port: config.port });
  log.log("INFO", "listening", {
    port: config.port,
    appUrl: config.appUrl.origin,
    storage: config.storage.driver,
    publicBaseUrl: config.publicBaseUrl,
    drive: config.drive !== null,
  });

  // Cloud Run sends SIGTERM and allows 10 s: stop accepting, let in-flight uploads finish.
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch((error: unknown) => {
  log.log("ERROR", "startup failed", { error: String(error) });
  process.exit(1);
});
