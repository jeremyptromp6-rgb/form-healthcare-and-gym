import { HttpError } from "../../http/errors";

/**
 * Profile photo sanitizing. Photos can carry EXIF GPS coordinates, device serials and
 * timestamps, so every upload is stripped of metadata before it is stored. Only JPEG and
 * PNG are accepted, and the bytes must match the declared type.
 */

export const MAX_PHOTO_BYTES = 1_000_000;
export type PhotoMime = "image/jpeg" | "image/png";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function invalid(message = "The image could not be read"): HttpError {
  return new HttpError(422, "invalid_image", message);
}

export function sniffMime(buf: Buffer): PhotoMime | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  return null;
}

/** Keeps APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform); drops every other APPn and comments. */
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw invalid();
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw invalid();
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      out.push(buf.subarray(i, i + 2));
      return Buffer.concat(out);
    }
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded image data through EOI.
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    if (i + 4 > buf.length) throw invalid();
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw invalid();
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !(isApp && marker !== 0xe0 && marker !== 0xe2 && marker !== 0xee) && marker !== 0xfe;
    if (keep) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw invalid();
}

const PNG_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

export function stripPngMetadata(buf: Buffer): Buffer {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw invalid();
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + len;
    if (end > buf.length) throw invalid();
    if (!PNG_METADATA_CHUNKS.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") return Buffer.concat(out);
  }
  throw invalid();
}

export function sanitizePhoto(declared: PhotoMime, base64: string, maxBytes: number = MAX_PHOTO_BYTES): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw invalid("Image data must be base64");
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw invalid();
  if (buf.length > maxBytes) throw new HttpError(413, "image_too_large", `Photos must be under ${Math.round(maxBytes / 1_000_000)} MB`);
  const actual = sniffMime(buf);
  if (actual !== declared) throw invalid("The file isn't the image type it claims to be");
  return actual === "image/jpeg" ? stripJpegMetadata(buf) : stripPngMetadata(buf);
}
