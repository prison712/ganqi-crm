# 公共资料库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有客户管理 ERP 中交付一个所有已登录用户可上传、查阅、预览和下载，且支持权限删除、回收站和服务器迁移的公共资料库。

**Architecture:** 文件本体通过可替换的本地存储适配器保存在 `UPLOAD_DIR`，SQLite 保存资料元数据和审计日志；所有文件访问必须经过 JWT 保护的 Express 接口。前端新增公共资料列表、上传及预览组件，管理员额外拥有资料回收站，继续使用同源 `/api` 以便从局域网平滑迁移至服务器。

**Tech Stack:** Node.js 24+、Express 5、SQLite、Busboy、file-type 22、React 19、Vite 7、Ant Design 6、Axios、Vitest、Supertest、React Testing Library。

**Spec:** `docs/superpowers/specs/2026-08-29-public-documents-design.md`

## Global Constraints

- 仅管理员和销售两类已登录账号可访问资料接口，所有权限必须由后端强制执行。
- 单文件最大 50 MB，每批最多 10 个文件；测试通过依赖注入使用更小限制，不能真实创建 50 MB 测试文件。
- 分类固定为 `policy`、`product`、`sales_tool`、`training`、`other`。
- 允许 PDF、Word、Excel、PowerPoint、JPG/JPEG、PNG、GIF、WebP、TXT、ZIP；禁止脚本和可执行文件。
- 仅 PDF 与图片允许内联预览，其他允许类型只能下载。
- 上传者可软删除自己的资料，管理员可软删除任意资料、恢复和彻底删除。
- 文件名和用户输入不能参与磁盘路径计算；磁盘文件名必须使用服务器生成的随机 `storage_key`。
- 相对 `UPLOAD_DIR` 必须以项目根目录解析，路径处理必须同时适配 Windows 和 Linux。
- 上传、软删除、恢复和彻底删除必须写入不可删除的现有操作日志。
- 上传和下载使用流式文件处理，不能把 50 MB 文件整体载入 Node.js 内存。
- 中文界面延续深蓝色与橙色主题；前端菜单隐藏不能作为权限边界。
- 不实现匿名访问、多层文件夹、版本管理、Office 在线编辑、全文检索、外链分享或云对象存储。

## File Structure

### Backend files

- Create `server/src/documents/fileTypes.js`：扩展名、分类、MIME、文件特征与预览规则。
- Create `server/src/documents/localStorage.js`：本地目录初始化、临时文件、正式保存、读取、暂存删除与清理。
- Create `server/src/documents/uploadParser.js`：Busboy 多文件流式解析、逐文件大小限制和临时文件清理。
- Create `server/src/modules/documents.js`：资料列表、上传、预览、下载、软删除、恢复和彻底删除接口。
- Modify `server/src/config.js`：解析 `UPLOAD_DIR`、`MAX_UPLOAD_FILE_MB`、`MAX_UPLOAD_FILES`。
- Modify `server/src/db.js`：新增 `public_documents` 表与索引。
- Modify `server/src/app.js`：注入并挂载资料路由。
- Modify `server/src/server.js`：初始化生产资料存储并传入应用。
- Modify `server/src/middleware/error.js`：资料上传解析错误的中文映射。
- Modify `server/package.json`、`package-lock.json`：声明 `busboy` 与 `file-type@22.0.1` 直接依赖。
- Create `server/test/document-storage.test.js`：存储路径、文件识别、哈希和清理测试。
- Create `server/test/documents-upload.test.js`：上传、校验、部分成功和列表测试。
- Create `server/test/documents-lifecycle.test.js`：预览、下载、权限、回收站、彻底删除和日志测试。
- Modify `server/test/helpers.js`：为资料测试注入临时上传目录并提供资料插入助手。

### Frontend files

- Create `client/src/api/files.js`：Blob 下载、文件名解析和 Blob URL 生命周期工具。
- Create `client/src/documents/constants.js`：资料分类中文名和文件大小格式化。
- Create `client/src/components/DocumentUploadModal.jsx`：分类、说明、多文件选择和逐文件上传结果。
- Create `client/src/components/DocumentPreviewModal.jsx`：带 JWT 获取 PDF/图片 Blob 并安全释放 URL。
- Create `client/src/pages/DocumentsPage.jsx`：公共资料搜索、筛选、分页、预览、下载和删除。
- Create `client/src/pages/DocumentRecycleBinPage.jsx`：管理员资料回收站、恢复和彻底删除。
- Create `client/src/test/documents-page.test.jsx`：公共资料主流程和角色按钮测试。
- Create `client/src/test/document-recycle.test.jsx`：管理员回收站测试。
- Modify `client/src/App.jsx`：新增 `/documents` 与管理员 `/documents/recycle` 路由。
- Modify `client/src/layout/AppLayout.jsx`：新增公共资料和资料回收站菜单。
- Modify `client/src/pages/OperationLogsPage.jsx`：新增资料动作中文名与详情格式。
- Modify `client/src/pages/DashboardPage.jsx`：管理员最近操作显示资料动作中文名。
- Modify `client/src/styles.css`：资料预览、文件名和上传结果的响应式样式。

### Operations and documentation files

- Modify `.env.example`：新增上传目录和限制示例。
- Modify `.gitignore`：忽略 `data/uploads/`、临时目录和资料删除暂存目录。
- Modify `README.md`：新增资料库配置、备份、恢复和服务器迁移步骤。
- Modify `用户操作说明书.md`：新增普通用户和管理员操作章节。

---

### Task 1: 配置、数据表与测试基础设施

**Files:**
- Modify: `server/src/config.js`
- Modify: `server/src/db.js`
- Modify: `server/test/config.test.js`
- Modify: `server/test/helpers.js`
- Modify: `.env.example`

**Interfaces:**
- Produces: `resolveUploadPath(input?: string): string`
- Produces: `config.uploadDir: string`
- Produces: `config.maxUploadFileBytes: number`
- Produces: `config.maxUploadFiles: number`
- Produces: SQLite table `public_documents`
- Produces: `insertDocument(db, values)` test helper

- [ ] **Step 1: 为上传配置和资料表写失败测试**

在 `server/test/config.test.js` 增加：

```js
import path from 'node:path';
import { projectRoot, resolveUploadPath, validateUploadLimits } from '../src/config.js';

it('相对上传目录基于项目根目录解析', () => {
  expect(resolveUploadPath('data/uploads')).toBe(path.join(projectRoot, 'data', 'uploads'));
});

it('拒绝无效上传限制', () => {
  expect(() => validateUploadLimits({ maxUploadFileBytes: 0, maxUploadFiles: 10 })).toThrow('上传文件大小限制');
  expect(() => validateUploadLimits({ maxUploadFileBytes: 50 * 1024 * 1024, maxUploadFiles: 11 })).toThrow('单批上传数量');
});
```

