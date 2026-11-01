import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { HttpError } from './http.js';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
const MAX_INPUT_PIXELS = 40_000_000;

export interface StoredImage {
  filename: string;
  thumb: string;
  width: number;
  height: number;
  color: string;
}

/**
 * Uploads are never stored as received: everything is decoded and re-encoded to
 * WebP, which drops EXIF (including GPS) and anything hidden in the file. The
 * filename is random, so it can't be chosen by the client.
 */
export async function storeImage(input: Buffer, uploadDir: string): Promise<StoredImage> {
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
  try {
    const meta = await open().metadata();
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new Error('format');

    const full = await open()
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const { dominant } = await sharp(full.data).stats();
    const hex = (n: number) => n.toString(16).padStart(2, '0');

    const id = randomBytes(16).toString('hex');
    const filename = `${id}.webp`;
    const thumbName = `${id}_t.webp`;
    await writeFile(join(uploadDir, filename), full.data);
    await writeFile(join(uploadDir, thumbName), thumb);

    return {
      filename,
      thumb: thumbName,
      width: full.info.width,
      height: full.info.height,
      color: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
    };
  } catch {
    throw new HttpError(400, 'Это не похоже на картинку. Подойдут JPEG, PNG, WebP или GIF');
  }
}
