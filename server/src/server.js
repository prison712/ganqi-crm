import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { config, validateRuntimeConfig } from './config.js';
import { projectRoot } from './config.js';
import path from 'node:path';
import { createLocalDocumentStorage } from './documents/localStorage.js';

validateRuntimeConfig(config);
if (config.nodeEnv !== 'production' && config.jwtSecret.includes('development-secret')) {
  console.warn('安全提示：当前使用开发环境 JWT 密钥，正式部署前请在 .env 中设置随机 JWT_SECRET。');
}
const db = createDatabase({ filename: config.dbFile });
const staticDir = path.join(projectRoot, 'client', 'dist');
const documentStorage = createLocalDocumentStorage({ rootDir: config.uploadDir });
documentStorage.init();
await documentStorage.reconcileTrash(storageKey => Boolean(
  db.prepare('SELECT id FROM public_documents WHERE storage_key = ?').get(storageKey)
));
const app = createApp({
  db,
  jwtSecret: config.jwtSecret,
  staticDir,
  documentStorage,
  documentLimits: {
    maxUploadFileBytes: config.maxUploadFileBytes,
    maxUploadFiles: config.maxUploadFiles
  }
});
app.listen(config.port, config.host, () => {
  console.log(`客户管理 CRM 后端已启动：http://${config.host}:${config.port}`);
});