在 `server/test/documents-upload.test.js` 创建首个数据库结构测试：

```js
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('公共资料数据库', () => {
  it('初始化资料字段与索引', () => {
    const { db } = createTestApp();
    const columns = db.prepare('PRAGMA table_info(public_documents)').all().map(row => row.name);
    expect(columns).toEqual(expect.arrayContaining([
      'id', 'original_name', 'storage_key', 'category', 'description', 'extension',
      'mime_type', 'size_bytes', 'sha256', 'uploaded_by', 'created_at', 'deleted_at', 'deleted_by'
    ]));
    const indexes = db.prepare('PRAGMA index_list(public_documents)').all().map(row => row.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_documents_active_created', 'idx_documents_category_created', 'idx_documents_uploader']));
  });
});
```

- [ ] **Step 2: 运行定向测试并确认失败原因**

Run:

```powershell
npm --workspace server test -- --run test/config.test.js test/documents-upload.test.js
```

Expected: FAIL，提示 `resolveUploadPath`、`validateUploadLimits` 未导出或 `public_documents` 不存在。

- [ ] **Step 3: 实现配置解析和数据库表**

在 `server/src/config.js` 增加以下导出，并把结果写入 `config`：

```js
export function resolveUploadPath(input = process.env.UPLOAD_DIR || 'data/uploads') {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(projectRoot, input);
}

export function validateUploadLimits({ maxUploadFileBytes, maxUploadFiles }) {
  if (!Number.isSafeInteger(maxUploadFileBytes) || maxUploadFileBytes < 1) {
    throw new Error('上传文件大小限制必须是正整数');
  }
  if (!Number.isSafeInteger(maxUploadFiles) || maxUploadFiles < 1 || maxUploadFiles > 10) {
    throw new Error('单批上传数量必须是 1-10');
  }
}

const maxUploadFileMb = Number(process.env.MAX_UPLOAD_FILE_MB || 50);
const maxUploadFiles = Number(process.env.MAX_UPLOAD_FILES || 10);
const maxUploadFileBytes = maxUploadFileMb * 1024 * 1024;
validateUploadLimits({ maxUploadFileBytes, maxUploadFiles });
```

在 `config` 对象中加入 `uploadDir: resolveUploadPath()`、`maxUploadFileBytes`、`maxUploadFiles`。在 `server/src/db.js` 的 schema 字符串中加入：

```sql
CREATE TABLE IF NOT EXISTS public_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('policy', 'product', 'sales_tool', 'training', 'other')),
  description TEXT NOT NULL DEFAULT '',
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_documents_active_created ON public_documents(deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_category_created ON public_documents(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_uploader ON public_documents(uploaded_by);
```

在 `.env.example` 增加：

```text
UPLOAD_DIR=data/uploads
MAX_UPLOAD_FILE_MB=50
MAX_UPLOAD_FILES=10
```

在 `server/test/helpers.js` 增加 `insertDocument`，统一写入完整合法字段：

```js
export function insertDocument(db, {
  originalName = '销售手册.pdf', storageKey = crypto.randomUUID() + '.pdf', category = 'sales_tool',
  description = '', extension = 'pdf', mimeType = 'application/pdf', sizeBytes = 12,
  sha256 = 'a'.repeat(64), uploadedBy = 1, deletedAt = null, deletedBy = null
} = {}) {
  const createdAt = new Date().toISOString();
  const result = db.prepare(`INSERT INTO public_documents
    (original_name, storage_key, category, description, extension, mime_type, size_bytes, sha256, uploaded_by, created_at, deleted_at, deleted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(originalName, storageKey, category, description, extension, mimeType, sizeBytes, sha256, uploadedBy, createdAt, deletedAt, deletedBy);
  return { id: Number(result.lastInsertRowid), originalName, storageKey, uploadedBy };
}
```

同时在文件顶部导入 `node:crypto`。

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
npm --workspace server test -- --run test/config.test.js test/documents-upload.test.js
```

Expected: 新增测试 PASS，既有配置测试继续 PASS。

- [ ] **Step 5: 提交配置与数据表**

```powershell
git add server/src/config.js server/src/db.js server/test/config.test.js server/test/documents-upload.test.js server/test/helpers.js .env.example
git commit -m "feat: add document metadata schema and upload config"
```

---

### Task 2: 本地存储、文件识别与流式上传解析器

**Files:**
- Create: `server/src/documents/fileTypes.js`
- Create: `server/src/documents/localStorage.js`
- Create: `server/src/documents/uploadParser.js`
- Create: `server/test/document-storage.test.js`
- Modify: `server/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `validateCategory(value): string`
- Produces: `validateDescription(value): string`
- Produces: `inspectDocumentFile({ path, originalName, reportedMime }): Promise<{ extension, mimeType, previewable, sha256, sizeBytes }>`
- Produces: `createLocalDocumentStorage({ rootDir }): DocumentStorage`
- Produces: `parseDocumentUpload(req, { storage, maxFiles, maxFileBytes }): Promise<{ fields, candidates, rejected }>`

- [ ] **Step 1: 安装直接依赖并锁定版本**

Run:

```powershell
npm install --workspace server busboy@1.6.0 file-type@22.0.1
```

Expected: `server/package.json` 出现两个直接依赖，根 `package-lock.json` 更新；`file-type` 使用 ESM 的 `fileTypeFromFile`。

- [ ] **Step 2: 为路径安全、文件识别和逐文件限制写失败测试**

创建 `server/test/document-storage.test.js`，使用 `mkdtempSync(path.join(tmpdir(), 'erp-documents-'))` 建立独立目录，并至少包含以下断言：

```js
import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectDocumentFile } from '../src/documents/fileTypes.js';
import { createLocalDocumentStorage } from '../src/documents/localStorage.js';
import { parseDocumentUpload } from '../src/documents/uploadParser.js';

let testDir;
let storage;

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'erp-documents-'));
  storage = createLocalDocumentStorage({ rootDir: testDir });
  storage.init();
});

afterEach(() => rmSync(testDir, { recursive: true, force: true }));

async function inspectFixture(originalName, content) {
  const fixturePath = path.join(testDir, crypto.randomUUID() + '.fixture');
  writeFileSync(fixturePath, content);
  try {
    return await inspectDocumentFile({ path: fixturePath, originalName, reportedMime: 'application/octet-stream' });
  } finally {
    rmSync(fixturePath, { force: true });
  }
}

