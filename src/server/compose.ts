import type { Hono } from "hono";

import { createApp } from "./app";
import { type Auth, createAuth } from "./auth";
import type { Config } from "./config";
import { createHub } from "./hub";
import { createTranscoder } from "./image";
import type { Logger } from "./log";
import { createGcsStore } from "./store/gcs";
import { createLocalStore } from "./store/local";
import type { AssetStore } from "./store/store";

export interface ShellFiles {
  readonly shellTemplate: string;
  readonly clientDir: string;
}

export interface ComposeOverrides {
  readonly auth?: Auth;
  readonly devMode?: boolean;
}

export async function composeApp(config: Config, log: Logger, shell: ShellFiles, overrides: ComposeOverrides = {}): Promise<Hono> {
  const store: AssetStore =
    config.storage.driver === "local"
      ? await createLocalStore({ dataDir: config.storage.dataDir, log })
      : await createGcsStore({ bucket: config.storage.bucket, publicBucket: config.storage.publicBucket, log });

  return createApp({
    config,
    auth: overrides.auth ?? createAuth(config, log),
    hub: createHub({ store, transcode: createTranscoder(config.image), publicBaseUrl: config.publicBaseUrl, log }),
    store,
    log,
    shellTemplate: shell.shellTemplate,
    clientDir: shell.clientDir,
    devMode: overrides.devMode === true,
  });
}
