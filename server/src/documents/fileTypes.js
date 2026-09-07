import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileTypeFromFile } from 'file-type';
import { AppError } from '../errors.js';

export const DOCUMENT_CATEGORIES = new Set(['policy', 'product', 'sales_tool', 'training', 'other']);
export const PREVIEW_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'zip']);

const detectedTypesByExtension = new Map([
  ['pdf', new Set(['pdf'])],
  ['docx', new Set(['docx'])],
  ['xlsx', new Set(['xlsx'])],
  ['pptx', new Set(['pptx'])],
  ['jpg', new Set(['jpg'])],
  ['jpeg', new Set(['jpg'])],
  ['png', new Set(['png'])],
  ['gif', new Set(['gif'])],
  ['webp', new Set(['webp'])],
  ['zip', new Set(['zip'])]
]);

const normalizedMimeByExtension = new Map([
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['txt', 'text/plain'],
  ['zip', 'application/zip']
]);

const legacyOfficeMimeTypes = new Map([
  ['doc', new Set(['application/msword', 'application/vnd.ms-word', 'application/octet-stream', 'application/x-cfb'])],
  ['xls', new Set(['application/vnd.ms-excel', 'application/msexcel', 'application/x-msexcel', 'application/octet-stream', 'application/x-cfb'])],
  ['ppt', new Set(['application/vnd.ms-powerpoint', 'application/mspowerpoint', 'application/x-mspowerpoint', 'application/octet-stream', 'application/x-cfb'])]
]);

const cfbMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const dangerousTextInnerExtensions = new Set([
  'bat', 'bash', 'cmd', 'com', 'command', 'cpl', 'exe', 'fish', 'hta', 'jar',
  'js', 'jse', 'lnk', 'msi', 'php', 'pl', 'ps1', 'psd1', 'psm1', 'py', 'rb',
  'reg', 'scr', 'sh', 'vbe', 'vbs', 'wsf', 'wsh', 'zsh'
]);

export function validateCategory(value) {
  const category = String(value || '').trim();
  if (!DOCUMENT_CATEGORIES.has(category)) throw new AppError(400, 'INVALID_CATEGORY', '请选择正确的资料分类');
  return category;
}

export function validateDescription(value) {
  const description = String(value || '').trim();
  if (description.length > 500) throw new AppError(400, 'VALIDATION_ERROR', '资料说明不能超过 500 字');
  return description;
}

function invalidFile() {
  return new AppError(400, 'INVALID_FILE_TYPE', '文件内容与扩展名不一致');
}

async function readMetadata(filePath, { validateText = false } = {}) {
  const hash = createHash('sha256');
  const decoder = validateText ? new TextDecoder('utf-8', { fatal: true }) : null;
  let sizeBytes = 0;
  let firstBytes = Buffer.alloc(0);

  try {
    for await (const chunk of createReadStream(filePath)) {
      sizeBytes += chunk.length;
      hash.update(chunk);
      if (firstBytes.length < cfbMagic.length) {
        firstBytes = Buffer.concat([firstBytes, chunk.subarray(0, cfbMagic.length - firstBytes.length)]);
      }
      if (decoder) {
        if (chunk.includes(0)) throw invalidFile();
        decoder.decode(chunk, { stream: true });
      }
    }
    if (decoder) decoder.decode();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (validateText && error instanceof TypeError) throw invalidFile();
    throw error;
  }

  return {
    sha256: hash.digest('hex'),
    sizeBytes,
    hasCfbMagic: firstBytes.equals(cfbMagic)
  };
}

export async function inspectDocumentFile({ path: filePath, originalName, reportedMime }) {
  const originalBaseName = path.basename(String(originalName || '')).toLowerCase();
  const extension = path.extname(originalBaseName).slice(1);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new AppError(400, 'UNSUPPORTED_FILE_TYPE', '不支持该文件格式');
  }
  if (extension === 'txt') {
    const nameWithoutTextExtension = originalBaseName.slice(0, -'.txt'.length);
    const innerExtension = path.extname(nameWithoutTextExtension).slice(1);
    if (dangerousTextInnerExtensions.has(innerExtension)) throw invalidFile();
  }

  const metadata = await readMetadata(filePath, { validateText: extension === 'txt' });
  let detected;
  try {
    detected = await fileTypeFromFile(filePath);
  } catch (error) {
    if (!metadata.hasCfbMagic) throw error;
  }

  if (extension === 'txt') {
    if (detected) throw invalidFile();
  } else if (legacyOfficeMimeTypes.has(extension)) {
    const mime = String(reportedMime || '').toLowerCase();
    if (!metadata.hasCfbMagic || !legacyOfficeMimeTypes.get(extension).has(mime)) throw invalidFile();
  } else if (!detectedTypesByExtension.get(extension)?.has(detected?.ext)) {
    throw invalidFile();
  }

  const mimeType = normalizedMimeByExtension.get(extension);
  return {
    extension,
    mimeType,
    previewable: PREVIEW_MIME_TYPES.has(mimeType),
    sha256: metadata.sha256,
    sizeBytes: metadata.sizeBytes
  };
}