async function parseMultipartFixture(files, limits) {
  const boundary = 'erp-document-boundary';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\ntraining\r\n`
  ];
  for (const file of files) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: text/plain\r\n\r\n${file.content}\r\n`);
  }
  parts.push(`--${boundary}--\r\n`);
  const req = Readable.from(Buffer.from(parts.join(''), 'utf8'));
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  return parseDocumentUpload(req, { storage, ...limits });
}

it('使用随机 storageKey 保存且不能越过上传目录', async () => {
  const source = path.join(testDir, 'incoming.tmp');
  writeFileSync(source, Buffer.from('%PDF-1.7\n'));
  const saved = await storage.commit(source, 'pdf');
  expect(saved.storageKey).toMatch(/^[0-9a-f-]+\.pdf$/);
  expect(saved.absolutePath.startsWith(path.resolve(testDir) + path.sep)).toBe(true);
  expect(() => storage.resolve('../outside.pdf')).toThrow('资料存储标识不正确');
});

it('识别允许的 PDF 与文本并拒绝伪装可执行文件', async () => {
  const pdf = await inspectFixture('manual.pdf', Buffer.from('%PDF-1.7\n'));
  expect(pdf).toMatchObject({ extension: 'pdf', mimeType: 'application/pdf', previewable: true });
  const text = await inspectFixture('notice.txt', Buffer.from('中文通知', 'utf8'));
  expect(text).toMatchObject({ extension: 'txt', mimeType: 'text/plain', previewable: false });
  await expect(inspectFixture('report.pdf', Buffer.from('MZ executable'))).rejects.toThrow('文件内容与扩展名不一致');
});

it('单个文件超限后仍保留同批其他候选文件', async () => {
  const result = await parseMultipartFixture([
    { name: 'too-large.txt', content: '123456789' },
    { name: 'valid.txt', content: 'ok' }
  ], { maxFileBytes: 4, maxFiles: 10 });
  expect(result.rejected).toEqual(expect.arrayContaining([
    expect.objectContaining({ originalName: 'too-large.txt', code: 'FILE_TOO_LARGE' })
  ]));
  expect(result.candidates.map(item => item.originalName)).toContain('valid.txt');
});
```

测试结束使用 `rmSync(testDir, { recursive: true, force: true })` 清理明确的临时目录。

- [ ] **Step 3: 运行存储测试并确认失败**

Run:

```powershell
npm --workspace server test -- --run test/document-storage.test.js
```

Expected: FAIL，提示三个资料模块不存在。

- [ ] **Step 4: 实现文件分类与内容识别**

在 `fileTypes.js` 定义不可变映射和校验函数：

```js
export const DOCUMENT_CATEGORIES = new Set(['policy', 'product', 'sales_tool', 'training', 'other']);
export const PREVIEW_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'zip']);

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
```

`inspectDocumentFile` 使用 `fileTypeFromFile(path)`、`createReadStream` 和 `createHash('sha256')`。二进制文件必须匹配允许扩展名及兼容检测结果；`.txt` 必须无 NUL 字节且能作为 UTF-8 文本读取。返回规范化 MIME、大小、预览标记和 64 位十六进制 SHA-256。JPEG 的 `jpg/jpeg` 视为同一家族，OOXML 与 ZIP 按 `file-type` 检测结果区分。

- [ ] **Step 5: 实现本地存储适配器**

`createLocalDocumentStorage` 初始化 `rootDir`、`.tmp` 和 `.trash`，并返回以下方法：

```js
return {
  rootDir,
  tempDir,
  trashDir,
  createTempPath: () => path.join(tempDir, crypto.randomUUID() + '.upload'),
  resolve: storageKey => resolveStorageKey(rootDir, storageKey),
  commit: async (tempPath, extension) => {
    const storageKey = `${crypto.randomUUID()}.${extension}`;
    const absolutePath = resolveStorageKey(rootDir, storageKey);
    await fs.rename(tempPath, absolutePath);
    return { storageKey, absolutePath };
  },
  exists: async storageKey => pathExists(resolveStorageKey(rootDir, storageKey)),
  stat: storageKey => fs.stat(resolveStorageKey(rootDir, storageKey)),
  createReadStream: storageKey => createReadStream(resolveStorageKey(rootDir, storageKey)),
  remove: async storageKey => fs.rm(resolveStorageKey(rootDir, storageKey), { force: true }),
  stageRemoval,
  rollbackRemoval,
  finalizeRemoval,
  reconcileTrash,
  removeTemp: async tempPath => fs.rm(tempPath, { force: true })
};
```

`resolveStorageKey` 只接受 `^[0-9a-f-]+\.[a-z0-9]+$`，并验证 `path.dirname(resolved) === path.resolve(rootDir)`。`stageRemoval` 只在同一上传根目录内把文件原子移动到 `.trash`，为 Task 4 的彻底删除提供补偿点。

- [ ] **Step 6: 实现 Busboy 流式解析器**

`parseDocumentUpload` 必须：

- 仅接收字段名 `files`；其他文件字段产生 `INVALID_UPLOAD_FIELD` 结果。
- 使用 Busboy `limits: { files: maxFiles, fileSize: maxFileBytes, fields: 2 }`。
- 每个文件直接管道写入 `storage.createTempPath()`。
- 文件流触发 `limit` 时标记该文件为 `FILE_TOO_LARGE`，写流结束后删除对应临时文件，但继续处理后续文件。
- 收集 `category` 和 `description` 字段。
- 请求中止或解析报错时关闭写流并删除本次创建的全部临时文件。
- 返回 `{ fields, candidates, rejected }`；候选项包含 `originalName`、`reportedMime`、`tempPath`。

- [ ] **Step 7: 运行存储测试确认通过**

Run:

```powershell
npm --workspace server test -- --run test/document-storage.test.js
```

Expected: PASS，临时目录清理后不存在残留文件。

- [ ] **Step 8: 提交存储基础设施**

```powershell
git add server/src/documents server/test/document-storage.test.js server/package.json package-lock.json
git commit -m "feat: add secure document storage pipeline"
```

---

### Task 3: 资料上传、列表与应用集成

**Files:**
- Create: `server/src/modules/documents.js`
- Modify: `server/src/app.js`
- Modify: `server/src/server.js`
- Modify: `server/src/middleware/error.js`
- Modify: `server/test/helpers.js`
- Modify: `server/test/documents-upload.test.js`

**Interfaces:**
- Consumes: `createLocalDocumentStorage`、`parseDocumentUpload`、`inspectDocumentFile`、`validateCategory`、`validateDescription`
- Produces: `documentsRouter({ db, requireAuth, storage, limits })`
- Produces: `GET /api/documents`
- Produces: `POST /api/documents`

- [ ] **Step 1: 为鉴权、逐文件上传结果、日志和筛选写失败测试**

在 `documents-upload.test.js` 建立临时 storage，并添加以下场景：

```js
it('销售上传合法资料并写入日志', async () => {
  const response = await request(app).post('/api/documents')
    .set(auth(salesAToken))
    .field('category', 'training')
    .field('description', '新人培训')
    .attach('files', Buffer.from('%PDF-1.7\n'), { filename: '培训手册.pdf', contentType: 'application/pdf' });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({ total: 1, success: 1, failed: 0 });
  expect(response.body.data.rows[0]).toMatchObject({ originalName: '培训手册.pdf', type: 'success' });
  expect(db.prepare('SELECT action FROM operation_logs WHERE action = ?').get('document_upload')).toBeTruthy();
});

