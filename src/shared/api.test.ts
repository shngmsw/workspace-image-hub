import { describe, expect, it } from "vitest";

import { encodeUploadMeta, parseSignInRequest, parseUpdateAssetBody, parseUploadMeta } from "./api";

describe("X-Upload-Meta", () => {
  it("round-trips Japanese names and tags through a header-safe encoding", () => {
    const header = encodeUploadMeta({ filename: "C:\\写真\\ロゴ 最終.png", source: "drive", tags: ["営業部", "ChatIcon"] });
    expect(header).toMatch(/^[\w-]+$/u);
    expect(parseUploadMeta(header)).toEqual({
      ok: true,
      value: { originalName: "ロゴ 最終.png", source: "drive", tags: ["営業部", "ChatIcon"] },
    });
  });

  it("refuses a missing, non-base64url, non-JSON or unexpected payload", () => {
    const encode = (json: string) => Buffer.from(json).toString("base64url");
    expect(parseUploadMeta(undefined)).toEqual({ ok: false, issue: "body_malformed" });
    expect(parseUploadMeta("not base64!")).toEqual({ ok: false, issue: "body_malformed" });
    expect(parseUploadMeta(encode("{"))).toEqual({ ok: false, issue: "body_malformed" });
    expect(parseUploadMeta(encode('{"filename":"a","source":"upload","tags":[],"extra":1}'))).toEqual({ ok: false, issue: "body_malformed" });
    expect(parseUploadMeta(encode('{"filename":"a","source":"ftp","tags":[]}'))).toEqual({ ok: false, issue: "source_unknown" });
    expect(parseUploadMeta(encode('{"filename":"a","source":"upload","tags":["a#b"]}'))).toEqual({ ok: false, issue: "tag_forbidden_char" });
  });
});

describe("PATCH body", () => {
  it("accepts exactly {tags}", () => {
    expect(parseUpdateAssetBody({ tags: ["a", "A"] })).toEqual({ ok: true, value: { tags: ["a"] } });
    expect(parseUpdateAssetBody({ tags: [] })).toEqual({ ok: true, value: { tags: [] } });
    expect(parseUpdateAssetBody({ title: "x", tags: [] }).ok).toBe(false);
    expect(parseUpdateAssetBody({}).ok).toBe(false);
    expect(parseUpdateAssetBody(null).ok).toBe(false);
  });
});

describe("sign-in body", () => {
  it("accepts one JWT-shaped credential", () => {
    expect(parseSignInRequest({ credential: "aaa.bbb.ccc" })).toBe("aaa.bbb.ccc");
    expect(parseSignInRequest({ credential: "aaa.bbb" })).toBeNull();
    expect(parseSignInRequest({ credential: "aaa.bbb.ccc", other: 1 })).toBeNull();
    expect(parseSignInRequest("aaa.bbb.ccc")).toBeNull();
  });
});
