import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { animatedGif, orientedJpeg, photoPng, solidPng } from "../../test/fixtures";
import { createTranscoder } from "./image";

const transcode = createTranscoder({ maxDimension: 1024, quality: 80, maxInputPixels: 100_000_000 });

describe("transcoder", () => {
  it("caps a large PNG to 1024 on the long edge and shrinks it", async () => {
    const png = await photoPng(3000, 2000);
    const out = await transcode(png);
    expect([out.width, out.height]).toEqual([1024, 683]);
    expect(out.inputFormat).toBe("png");
    expect(out.frames).toBe(1);
    expect(out.webp.byteLength).toBeLessThan(png.byteLength);
    const meta = await sharp(out.webp).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1024, 683]);
  });

  it("never enlarges a small image", async () => {
    const out = await transcode(await solidPng(200, 100));
    expect([out.width, out.height]).toEqual([200, 100]);
  });

  it("applies EXIF orientation 6, which swaps width and height, then drops the EXIF", async () => {
    const out = await transcode(await orientedJpeg(300, 100, 6));
    expect([out.width, out.height]).toEqual([100, 300]);
    const meta = await sharp(out.webp).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("keeps an animated GIF animated, with its frame count, delays and loop", async () => {
    const out = await transcode(await animatedGif(1600, 400, 4));
    expect(out.frames).toBe(4);
    expect([out.width, out.height]).toEqual([1024, 256]);
    const meta = await sharp(out.webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.pages).toBe(4);
    expect(meta.delay).toEqual([120, 120, 120, 120]);
    expect(meta.loop).toBe(0);
  });

  it("rejects bytes that are not an image", async () => {
    await expect(transcode(new TextEncoder().encode("definitely not an image"))).rejects.toMatchObject({
      code: "unsupported_format",
    });
  });

  it("rejects SVG by content", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expect(transcode(svg)).rejects.toMatchObject({ code: "unsupported_format", detail: { format: "svg" } });
  });

  it("refuses more decoded pixels than the policy allows, counting every frame", async () => {
    const tight = createTranscoder({ maxDimension: 1024, quality: 80, maxInputPixels: 100 * 100 * 3 });
    await expect(tight(await animatedGif(100, 100, 4))).rejects.toMatchObject({ code: "too_many_pixels" });
    await expect(tight(await solidPng(100, 100))).resolves.toMatchObject({ width: 100 });
  });

  it("reports a truncated file as corrupt", async () => {
    const png = await photoPng(400, 300);
    await expect(transcode(png.subarray(0, Math.floor(png.byteLength / 2)))).rejects.toMatchObject({ code: "corrupt_image" });
  });
});