it('未登录不能上传或查看列表', async () => {
  expect((await request(app).get('/api/documents')).status).toBe(401);
  expect((await request(app).post('/api/documents')).status).toBe(401);
});

it('列表按关键词分类上传人分页筛选', async () => {
  const response = await request(app).get('/api/documents')
    .set(auth(adminToken))
    .query({ keyword: '手册', category: 'sales_tool', uploaderId: salesA.id, page: 1, pageSize: 10 });
  expect(response.status).toBe(200);
  expect(response.body.data.items.every(item => item.category === 'sales_tool')).toBe(true);
  expect(response.body.data.pagination).toEqual(expect.objectContaining({ page: 1, pageSize: 10 }));
});
```

在测试文件顶部导入 `readdirSync`。混合批次使用以下测试，确保合法文件不会被同批坏文件连带回滚：

```js
it('混合批次逐文件返回成功与失败', async () => {
  const response = await request(app).post('/api/documents')
    .set(auth(salesAToken))
    .field('category', 'sales_tool')
    .attach('files', Buffer.from('%PDF-1.7\n'), { filename: '合法.pdf', contentType: 'application/pdf' })
    .attach('files', Buffer.from('MZ executable'), { filename: '伪装.pdf', contentType: 'application/pdf' });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({ total: 2, success: 1, failed: 1 });
  expect(response.body.data.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ originalName: '合法.pdf', type: 'success' }),
    expect.objectContaining({ originalName: '伪装.pdf', type: 'error', message: '文件内容与扩展名不一致' })
  ]));
  expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(1);
});
```

- [ ] **Step 2: 运行上传接口测试并确认 404/模块缺失失败**

Run:

```powershell
npm --workspace server test -- --run test/documents-upload.test.js
```

Expected: FAIL，资料路由尚未挂载。

- [ ] **Step 3: 实现资料列表查询**

在 `documentsRouter` 顶部执行 `router.use(requireAuth)`。列表使用固定 SQL 片段和参数数组构造，不接受客户端排序字段：

```sql
SELECT d.id, d.original_name, d.category, d.description, d.extension, d.mime_type,
       d.size_bytes, d.uploaded_by, d.created_at, u.display_name uploader_name
FROM public_documents d
JOIN users u ON u.id = d.uploaded_by
WHERE d.deleted_at IS NULL
```

`keyword` 匹配 `original_name` 与 `description`；`category` 必须在固定分类集合内；`uploaderId` 必须是正整数；`pageSize` 限制在 1-100。响应通过映射函数返回 camelCase 字段、`previewable`、`{ page, pageSize, total }`，以及从全部未删除资料上传人去重得到的 `facets.uploaders: [{ id, displayName }]`，使销售账号不需要访问管理员专属用户接口也能使用上传人筛选。

- [ ] **Step 4: 实现逐文件上传事务与补偿**

上传路由处理顺序固定为：

```js
const parsed = await parseDocumentUpload(req, {
  storage,
  maxFiles: limits.maxUploadFiles,
  maxFileBytes: limits.maxUploadFileBytes
});
const category = validateCategory(parsed.fields.category);
const description = validateDescription(parsed.fields.description);
const rows = [...parsed.rejected];

for (const candidate of parsed.candidates) {
  let saved;
  try {
    const inspected = await inspectDocumentFile({
      path: candidate.tempPath,
      originalName: candidate.originalName,
      reportedMime: candidate.reportedMime
    });
    saved = await storage.commit(candidate.tempPath, inspected.extension);
    const document = withTransaction(db, () => insertDocumentAndLog({
      db, actor: req.user, candidate, inspected, saved, category, description
    }));
    rows.push({ originalName: candidate.originalName, type: 'success', document });
  } catch (error) {
    await storage.removeTemp(candidate.tempPath);
    if (saved) await storage.remove(saved.storageKey);
    rows.push({ originalName: candidate.originalName, type: 'error', message: businessUploadMessage(error) });
  }
}
```

`businessUploadMessage` 对 `AppError` 返回其中文 message，对 `ENOSPC` 返回“磁盘空间不足，资料上传失败”，对其他错误在服务端保留堆栈并向用户返回“资料上传失败，请稍后重试”。`insertDocumentAndLog` 在同一 SQLite 事务写 `public_documents` 与 `document_upload` 日志，返回刚创建资料的 camelCase 公共字段。没有文件时返回 400“请选择要上传的资料”；全部失败时仍返回 200 和完整逐文件结果，至少一个成功时返回 201。

- [ ] **Step 5: 将存储依赖接入真实服务和测试**

在 `server/src/server.js`：

```js
const documentStorage = createLocalDocumentStorage({ rootDir: config.uploadDir });
documentStorage.init();
const app = createApp({
  db,
  jwtSecret: config.jwtSecret,
  staticDir,
  documentStorage,
  documentLimits: { maxUploadFileBytes: config.maxUploadFileBytes, maxUploadFiles: config.maxUploadFiles }
});
```

`createApp` 仅在注入 `documentStorage` 时挂载 `/api/documents`，确保既有不涉及资料的单元测试不被迫创建磁盘目录。资料测试助手显式注入临时 storage 和小限制。

在全局错误处理中把 Busboy 的请求级错误映射为“资料上传请求格式不正确”“单次最多上传 N 个文件”，不复用 Excel 的 5 MB 文案。

- [ ] **Step 6: 运行上传接口与全部后端测试**

Run:

```powershell
npm --workspace server test -- --run test/documents-upload.test.js
npm --workspace server test
```

Expected: 资料上传测试和既有 31 项后端测试全部 PASS。

- [ ] **Step 7: 提交上传与列表接口**

```powershell
git add server/src/modules/documents.js server/src/app.js server/src/server.js server/src/middleware/error.js server/test/helpers.js server/test/documents-upload.test.js
git commit -m "feat: add document upload and listing APIs"
```

---

### Task 4: 预览、下载、删除、恢复与彻底删除

**Files:**
- Modify: `server/src/modules/documents.js`
- Modify: `server/src/server.js`
- Create: `server/test/documents-lifecycle.test.js`
- Modify: `server/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `GET /api/documents/:id/preview`
- Produces: `GET /api/documents/:id/download`
- Produces: `DELETE /api/documents/:id`
- Produces: `GET /api/documents/recycle`
- Produces: `POST /api/documents/:id/restore`
- Produces: `DELETE /api/documents/:id/purge`

