import { createHash } from "node:crypto";

/**
 * Per-barber GCash/Maya QR images (slice 6). Display only: a QR is never part of a sale.
 * Images live only in the database and the phones' IndexedDB cache. Never log the bytes
 * or a Prisma error message for these rows (it can echo the arguments, image included).
 */

export const QR_METHODS = ["GCASH", "MAYA"] as const;
export type QrMethod = (typeof QR_METHODS)[number];

/** 1 MB. A phone screenshot of a QR is far below this. */
export const MAX_QR_BYTES = 1024 * 1024;

export type QrContentType = "image/png" | "image/jpeg" | "image/webp";

export function parseQrMethod(value: string): QrMethod | null {
  return (QR_METHODS as readonly string[]).includes(value) ? (value as QrMethod) : null;
}

/**
 * The image type from the file's own signature, never from the client's Content-Type.
 * PNG, JPEG and WebP only; SVG and everything else is refused (SVG can carry scripts).
 */
export function detectImageType(bytes: Uint8Array): QrContentType | null {
  const starts = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" <size> "WEBP"
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** For logs: the error's class and Prisma code only, never its message. */
export function describeError(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return typeof code === "string" ? `${name} ${code}` : name;
}
