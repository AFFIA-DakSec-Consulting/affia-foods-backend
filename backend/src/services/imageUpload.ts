import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Restaurant images (Docs/24): logo and cover photo uploaded as raw bytes.
 * Files go to `public/uploads/vendors/` (served under /static, see index.ts). Point UPLOAD_DIR at a mounted volume in production.
 * The type is decided from the file's first bytes, never from the name or the header the client sent; SVG is refused (it can carry scripts).
 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export type ImageKind = 'logo' | 'banner';
export const IMAGE_KINDS: readonly ImageKind[] = ['logo', 'banner'];

export const uploadRoot = (): string => process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'public', 'uploads');
const vendorDir = () => path.join(uploadRoot(), 'vendors');

/** "png" | "jpg" | "webp" from the magic bytes, or null when the file is not one of the three accepted images. */
export const sniffImage = (buf: Buffer): 'png' | 'jpg' | 'webp' | null => {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
};

export type SaveResult = { ok: true; file: string } | { ok: false; status: number; message: string };

/** Stores the image and returns its file name (relative to /static/uploads/vendors/). */
export const saveVendorImage = async (vendorId: string, kind: ImageKind, buf: unknown): Promise<SaveResult> => {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, status: 415, message: 'Send the image as the request body with Content-Type image/png, image/jpeg or image/webp.' };
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, status: 413, message: `The image is too big (up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB).` };
  const ext = sniffImage(buf);
  if (!ext) return { ok: false, status: 415, message: 'Only PNG, JPEG or WebP images are accepted.' };
  const safeId = vendorId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60);
  const file = `${safeId}-${kind}-${randomBytes(6).toString('hex')}.${ext}`;
  await fs.mkdir(vendorDir(), { recursive: true });
  await fs.writeFile(path.join(vendorDir(), file), buf, { flag: 'wx' });
  return { ok: true, file };
};

/** The public address of a stored file. */
export const uploadUrl = (origin: string, file: string): string => `${origin.replace(/\/$/, '')}/static/uploads/vendors/${file}`;

/** Deletes a previously uploaded file when `url` is one of ours (never touches anything else). Best effort. */
export const removeUploadedByUrl = async (url: string | null | undefined): Promise<void> => {
  const m = typeof url === 'string' ? /\/static\/uploads\/vendors\/([A-Za-z0-9-]+\.(?:png|jpg|webp))$/.exec(url) : null;
  if (!m) return;
  try { await fs.unlink(path.join(vendorDir(), m[1])); } catch { /* already gone */ }
};