- [ ] **Step 1: 写预览、下载和文件丢失的失败测试**

创建 `documents-lifecycle.test.js`，真实写入临时上传目录后断言：

```js
it('PDF 可内联预览，Office 资料只能下载', async () => {
  const preview = await request(app).get(`/api/documents/${pdf.id}/preview`).set(auth(salesAToken));
  expect(preview.status).toBe(200);
  expect(preview.headers['content-type']).toMatch(/application\/pdf/);
  expect(preview.headers['content-disposition']).toMatch(/^inline/);
  expect(preview.headers['x-content-type-options']).toBe('nosniff');
  const rejected = await request(app).get(`/api/documents/${xlsx.id}/preview`).set(auth(salesAToken));
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.message).toContain('不支持在线预览');
});

it('下载使用原始文件名且文件缺失返回中文错误', async () => {
  const download = await request(app).get(`/api/documents/${pdf.id}/download`).set(auth(salesAToken));
  expect(download.status).toBe(200);
  expect(download.headers['content-disposition']).toContain('attachment');
  await storage.remove(pdf.storageKey);
  const missing = await request(app).get(`/api/documents/${pdf.id}/download`).set(auth(salesAToken));
  expect(missing.status).toBe(404);
  expect(missing.body.error.message).toContain('不存在或已损坏');
});
```

- [ ] **Step 2: 写权限、回收站和日志的失败测试**

测试代码包含以下权限和管理员生命周期用例：

```js
it('上传者可软删除自己的资料但不能删除他人资料', async () => {
  expect((await request(app).delete(`/api/documents/${owned.id}`).set(auth(salesAToken))).status).toBe(200);
  const forbidden = await request(app).delete(`/api/documents/${other.id}`).set(auth(salesAToken));
  expect(forbidden.status).toBe(403);
  expect(forbidden.body.error.message).toBe('只能删除自己上传的资料');
});

it('仅管理员可查看回收站、恢复和彻底删除', async () => {
  expect((await request(app).get('/api/documents/recycle').set(auth(salesAToken))).status).toBe(403);
  expect((await request(app).post(`/api/documents/${deleted.id}/restore`).set(auth(adminToken))).status).toBe(200);
  await request(app).delete(`/api/documents/${deletedAgain.id}/purge`).set(auth(adminToken)).expect(200);
  expect(await storage.exists(deletedAgain.storageKey)).toBe(false);
  expect(db.prepare('SELECT id FROM public_documents WHERE id = ?').get(deletedAgain.id)).toBeUndefined();
  expect(db.prepare("SELECT action FROM operation_logs WHERE action = 'document_purge'").get()).toBeTruthy();
});
```

- [ ] **Step 3: 运行生命周期测试并确认失败**

Run:

```powershell
npm --workspace server test -- --run test/documents-lifecycle.test.js
```

Expected: FAIL，目标路由返回 404。

- [ ] **Step 4: 实现受保护的文件响应**

先声明与 Express 当前依赖兼容的直接依赖：

```powershell
npm install --workspace server content-disposition@1.0.0
```

创建共享查询 `getActiveDocument(id)`，仅返回 `deleted_at IS NULL` 的记录。预览和下载先检查文件存在，再设置：

```js
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('Content-Type', document.mime_type);
res.setHeader('Content-Length', String(stat.size));
res.setHeader('Content-Disposition', contentDisposition(document.original_name, {
  type: preview ? 'inline' : 'attachment'
}));
storage.createReadStream(document.storage_key).on('error', next).pipe(res);
```

使用 `content-disposition` 可靠处理中文文件名，不要手工拼接响应头。预览路由只允许 `PREVIEW_MIME_TYPES`。

- [ ] **Step 5: 实现软删除、回收站和恢复**

- `DELETE /:id` 在 `BEGIN IMMEDIATE` 事务内验证未删除状态；销售必须满足 `uploaded_by = req.user.id`；更新删除字段并写 `document_delete`。
- `GET /recycle` 使用管理员中间件或明确角色检查，支持与普通列表相同的筛选和分页，按 `deleted_at DESC`。
- `POST /:id/restore` 仅管理员执行条件更新 `WHERE deleted_at IS NOT NULL`，清空删除字段并写 `document_restore`。
- 路由注册顺序必须把 `/recycle` 放在 `/:id` 之前，ID 参数只接受正整数。

- [ ] **Step 6: 实现带补偿的彻底删除**

`DELETE /:id/purge` 仅管理员可用，且目标必须已软删除。流程：

1. `storage.stageRemoval(storageKey)` 把文件原子移动到 `.trash`；文件不存在时返回中文损坏错误且不改数据库。
2. SQLite 事务写 `document_purge` 完整快照并删除 `public_documents` 行。
3. 数据库事务失败时执行 `storage.rollbackRemoval(stage)`，恢复文件。
4. 数据库提交成功后执行 `storage.finalizeRemoval(stage)` 删除暂存文件。
5. 最终清理失败时记录服务端错误并返回 500；`.trash` 中的不可访问文件由服务启动清理器按数据库状态安全重试。

`storage.reconcileTrash(isReferenced)` 遍历 `.trash`：如果 `isReferenced(storageKey)` 返回 true，说明数据库记录仍存在，必须把文件恢复到正式目录；如果返回 false，说明数据库删除已经提交，可以清理暂存文件。`server.js` 在开始监听端口前调用：

```js
await documentStorage.reconcileTrash(storageKey => Boolean(
  db.prepare('SELECT id FROM public_documents WHERE storage_key = ?').get(storageKey)
));
```

生命周期测试分别构造“数据库记录仍存在”和“数据库记录已删除”的崩溃恢复状态，验证前者恢复、后者清理。

`document_purge` 日志的 `details` 至少保存 `documentId`、`originalName`、`category`、`sizeBytes`、`sha256`、`uploadedBy`。

- [ ] **Step 7: 运行生命周期和全部后端测试**

Run:

```powershell
npm --workspace server test -- --run test/documents-lifecycle.test.js
npm --workspace server test
```

Expected: 生命周期测试 PASS，既有后端测试无回归。

- [ ] **Step 8: 提交资料完整生命周期**

