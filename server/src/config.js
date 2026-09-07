import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

export function resolveDataPath(filename = process.env.DB_FILE || 'customer-erp.sqlite') {
  const dataDir = path.resolve(projectRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.isAbsolute(filename) ? filename : path.join(dataDir, filename);
}

export function resolveUploadPath(input = process.env.UPLOAD_DIR || 'data/uploads') {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(projectRoot, input);
}

export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;

export function validateUploadLimits({ maxUploadFileBytes, maxUploadFiles }) {
  if (!Number.isSafeInteger(maxUploadFileBytes) || maxUploadFileBytes < 1 || maxUploadFileBytes > MAX_UPLOAD_FILE_BYTES) {
    throw new Error('上传文件大小限制必须是 1-50 MB 的正整数');
  }
  if (!Number.isSafeInteger(maxUploadFiles) || maxUploadFiles < 1 || maxUploadFiles > 10) {
    throw new Error('单批上传数量必须是 1-10');
  }
}

export const developmentJwtSecret = 'customer-erp-development-secret-change-in-production';

const maxUploadFileMb = Number(process.env.MAX_UPLOAD_FILE_MB || 50);
const maxUploadFiles = Number(process.env.MAX_UPLOAD_FILES || 10);
const maxUploadFileBytes = maxUploadFileMb * 1024 * 1024;
validateUploadLimits({ maxUploadFileBytes, maxUploadFiles });

export function validateRuntimeConfig(runtime) {
  if (runtime.nodeEnv !== 'production') return;
  const secret = String(runtime.jwtSecret || '');
  const knownExamples = new Set([developmentJwtSecret, 'please-change-this-to-a-long-random-secret']);
  if (secret.length < 32 || knownExamples.has(secret)) {
    throw new Error('生产环境 JWT_SECRET 必须使用至少 32 位、且非示例值的随机字符串');
  }
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || developmentJwtSecret,
  dbFile: process.env.DB_FILE || 'customer-erp.sqlite',
  uploadDir: resolveUploadPath(),
  maxUploadFileBytes,
  maxUploadFiles
};
