import { mkdir, writeFile, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { nanoid } from 'nanoid';
import { config } from '../config/index.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip',
  'application/x-rar-compressed',
]);

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

/**
 * Sanitize filename: remove special chars, keep extension
 */
function sanitizeFilename(original: string): string {
  const ext = extname(original);
  const name = original
    .replace(ext, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50);
  return `${nanoid(12)}_${name}${ext}`;
}

export async function saveFile(
  buffer: Buffer,
  originalName: string,
  ticketId: string,
): Promise<{ fileName: string; filePath: string; fileSize: number }> {
  const dir = join(config.UPLOAD_DIR, ticketId);
  await mkdir(dir, { recursive: true });

  const fileName = sanitizeFilename(originalName);
  const filePath = join(dir, fileName);

  await writeFile(filePath, buffer);

  return {
    fileName: originalName,
    filePath: `${ticketId}/${fileName}`,
    fileSize: buffer.length,
  };
}

const ALLOWED_LOGO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);

export function isAllowedLogoMimeType(mimeType: string): boolean {
  return ALLOWED_LOGO_MIME.has(mimeType);
}

export async function saveLogo(
  buffer: Buffer,
  originalName: string,
  companyId: string,
): Promise<{ url: string; filePath: string }> {
  const dir = join(config.UPLOAD_DIR, 'branding', companyId);
  await mkdir(dir, { recursive: true });

  const fileName = sanitizeFilename(originalName);
  const filePath = join(dir, fileName);
  await writeFile(filePath, buffer);

  return {
    url: `/uploads/branding/${companyId}/${fileName}`,
    filePath: `branding/${companyId}/${fileName}`,
  };
}

export async function deleteFile(filePath: string): Promise<void> {
  const fullPath = join(config.UPLOAD_DIR, filePath);
  try {
    await unlink(fullPath);
  } catch {
    // file may not exist
  }
}