```powershell
git add server/src/documents server/src/modules/documents.js server/src/server.js server/test/documents-lifecycle.test.js server/package.json package-lock.json
git commit -m "feat: add document access and recycle lifecycle"
```

---

### Task 5: 公共资料页面、上传和安全预览

**Files:**
- Create: `client/src/api/files.js`
- Create: `client/src/documents/constants.js`
- Create: `client/src/components/DocumentUploadModal.jsx`
- Create: `client/src/components/DocumentPreviewModal.jsx`
- Create: `client/src/pages/DocumentsPage.jsx`
- Create: `client/src/test/documents-page.test.jsx`
- Modify: `client/src/App.jsx`
- Modify: `client/src/layout/AppLayout.jsx`
- Modify: `client/src/styles.css`

**Interfaces:**
- Produces: `downloadResponse(response, fallbackName): void`
- Produces: `DOCUMENT_CATEGORY_OPTIONS`、`categoryName(value)`、`formatFileSize(bytes)`
- Produces: `validateDocumentSelection(files): string`
- Produces: `UploadResultContent({ result })`
- Produces: `DocumentUploadModal({ open, onClose, onUploaded })`
- Produces: `DocumentPreviewModal({ document, open, onClose })`
- Produces: route `/documents`

- [ ] **Step 1: 写菜单、列表筛选、上传结果和角色删除按钮的失败测试**

在 `documents-page.test.jsx` mock `http`，并覆盖：

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import AppLayout from '../layout/AppLayout.jsx';
import DocumentsPage from '../pages/DocumentsPage.jsx';
import DocumentUploadModal, { UploadResultContent, validateDocumentSelection } from '../components/DocumentUploadModal.jsx';

let currentUser;
const httpMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../api/http.js', () => ({ http: httpMocks, errorMessage: error => error?.message || '操作失败' }));
vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => ({ user: currentUser, logout: vi.fn(), changePassword: vi.fn() })
}));

function renderLayout(user) {
  currentUser = user;
  return render(<MemoryRouter><Routes><Route element={<AppLayout />}><Route path="*" element={<div>内容</div>} /></Route></Routes></MemoryRouter>);
}

function renderDocuments(user, items = []) {
  currentUser = user;
  httpMocks.get.mockResolvedValue({
    data: { data: { items, pagination: { page: 1, pageSize: 10, total: items.length }, facets: { uploaders: [] } } }
  });
  return render(<MemoryRouter><DocumentsPage /></MemoryRouter>);
}

it('管理员和销售都能看到公共资料菜单', () => {
  renderLayout({ role: 'sales', id: 2 });
  expect(screen.getByRole('link', { name: '公共资料' })).toHaveAttribute('href', '/documents');
});

it('按当前筛选和分页加载资料', async () => {
  const user = userEvent.setup();
  renderDocuments({ role: 'sales', id: 2 });
  await user.type(screen.getByPlaceholderText('搜索资料名称或说明'), '手册');
  await user.click(screen.getByRole('combobox', { name: '资料分类' }));
  await user.click(screen.getByText('销售工具'));
  await waitFor(() => expect(http.get).toHaveBeenCalledWith('/documents', {
    params: expect.objectContaining({ keyword: '手册', category: 'sales_tool', page: 1, pageSize: 10 })
  }));
});

it('销售只能看到自己资料的删除按钮', async () => {
  renderDocuments({ role: 'sales', id: 2 }, [
    { id: 1, originalName: '我的资料.pdf', uploadedBy: 2 },
    { id: 2, originalName: '他人资料.pdf', uploadedBy: 3 }
  ]);
  expect(await screen.findAllByRole('button', { name: '删除' })).toHaveLength(1);
});

it('上传选择限制数量和大小并展示逐文件结果', () => {
  expect(validateDocumentSelection(Array.from({ length: 11 }, (_, index) => ({ name: `${index}.txt`, size: 1 })))).toBe('单次最多上传 10 个文件');
  expect(validateDocumentSelection([{ name: '过大.pdf', size: 50 * 1024 * 1024 + 1 }])).toBe('“过大.pdf”不能超过 50 MB');
  render(<UploadResultContent result={{ total: 2, success: 1, failed: 1, rows: [
    { originalName: '成功.pdf', type: 'success', message: '上传成功' },
    { originalName: '失败.exe', type: 'error', message: '不支持该文件格式' }
  ] }} />);
  expect(screen.getByText('成功 1 个，失败 1 个')).toBeInTheDocument();
  expect(screen.getByText('不支持该文件格式')).toBeInTheDocument();
});
```

在同一测试文件中加入表单边界用例：

```jsx
it('资料说明超过 500 字时不能提交', async () => {
  const user = userEvent.setup();
  render(<DocumentUploadModal open onClose={vi.fn()} onUploaded={vi.fn()} />);
  await user.type(screen.getByLabelText('资料说明'), '说'.repeat(501));
  expect(await screen.findByText('资料说明不能超过 500 字')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始上传' })).toBeDisabled();
});
```

- [ ] **Step 2: 运行前端定向测试并确认失败**

Run:

```powershell
npm --workspace client test -- --run src/test/documents-page.test.jsx
```

Expected: FAIL，页面与组件不存在。

- [ ] **Step 3: 实现 Blob 下载与预览工具**

`client/src/api/files.js` 提供：

```js
export function filenameFromDisposition(value, fallbackName) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value || '')?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return fallbackName;
}

export function downloadResponse(response, fallbackName) {
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFromDisposition(response.headers?.['content-disposition'], fallbackName);
  link.click();
  URL.revokeObjectURL(url);
}
```

`client/src/documents/constants.js` 集中定义五种分类中文名，并导出：

```js
export const DOCUMENT_CATEGORY_OPTIONS = [
  { value: 'policy', label: '制度文件' },
  { value: 'product', label: '产品资料' },
  { value: 'sales_tool', label: '销售工具' },
  { value: 'training', label: '培训资料' },
  { value: 'other', label: '其他' }
];
export const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'zip']);

