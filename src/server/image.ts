/**
 * Everything this app knows about pixels: which inputs it accepts, how it guards memory, and the one
 * encoding policy (long-edge cap, quality, animated GIF -> animated WebP). The hub calls a single
 * function; sharp does not appear anywhere else.
 *
 * Invariants of the output:
 * - Always WebP produced by our encoder. User bytes are never stored or served as-is, which rules
 *   out polyglot files and content-type confusion on the public path.
 * - Metadata stripped (sharp's default; we never call keepMetadata/withMetadata): EXIF GPS from phone
 *   photos never becomes public. Colour is converted to sRGB before the profile is dropped.
 * - Long edge <= maxDimension; never upscaled.
 * - Animated GIF/WebP input stays animated, frame delays and loop count preserved.
 */

import sharp, { type Metadata } from "sharp";

import { HubError } from "./errors";

// The server never re-reads the same input; the libvips operation cache would only hold memory.
sharp.cache(false);

export type InputFormat = "jpeg" | "png" | "webp" | "gif" | "avif" | "tiff";

/**
 * Detected from the bytes by sharp, never from the file name or Content-Type.
 * Rejected on purpose: SVG (script and external references; also vector, so "long edge" is
 * meaningless), HEIC (prebuilt libvips has no HEVC decoder), PDF, RAW.
 */
export const ACCEPTED_FORMATS: readonly InputFormat[] = ["jpeg", "png", "webp", "gif", "avif", "tiff"];

/** For `<input accept>` and the Drive Picker mime filter. Advisory; the sniff above decides. */
export const ACCEPTED_MIME_TYPES = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/tiff";

/**
 * Transcodes allowed at once per process; later calls wait. With the default pixel cap this bounds
 * peak decode memory near 0.8 GB, which is why the Cloud Run quickstart asks for 2 GiB.
 */
export const TRANSCODE_CONCURRENCY = 2;

export interface TranscodePolicy {
  /** Long-edge cap in px. */
  readonly maxDimension: number;
  /** WebP quality 1..100. */
  readonly quality: number;
  /**
   * Decoded pixels allowed per upload, all frames counted. A 20 MB file can declare 50000x50000
   * pixels; this cap turns such a pixel bomb into `too_many_pixels` before decoding.
   */
  readonly maxInputPixels: number;
}

export interface Transcoded {
  readonly webp: Uint8Array;
  readonly width: number;
  /** Per frame. */
  readonly height: number;
  readonly frames: number;
  readonly inputFormat: InputFormat;
}

/**
 * Throws HubError with:
 * - `unsupported_format` for a recognised but rejected format, or bytes that are not an image;
 * - `too_many_pixels` when width x frameHeight x frames > maxInputPixels;
 * - `corrupt_image` when decoding fails part-way (truncated file).
 */
export type Transcoder = (input: Uint8Array) => Promise<Transcoded>;

export function createTranscoder(policy: TranscodePolicy): Transcoder {
  const acquire = semaphore(TRANSCODE_CONCURRENCY);
  return async (input) => {
    const release = await acquire();
    try {
      return await transcode(input, policy);
    } finally {
      release();
    }
  };
}

async function transcode(input: Uint8Array, policy: TranscodePolicy): Promise<Transcoded> {
  const meta = await readMetadata(input);
  const inputFormat = acceptedFormat(meta);
  if (inputFormat === null) throw new HubError("unsupported_format", { format: formatName(meta) });

  const frames = meta.pages ?? 1;
  // A multi-page TIFF is a document, not an animation: only its first page is kept.
  const animated = (inputFormat === "gif" || inputFormat === "webp") && frames > 1;
  const frameHeight = meta.pageHeight ?? meta.height;
  if (meta.width * frameHeight * (animated ? frames : 1) > policy.maxInputPixels) {
    throw new HubError("too_many_pixels", { maxPixels: policy.maxInputPixels });
  }

  try {
    const { data, info } = await sharp(input, {
      animated,
      autoOrient: !animated,
      limitInputPixels: policy.maxInputPixels,
      failOn: "error",
    })
      .resize({ width: policy.maxDimension, height: policy.maxDimension, fit: "inside", withoutEnlargement: true })
      .webp({ quality: policy.quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return {
      webp: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.pageHeight ?? info.height,
      frames: animated ? frames : 1,
      inputFormat,
    };
  } catch (error) {
    throw new HubError("corrupt_image", undefined, { cause: error });
  }
}

async function readMetadata(input: Uint8Array): Promise<Metadata> {
  try {
    return await sharp(input).metadata();
  } catch (error) {
    throw new HubError("unsupported_format", undefined, { cause: error });
  }
}

function acceptedFormat(meta: Metadata): InputFormat | null {
  if (meta.format === "heif") return meta.compression === "av1" ? "avif" : null;
  return ACCEPTED_FORMATS.find((f) => f === meta.format) ?? null;
}

function formatName(meta: Metadata): string {
  return meta.format === "heif" && meta.compression === "hevc" ? "heic" : meta.format;
}

function semaphore(limit: number): () => Promise<() => void> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next();
  };
  return async () => {
    if (active < limit) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  };
}
