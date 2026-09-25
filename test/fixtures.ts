import sharp from "sharp";

const bytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(buffer);

export async function photoPng(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const seed = await sharp({
    create: {
      width: Math.ceil(width / 12),
      height: Math.ceil(height / 12),
      channels: 3,
      background: "#000",
      noise: { type: "gaussian", mean: 128, sigma: 70 },
    },
  })
    .png()
    .toBuffer();
  return bytes(await sharp(seed).resize(width, height, { kernel: "cubic" }).png().toBuffer());
}

export async function solidPng(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  return bytes(await sharp({ create: { width, height, channels: 3, background: "#3a7" } }).png().toBuffer());
}

export async function animatedGif(width: number, frameHeight: number, frames: number): Promise<Uint8Array<ArrayBuffer>> {
  const colours = ["#e33", "#3e3", "#33e", "#ee3", "#3ee", "#e3e"];
  const pages = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({ create: { width, height: frameHeight, channels: 3, background: colours[i % colours.length] ?? "#000" } })
        .png()
        .toBuffer(),
    ),
  );
  return bytes(
    await sharp(pages, { join: { animated: true } })
      .gif({ delay: Array.from({ length: frames }, () => 120), loop: 0 })
      .toBuffer(),
  );
}

/** EXIF orientation 6 means "rotate 90° clockwise to display", so the displayed image is height x width. */
export async function orientedJpeg(width: number, height: number, orientation: number): Promise<Uint8Array<ArrayBuffer>> {
  return bytes(
    await sharp({ create: { width, height, channels: 3, background: "#888" } })
      .jpeg()
      .withMetadata({ orientation })
      .toBuffer(),
  );
}