export function categoryName(value) {
  return DOCUMENT_CATEGORY_OPTIONS.find(item => item.value === value)?.label || value;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

预览组件请求 `/documents/:id/preview` 且 `responseType: 'blob'`，成功后创建 Blob URL；关闭、切换资料和组件卸载时调用 `URL.revokeObjectURL`。PDF 使用 `<iframe title="资料预览">`，图片使用带 `alt` 的 `<img>`。

- [ ] **Step 4: 实现上传弹窗**

使用 Ant Design `Form`、`Select`、`Input.TextArea` 和 `Upload.Dragger`：

- 分类必填，五个选项使用中文。
- 说明最多 500 字。
- `beforeUpload={() => false}` 阻止 Ant Design 自动请求。
- 选择数量超过 10 或单文件超过 50 MB 时在前端即时提示，但仍以服务端结果为准。
- 提交时把所有文件以 `files` 加入同一个 `FormData`，并附加分类和说明。
- 使用 `http.post('/documents', formData)`；完成后展示 `{ total, success, failed, rows }`，有成功项时调用 `onUploaded()` 刷新列表。

导出的纯校验函数固定为：

```js
export function validateDocumentSelection(files) {
  if (!files.length) return '请选择要上传的资料';
  if (files.length > 10) return '单次最多上传 10 个文件';
  const oversized = files.find(file => file.size > 50 * 1024 * 1024);
  if (oversized) return `“${oversized.name}”不能超过 50 MB`;
  const unsupported = files.find(file => !ALLOWED_DOCUMENT_EXTENSIONS.has(file.name.split('.').pop()?.toLowerCase()));
  return unsupported ? `“${unsupported.name}”不是支持的文件格式` : '';
}
```

`UploadResultContent` 显示“成功 N 个，失败 N 个”，并用表格列出文件名、结果和中文提示；成功和失败同时使用文字标签，不只依赖颜色。

- [ ] **Step 5: 实现公共资料列表页**

页面状态固定为：

```js
const [filters, setFilters] = useState({ keyword: '', category: '', uploaderId: '' });
const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 });
const [previewing, setPreviewing] = useState(null);
```

列表从响应 `facets.uploaders` 设置上传人筛选选项，不调用管理员专属 `/users`。列表列为资料名称、分类、说明、类型/大小、上传人、上传时间、操作。格式化文件大小为 B、KB、MB。操作规则：

- `previewable` 时显示“预览”。
- 所有行显示“下载”。
- `user.role === 'admin' || row.uploadedBy === user.id` 时显示带二次确认的“删除”。

删除调用 `DELETE /documents/:id`，成功提示“资料已移入回收站”并刷新当前页。下载调用 `/documents/:id/download` 并使用 `downloadResponse`。

- [ ] **Step 6: 接入路由、菜单和样式**

`App.jsx` 懒加载 `DocumentsPage`，在受保护路由内注册：

```jsx
<Route path="documents" element={<DocumentsPage />} />
```

`AppLayout.jsx` 为所有角色加入：

```jsx
{ key: '/documents', icon: <FolderOpenOutlined />, label: <Link to="/documents">公共资料</Link> }
```

样式保证长文件名可换行或省略、预览区在桌面端有足够高度、窄屏表格横向滚动、上传结果不依赖颜色表达成功失败。

- [ ] **Step 7: 运行定向测试确认通过**

Run:

```powershell
npm --workspace client test -- --run src/test/documents-page.test.jsx
```

Expected: PASS。

- [ ] **Step 8: 提交公共资料主页面**

```powershell
git add client/src/api/files.js client/src/documents/constants.js client/src/components/DocumentUploadModal.jsx client/src/components/DocumentPreviewModal.jsx client/src/pages/DocumentsPage.jsx client/src/test/documents-page.test.jsx client/src/App.jsx client/src/layout/AppLayout.jsx client/src/styles.css
git commit -m "feat: add public document library interface"
```

---

### Task 6: 管理员资料回收站与操作日志展示

**Files:**
- Create: `client/src/pages/DocumentRecycleBinPage.jsx`
- Create: `client/src/test/document-recycle.test.jsx`
- Modify: `client/src/App.jsx`
- Modify: `client/src/layout/AppLayout.jsx`
- Modify: `client/src/pages/OperationLogsPage.jsx`
- Modify: `client/src/pages/DashboardPage.jsx`

**Interfaces:**
- Produces: admin-only route `/documents/recycle`
- Consumes: `GET /documents/recycle`、`POST /documents/:id/restore`、`DELETE /documents/:id/purge`

- [ ] **Step 1: 写管理员路由、恢复、彻底删除和日志中文名的失败测试**

在 `document-recycle.test.jsx` 覆盖：

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import AppLayout from '../layout/AppLayout.jsx';
import DocumentRecycleBinPage from '../pages/DocumentRecycleBinPage.jsx';

let currentUser;
const httpMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn().mockResolvedValue({ data: { message: '成功' } }), delete: vi.fn().mockResolvedValue({ data: { message: '成功' } })
}));
vi.mock('../api/http.js', () => ({ http: httpMocks, errorMessage: error => error?.message || '操作失败' }));
vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => ({ user: currentUser, logout: vi.fn(), changePassword: vi.fn() })
}));

function renderLayout(user) {
  currentUser = user;
  return render(<MemoryRouter><Routes><Route element={<AppLayout />}><Route path="*" element={<div>内容</div>} /></Route></Routes></MemoryRouter>);
}

function renderRecycle() {
  currentUser = { id: 1, role: 'admin', displayName: '系统管理员' };
  httpMocks.get.mockResolvedValue({ data: { data: {
    items: [{ id: 9, originalName: '旧资料.pdf', category: 'policy', sizeBytes: 128, uploaderName: '销售甲', deletedByName: '系统管理员', createdAt: '2026-08-29T01:00:00.000Z', deletedAt: '2026-08-29T02:00:00.000Z' }],
    pagination: { page: 1, pageSize: 10, total: 1 }
  } } });
  return render(<MemoryRouter><DocumentRecycleBinPage /></MemoryRouter>);
}

it('销售不显示资料回收站菜单', () => {
  renderLayout({ role: 'sales', id: 2 });
  expect(screen.queryByRole('link', { name: '资料回收站' })).not.toBeInTheDocument();
});

it('管理员恢复资料前二次确认', async () => {
  renderRecycle();
  await userEvent.click(await screen.findByRole('button', { name: '恢复' }));
  expect(screen.getByText('恢复后资料将重新出现在公共资料列表中。')).toBeInTheDocument();
});

it('彻底删除明确提示不可恢复', async () => {
  renderRecycle();
  await userEvent.click(await screen.findByRole('button', { name: '彻底删除' }));
  expect(screen.getByText(/文件将从磁盘移除且不可恢复/)).toBeInTheDocument();
});
```

在 `admin-pages.test.jsx` 增加：

```js
import { operationActionName } from '../pages/OperationLogsPage.jsx';

