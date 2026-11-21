import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export interface OptimizeImageOptions {
  maxWidth?: number;
  maxThumbWidth?: number;
  thumbQuality?: number;
}

/**
 * Optimizes an image buffer by creating a lightweight WebP thumbnail (30-50KB)
 * and saving both the original file and thumbnail into target directory.
 */
export async function optimizeAndSaveImage(
  buffer: Buffer,
  destDir: string,
  baseFilename: string,
  options?: OptimizeImageOptions
): Promise<{
  originalFilename: string;
  thumbFilename: string;
  originalPath: string;
  thumbPath: string;
  width?: number;
  height?: number;
}> {
  // Ensure destination directory exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const ext = path.extname(baseFilename).toLowerCase();
  const nameWithoutExt = path.basename(baseFilename, ext);
  const originalFilename = `${nameWithoutExt}${ext || '.jpg'}`;
  const thumbFilename = `${nameWithoutExt}_thumb.webp`;

  const originalFullPath = path.join(destDir, originalFilename);
  const thumbFullPath = path.join(destDir, thumbFilename);

  // Write original file
  await fs.promises.writeFile(originalFullPath, buffer);

  const thumbWidth = options?.maxThumbWidth || 480;
  const thumbQuality = options?.thumbQuality || 75;

  try {
    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default || sharpModule;
    const metadata = await sharp(buffer).metadata();

    // Create lightweight WebP thumbnail (width 480px, quality 75 -> ~30-50KB)
    await sharp(buffer)
      .resize({ width: thumbWidth, withoutEnlargement: true })
      .webp({ quality: thumbQuality, effort: 4 })
      .toFile(thumbFullPath);

    return {
      originalFilename,
      thumbFilename,
      originalPath: originalFullPath,
      thumbPath: thumbFullPath,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (err: any) {
    logger.warn(`[image-optimizer] Thumbnail creation fallback: ${err?.message || err}`);
    return {
      originalFilename,
      thumbFilename: originalFilename,
      originalPath: originalFullPath,
      thumbPath: originalFullPath,
    };
  }
}
