/**
 * Server error types. app.ts turns both into `ErrorBody` + status; anything else that escapes is a
 * bug and becomes `internal` (500) with the cause logged, never echoed.
 *
 * The split is a type guarantee: the core (hub, stores, transcoder) throws `HubError`, whose code is
 * a `DomainErrorCode`, so it cannot claim a transport failure such as `cross_origin`. The HTTP
 * shell and auth throw `HttpError` with a `TransportErrorCode` (shared/api.ts).
 */

import type { ErrorCode, TransportErrorCode } from "../shared/api";

/** Failures the core can report about an asset operation. */
export type DomainErrorCode =
  | "forbidden"
  | "not_found"
  | "unsupported_format"
  | "too_many_pixels"
  | "corrupt_image"
  | "storage_unavailable";

export type ErrorDetail = Readonly<Record<string, string | number>>;

export class HubError extends Error {
  readonly code: DomainErrorCode;
  readonly detail: ErrorDetail | undefined;

  constructor(code: DomainErrorCode, detail?: ErrorDetail, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "HubError";
    this.code = code;
    this.detail = detail;
  }
}

export class HttpError extends Error {
  readonly code: TransportErrorCode;
  readonly detail: ErrorDetail | undefined;

  constructor(code: TransportErrorCode, detail?: ErrorDetail) {
    super(code);
    this.name = "HttpError";
    this.code = code;
    this.detail = detail;
  }
}

const STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  cross_origin: 403,
  not_found: 404,
  invalid_input: 400,
  too_large: 413,
  unsupported_format: 415,
  too_many_pixels: 422,
  corrupt_image: 422,
  storage_unavailable: 503,
  internal: 500,
};

export function httpStatusOf(code: ErrorCode): number {
  return STATUS[code];
}