expect(recentTitle({ action: 'document_upload' })).toBe('上传资料');
expect(operationActionName('document_purge')).toBe('彻底删除资料');
```

- [ ] **Step 2: 运行定向测试并确认失败**

Run:

```powershell
npm --workspace client test -- --run src/test/document-recycle.test.jsx src/test/admin-pages.test.jsx
```

Expected: FAIL，回收站页面、菜单和动作中文名不存在。

- [ ] **Step 3: 实现管理员资料回收站**

页面复用公共资料的分类映射和文件大小格式化工具，调用 `/documents/recycle`。表格显示资料名、分类、原上传人、删除人、上传时间、删除时间。操作使用 `DangerConfirm`：

- 恢复：`POST /documents/:id/restore`，说明“恢复后资料将重新出现在公共资料列表中。”
- 彻底删除：`DELETE /documents/:id/purge`，danger 样式，说明“文件将从磁盘移除且不可恢复，操作日志仍会保留。”

成功后刷新当前页；当前页最后一条被移除且页码大于 1 时回到上一页。

- [ ] **Step 4: 接入管理员路由和菜单**

在 `App.jsx` 注册：

```jsx
<Route path="documents/recycle" element={<AdminRoute><DocumentRecycleBinPage /></AdminRoute>} />
```

在管理员菜单中加入 `/documents/recycle`，前端继续使用 `AdminRoute`，后端仍独立执行管理员权限检查。

- [ ] **Step 5: 补充操作日志中文展示**

`OperationLogsPage.jsx` 的 `actionNames` 加入：

```js
document_upload: '上传资料',
document_delete: '删除资料',
document_restore: '恢复资料',
document_purge: '彻底删除资料'
```

同时导出 `operationActionName(action) { return actionNames[action] || action; }` 并在表格中复用。详情列优先展示 `details.originalName`、分类和文件大小；既有客户导入和释放详情不能回归。`DashboardPage.jsx` 的 `recentTitle` 同步处理四个资料动作，使管理员看板不显示英文动作代码。

- [ ] **Step 6: 运行前端定向测试和全量测试**

Run:

```powershell
npm --workspace client test -- --run src/test/document-recycle.test.jsx src/test/admin-pages.test.jsx
npm --workspace client test
```

Expected: 新测试与既有 14 项前端测试全部 PASS。

- [ ] **Step 7: 提交管理员资料管理界面**

```powershell
git add client/src/pages/DocumentRecycleBinPage.jsx client/src/test/document-recycle.test.jsx client/src/App.jsx client/src/layout/AppLayout.jsx client/src/pages/OperationLogsPage.jsx client/src/pages/DashboardPage.jsx
git commit -m "feat: add admin document recycle interface"
```

---

### Task 7: 文档、完整验证与局域网重新部署

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `用户操作说明书.md`

**Interfaces:**
- Produces: 可执行的局域网升级、备份和服务器迁移说明。
- Produces: 真实生产构建下的公共资料完整冒烟验证结果。

- [ ] **Step 1: 补充运行目录忽略规则**

在 `.gitignore` 增加：

```gitignore
data/uploads/
```

上传根目录内的 `.tmp` 和 `.trash` 因父目录整体忽略，不会进入 Git。若生产 `UPLOAD_DIR` 指向项目外部，则由服务器文件权限和备份策略管理。

- [ ] **Step 2: 更新 README 配置、备份和迁移说明**

README 必须明确说明：

- `UPLOAD_DIR`、`MAX_UPLOAD_FILE_MB=50`、`MAX_UPLOAD_FILES=10`。
- 数据库和上传目录必须作为同一个备份集合。
- Windows 局域网升级前先停止端口 3001 的旧 Node 进程，再备份数据库与上传目录。
- 服务器迁移时停止写入、执行 SQLite checkpoint、复制数据库与上传目录、配置新路径和权限、运行完整性检查。
- 上线服务器后使用 HTTPS 反向代理，不直接把上传目录映射为静态目录。
- 磁盘空间不足、目录不可写、文件损坏和 50 MB 限制的中文排障步骤。

- [ ] **Step 3: 更新普通用户操作说明书**

增加“公共资料”章节，按非技术用户能理解的步骤说明：

1. 搜索和筛选资料。
2. 选择分类、填写说明、选择文件并上传。
3. 查看逐文件成功或失败结果。
4. 预览 PDF/图片和下载其他文件。
5. 删除自己上传的资料。
6. 管理员在资料回收站恢复或彻底删除。
7. 提醒不要上传包含无关敏感信息或来源不明的压缩包。

- [ ] **Step 4: 运行完整自动化验证**

Run:

```powershell
npm test
npm run build
npm audit --audit-level=high
```

Expected: 所有后端和前端测试 PASS；Vite 生产构建 exit 0；高危漏洞为 0。

- [ ] **Step 5: 执行真实生产服务冒烟验证**

在明确的项目工作树目录中：

```powershell
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { Stop-Process -Id $listener.OwningProcess }
npm start
```

使用测试文件依次验证：

- 管理员和销售均能打开 `/documents`。
- 销售上传 PDF 和 TXT，列表显示正确分类、上传人和大小。
- PDF 可预览，TXT 只能下载。
- 另一销售不能删除该资料。
- 上传者软删除后普通列表不再显示。
- 管理员在资料回收站恢复，再次删除并彻底删除。
- 操作日志出现上传、删除、恢复和彻底删除四种中文动作。
- `http://192.168.2.34:3001` 返回 200，监听地址为 `0.0.0.0:3001`，防火墙规则仍限制 `LocalSubnet`。

冒烟测试创建的资料必须通过系统界面或接口按权限清理，不直接删除数据库行；保留的操作日志属于预期审计记录。

- [ ] **Step 6: 检查迁移完整性与工作区状态**

运行只读校验脚本，逐条确认未删除和回收站资料的 `storage_key` 文件存在且 SHA-256 匹配；输出记录数、文件数、缺失数和摘要不匹配数，不输出文件内容。然后运行：

```powershell
git diff --check
git status --short
```

Expected: 完整性校验缺失数 0、摘要不匹配数 0；仅出现本任务预期文档改动。

- [ ] **Step 7: 提交文档并保留生产服务运行**

```powershell
git add .gitignore README.md 用户操作说明书.md
git commit -m "docs: add document library operations guide"
git status --short
```

Expected: 工作树干净，生产服务继续在配置端口运行。

---

## Final Review Gate

完成 Task 1-7 后，重新逐项对照 `docs/superpowers/specs/2026-08-29-public-documents-design.md`：

- 所有 API 和页面均有自动化测试证据。
- 文件数量、大小、类型和内容特征均由后端校验。
- 文件系统失败与数据库失败均有补偿路径测试。
- 销售、上传者、其他销售和管理员权限矩阵全部覆盖。
- 资料回收站、永久删除和不可删除审计日志形成闭环。
- 局域网访问、生产构建、备份和服务器迁移说明可执行。

最终必须使用 `superpowers:verification-before-completion` 运行新鲜验证，不得用先前测试结果代替。
