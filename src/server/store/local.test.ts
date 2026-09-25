import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Logger } from "../log";
import { createLocalStore } from "./local";

const quiet: Logger = { log() {} };

describe("local store startup", () => {
  it("refuses a DATA_DIR it cannot use, naming it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "wih-"));
    const file = join(parent, "not-a-dir");
    await writeFile(file, "x");
    await expect(createLocalStore({ dataDir: file, log: quiet })).rejects.toThrow(/DATA_DIR .*not-a-dir.* is not usable/u);
  });

  it("empties tmp/ left behind by a crash", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "wih-"));
    await mkdir(join(dataDir, "tmp"));
    await writeFile(join(dataDir, "tmp", "half-written"), "x");
    await createLocalStore({ dataDir, log: quiet });
    expect(await readdir(join(dataDir, "tmp"))).toEqual([]);
  });
});
