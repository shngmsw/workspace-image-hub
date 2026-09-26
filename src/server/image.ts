import sharp, { type Metadata } from "sharp";

import { TRANSCODE_CONCURRENCY } from "../shared/api";
import type { PixelSize } from "../shared/domain";
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

export const ACCEPTED_MIME_TYPES = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/tiff";

export interface TranscodePolicy {
  readonly maxDimension: number;
  readonly quality: number;
  readonly maxInputPixels: number;
}

export interface Transcoded {
  readonly webp: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly originalSize: PixelSize;
  readonly frames: number;
  readonly inputFormat: InputFormat;
}

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
  // Animated input is not auto-oriented below, so its original size must not be either.
  const originalSize = animated
    ? { width: meta.width, height: frameHeight }
    : { width: meta.autoOrient.width, height: meta.autoOrient.height };

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
      originalSize,
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
    return release;
  };
}
