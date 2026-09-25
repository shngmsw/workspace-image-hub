import { describe, expect, it } from "vitest";

import { ENV_VARS, loadConfig } from "../src/server/config";
import { expectedFiles, renderEnvExample, renderEnvTable } from "./gen-env-docs";

describe("generated env docs", () => {
  it("mention every variable, and .env.example with its blanks filled is a valid config", () => {
    const example = renderEnvExample();
    for (const { name } of ENV_VARS) expect(example).toContain(`${name}=`);
    const env = Object.fromEntries(
      example
        .split("\n")
        .filter((line) => /^[A-Z_]+=/u.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    expect(Object.keys(env)).toEqual(["APP_URL", "AUTH_SECRET", "GOOGLE_CLIENT_ID", "ALLOWED_DOMAINS"]);
    const config = loadConfig({ ...env, AUTH_SECRET: "x".repeat(32), GOOGLE_CLIENT_ID: "1-a.apps.googleusercontent.com", ALLOWED_DOMAINS: "example.com" });
    expect(config.appUrl.origin).toBe("http://localhost:3000");
  });

  it("render one table row per variable in both languages", () => {
    for (const locale of ["en", "ja"] as const) {
      expect(renderEnvTable(locale).split("\n").filter((l) => l.startsWith("| `"))).toHaveLength(ENV_VARS.length);
    }
  });

  it("replace only the marked region of a README", () => {
    const readme = "# Title\n\n<!-- env:start -->\nold\n<!-- env:end -->\n\nMore.\n";
    const files = expectedFiles((path) => (path === "README.md" ? readme : null));
    const updated = files.find((f) => f.path === "README.md")?.content ?? "";
    expect(updated.startsWith("# Title\n\n<!-- env:start -->\n")).toBe(true);
    expect(updated.endsWith("<!-- env:end -->\n\nMore.\n")).toBe(true);
    expect(updated).toContain("| `APP_URL` |");
    expect(files.map((f) => f.path)).toEqual([".env.example", "README.md"]);
  });
});
