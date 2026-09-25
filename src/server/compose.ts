/**
 * Composition root: the only place that knows which store driver exists and how the modules are
 * wired. Everything else sees `AssetStore`, `Hub`, `Auth`. Shared by the production entry
 * (main.ts) and the dev entry (dev.ts) so the two cannot drift.
 */

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
  /** Built `index.html` containing the `<!--wih-boot-->` placeholder. */
  readonly shellTemplate: string;
  /** Directory of the built client (`dist/client`); `/static/*` is served from it. */
  readonly clientDir: string;
}

export interface ComposeOverrides {
  /** dev.ts only: a fake Auth for contributors without an OAuth client. Never set in main.ts. */
  readonly auth?: Auth;
  /** dev.ts only: the Vite dev server shell. */
  readonly devMode?: boolean;
}

/**
 * Builds the store (which probes its backend: DATA_DIR writable + hard links, or both buckets
 * reachable), then the hub and the HTTP app. Rejects if the probe fails, so a misconfigured deploy
 * fails its first health check instead of its first upload.
 */
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
