import express from 'express';
import contentDisposition from 'content-disposition';
import { AppError } from '../errors.js';
import { nowIso, withTransaction } from '../db.js';
import { inspectDocumentFile, PREVIEW_MIME_TYPES, validateCategory, validateDescription } from '../documents/fileTypes.js';
import { parseDocumentUpload } from '../documents/uploadParser.js';
import { writeOperationLog } from './logs.js';

const allowedRoles = new Set(['admin', 'sales']);
const filenameControlCharacters = /[\u0000-\u001F\u007F-\u009F]/g;

function normalizeMultipartFilename(value) {
  return String(value || '').replace(filenameControlCharacters, '');
}

function parsePositiveInteger(value, fallback, { max } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (max && parsed > max)) {
    throw new AppError(400, 'VALIDATION_ERROR', '分页参数不正确');
  }
  return parsed;
}

function parseDocumentId(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AppError(400, 'INVALID_DOCUMENT_ID', '资料 ID 不正确');
  }
  return parsed;
}

function requireAdmin(req) {
  if (req.user?.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '只有管理员可以执行此操作');
}

function documentNotFound() {
  return new AppError(404, 'DOCUMENT_NOT_FOUND', '资料不存在');
}

function documentFileMissing() {
  return new AppError(404, 'DOCUMENT_FILE_MISSING', '资料文件不存在或已损坏');
}

function getActiveDocument(db, id) {
  return db.prepare(`SELECT d.*, u.display_name uploader_name
    FROM public_documents d
    JOIN users u ON u.id = d.uploaded_by
    WHERE d.id = ? AND d.deleted_at IS NULL`).get(id);
}

function getDocument(db, id) {
  return db.prepare(`SELECT d.*, u.display_name uploader_name
    FROM public_documents d
    JOIN users u ON u.id = d.uploaded_by
    WHERE d.id = ?`).get(id);
}

function mapDocument(row) {
  const document = {
    id: Number(row.id),
    originalName: row.original_name,
    category: row.category,
    description: row.description,
    extension: row.extension,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedBy: Number(row.uploaded_by),
    uploaderName: row.uploader_name,
    createdAt: row.created_at,
    previewable: PREVIEW_MIME_TYPES.has(row.mime_type)
  };
  if (row.deleted_at !== undefined) {
    document.deletedAt = row.deleted_at;
    document.deletedBy = row.deleted_by === null ? null : Number(row.deleted_by);
    document.deletedByName = row.deleted_by_name || null;
  }
  return document;
}

function documentFilters(query) {
  const page = parsePositiveInteger(query.page, 1);
  const pageSize = parsePositiveInteger(query.pageSize, 20, { max: 100 });
  const keyword = String(query.keyword || '').trim();
  const category = query.category === undefined || query.category === ''
    ? null
    : validateCategory(query.category);
  const uploaderId = query.uploaderId === undefined || query.uploaderId === ''
    ? null
    : parsePositiveInteger(query.uploaderId);
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(d.original_name LIKE ? OR d.description LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (category) {
    where.push('d.category = ?');
    params.push(category);
  }
  if (uploaderId) {
    where.push('d.uploaded_by = ?');
    params.push(uploaderId);
  }
  return { page, pageSize, where, params };
}

function listDocuments(db, query, { deleted }) {
  const { page, pageSize, where, params } = documentFilters(query);
  const deletedClause = deleted ? 'd.deleted_at IS NOT NULL' : 'd.deleted_at IS NULL';
  const filter = where.length ? ` AND ${where.join(' AND ')}` : '';
  const from = `FROM public_documents d
    JOIN users u ON u.id = d.uploaded_by
    LEFT JOIN users du ON du.id = d.deleted_by
    WHERE ${deletedClause}${filter}`;
  const total = Number(db.prepare(`SELECT count(*) total ${from}`).get(...params).total);
  const orderBy = deleted ? 'd.deleted_at DESC, d.id DESC' : 'd.created_at DESC, d.id DESC';
  const items = db.prepare(`SELECT d.id, d.original_name, d.category, d.description, d.extension, d.mime_type,
      d.size_bytes, d.uploaded_by, d.created_at, d.deleted_at, d.deleted_by,
      u.display_name uploader_name, du.display_name deleted_by_name
    ${from}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map(mapDocument);
  return { items, pagination: { page, pageSize, total } };
}

function operationDetails(document) {
  return {
    documentId: Number(document.id),
    originalName: document.original_name,
    category: document.category,
    sizeBytes: Number(document.size_bytes),
    sha256: document.sha256,
    uploadedBy: Number(document.uploaded_by)
  };
}

async function sendDocumentFile({ db, storage, req, res, next, preview }) {
  try {
    const id = parseDocumentId(req.params.id);
    const document = getActiveDocument(db, id);
    if (!document) throw documentNotFound();
    if (preview && !PREVIEW_MIME_TYPES.has(document.mime_type)) {
      throw new AppError(400, 'PREVIEW_NOT_SUPPORTED', '该类型资料不支持在线预览，请下载后查看');
    }
    if (!await storage.exists(document.storage_key)) throw documentFileMissing();
    let stat;
    try {
      stat = await storage.stat(document.storage_key);
    } catch (error) {
      if (error?.code === 'ENOENT') throw documentFileMissing();
      throw error;
    }
    const disposition = contentDisposition(document.original_name, {
      type: preview ? 'inline' : 'attachment'
    });
    let stream;
    try {
      stream = storage.createReadStream(document.storage_key);
    } catch (error) {
      if (error?.code === 'ENOENT') throw documentFileMissing();
      throw error;
    }
    let opened = false;
    stream.once('error', error => {
      if (opened || res.headersSent) return res.destroy(error);
      next(error?.code === 'ENOENT' ? documentFileMissing() : error);
    });
    stream.once('open', () => {
      opened = true;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', document.mime_type);
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Content-Disposition', disposition);
      stream.pipe(res);
    });
  } catch (error) {
    next(error);
  }
}

function rejectedUploadRow(rejected, limits) {
  const messages = {
    FILE_TOO_LARGE: '文件超过单个资料大小限制',
    INVALID_UPLOAD_FIELD: '资料上传字段不正确',
    TOO_MANY_FILES: `单次最多上传 ${limits.maxUploadFiles} 个文件`
  };
  return {
    ...(rejected.originalName ? { originalName: normalizeMultipartFilename(rejected.originalName) } : {}),
    type: 'error',
    message: messages[rejected.code] || '资料上传失败，请稍后重试'
  };
}

function insertDocumentAndLog({ db, actor, candidate, inspected, saved, category, description }) {
  const createdAt = nowIso();
  const result = db.prepare(`INSERT INTO public_documents
    (original_name, storage_key, category, description, extension, mime_type, size_bytes, sha256, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      candidate.originalName,
      saved.storageKey,
      category,
      description,
      inspected.extension,
      inspected.mimeType,
      inspected.sizeBytes,
      inspected.sha256,
      actor.id,
      createdAt
    );
  const document = {
    id: Number(result.lastInsertRowid),
    originalName: candidate.originalName,
    category,
    description,
    extension: inspected.extension,
    mimeType: inspected.mimeType,
    sizeBytes: inspected.sizeBytes,
    uploadedBy: actor.id,
    uploaderName: actor.displayName,
    createdAt,
    previewable: inspected.previewable
  };
  writeOperationLog(db, {
    actor,
    action: 'document_upload',
    details: {
      documentId: document.id,
      originalName: document.originalName,
      category: document.category,
      sizeBytes: document.sizeBytes,
      sha256: inspected.sha256
    },
    createdAt
  });
  return document;
}

function businessUploadMessage(error) {
  if (error instanceof AppError) return error.message;
  if (error?.code === 'ENOSPC') return '磁盘空间不足，资料上传失败';
  console.error(error);
  return '资料上传失败，请稍后重试';
}

function logCleanupFailure(error) {
  console.error('资料上传补偿清理失败', {
    name: error?.name || 'Error',
    code: error?.code || 'UNKNOWN'
  });
}

async function settleCleanupOperations(operations) {
  const results = await Promise.allSettled(operations.map(operation => Promise.resolve().then(operation)));
  for (const result of results) {
    if (result.status === 'rejected') logCleanupFailure(result.reason);
  }
  return results;
}

async function removeCandidateTemps(storage, candidates) {
  await settleCleanupOperations(candidates.map(candidate => () => storage.removeTemp(candidate.tempPath)));
}

async function cleanupCandidate(storage, candidate, saved) {
  const operations = [() => storage.removeTemp(candidate.tempPath)];
  if (saved) operations.push(() => storage.remove(saved.storageKey));
  await settleCleanupOperations(operations);
}

export function documentsRouter({ db, requireAuth, storage, limits }) {
  const router = express.Router();
  const purgesInProgress = new Set();
  router.use(requireAuth);
  router.use((req, _res, next) => {
    if (!allowedRoles.has(req.user?.role)) return next(new AppError(403, 'FORBIDDEN', '没有权限执行此操作'));
    next();
  });

  router.get('/', (req, res, next) => {
    try {
      const data = listDocuments(db, req.query, { deleted: false });
      const uploaders = db.prepare(`SELECT DISTINCT d.uploaded_by id, u.display_name
        FROM public_documents d
        JOIN users u ON u.id = d.uploaded_by
        WHERE d.deleted_at IS NULL
        ORDER BY u.display_name, d.uploaded_by`)
        .all()
        .map(row => ({ id: Number(row.id), displayName: row.display_name }));
      res.json({ data: { ...data, facets: { uploaders } } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/recycle', (req, res, next) => {
    try {
      requireAdmin(req);
      res.json({ data: listDocuments(db, req.query, { deleted: true }) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/preview', (req, res, next) => {
    sendDocumentFile({ db, storage, req, res, next, preview: true });
  });

  router.get('/:id/download', (req, res, next) => {
    sendDocumentFile({ db, storage, req, res, next, preview: false });
  });

  router.post('/', async (req, res, next) => {
    let parsed;
    try {
      parsed = await parseDocumentUpload(req, {
        storage,
        maxFiles: limits.maxUploadFiles,
        maxFileBytes: limits.maxUploadFileBytes
      });
    } catch (error) {
      if (error?.closeConnection) {
        res.shouldKeepAlive = false;
        res.setHeader('Connection', 'close');
      }
      if (error?.code === 'INVALID_DOCUMENT_UPLOAD' || error?.code === 'LIMIT_FILE_COUNT') {
        error.documentUpload = true;
        error.maxUploadFiles = limits.maxUploadFiles;
        next(error);
      } else if (error?.code === 'ENOSPC') {
        next(new AppError(507, 'INSUFFICIENT_STORAGE', '磁盘空间不足，资料上传失败'));
      } else {
        next(error);
      }
      return;
    }

    let category;
    let description;
    try {
      category = validateCategory(parsed.fields.category);
      description = validateDescription(parsed.fields.description);
    } catch (error) {
      await removeCandidateTemps(storage, parsed.candidates);
      next(error);
      return;
    }

    const rows = parsed.rejected.map(rejected => rejectedUploadRow(rejected, limits));
    if (!parsed.candidates.length && !rows.length) {
      next(new AppError(400, 'FILE_REQUIRED', '请选择要上传的资料'));
      return;
    }

    let responseStatus;
    let data;
    try {
      for (const candidate of parsed.candidates) {
        const normalizedCandidate = {
          ...candidate,
          originalName: normalizeMultipartFilename(candidate.originalName)
        };
        let saved;
        try {
          if (normalizedCandidate.originalName.includes('\uFFFD')) {
            throw new AppError(400, 'INVALID_FILENAME_ENCODING', '资料文件名编码不正确');
          }
          if (!normalizedCandidate.originalName) {
            throw new AppError(400, 'INVALID_FILENAME', '资料文件名不正确');
          }
          const inspected = await inspectDocumentFile({
            path: candidate.tempPath,
            originalName: normalizedCandidate.originalName,
            reportedMime: candidate.reportedMime
          });
          saved = await storage.commit(candidate.tempPath, inspected.extension);
          const document = withTransaction(db, () => insertDocumentAndLog({
            db,
            actor: req.user,
            candidate: normalizedCandidate,
            inspected,
            saved,
            category,
            description
          }));
          rows.push({ originalName: normalizedCandidate.originalName, type: 'success', document });
        } catch (error) {
          await cleanupCandidate(storage, candidate, saved);
          rows.push({ originalName: normalizedCandidate.originalName, type: 'error', message: businessUploadMessage(error) });
        }
      }

      const success = rows.filter(row => row.type === 'success').length;
      data = { total: rows.length, success, failed: rows.length - success, rows };
      responseStatus = success ? 201 : 200;
    } finally {
      await removeCandidateTemps(storage, parsed.candidates);
    }
    res.status(responseStatus).json({ data });
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const id = parseDocumentId(req.params.id);
      const result = withTransaction(db, () => {
        const document = getDocument(db, id);
        if (!document) throw documentNotFound();
        if (document.deleted_at) {
          throw new AppError(409, 'DOCUMENT_ALREADY_DELETED', '资料已在回收站中');
        }
        if (req.user.role === 'sales' && Number(document.uploaded_by) !== Number(req.user.id)) {
          throw new AppError(403, 'FORBIDDEN', '只能删除自己上传的资料');
        }
        const deletedAt = nowIso();
        const updated = db.prepare(`UPDATE public_documents
          SET deleted_at = ?, deleted_by = ?
          WHERE id = ? AND deleted_at IS NULL`).run(deletedAt, req.user.id, id);
        if (updated.changes !== 1) {
          throw new AppError(409, 'DOCUMENT_ALREADY_DELETED', '资料已在回收站中');
        }
        writeOperationLog(db, {
          actor: req.user,
          action: 'document_delete',
          details: operationDetails(document),
          createdAt: deletedAt
        });
        return { id, deletedAt, deletedBy: Number(req.user.id) };
      });
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/restore', (req, res, next) => {
    try {
      requireAdmin(req);
      const id = parseDocumentId(req.params.id);
      const result = withTransaction(db, () => {
        const document = getDocument(db, id);
        if (!document) throw documentNotFound();
        if (!document.deleted_at) {
          throw new AppError(409, 'DOCUMENT_NOT_DELETED', '资料不在回收站中');
        }
        const restored = db.prepare(`UPDATE public_documents
          SET deleted_at = NULL, deleted_by = NULL
          WHERE id = ? AND deleted_at IS NOT NULL`).run(id);
        if (restored.changes !== 1) {
          throw new AppError(409, 'DOCUMENT_NOT_DELETED', '资料不在回收站中');
        }
        writeOperationLog(db, {
          actor: req.user,
          action: 'document_restore',
          details: operationDetails(document),
          createdAt: nowIso()
        });
        return { id };
      });
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id/purge', async (req, res, next) => {
    let staged;
    let databaseCommitted = false;
    let purgeLockAcquired = false;
    let id;
    try {
      requireAdmin(req);
      id = parseDocumentId(req.params.id);
      if (purgesInProgress.has(id)) {
        throw new AppError(409, 'DOCUMENT_PURGE_IN_PROGRESS', '资料正在彻底删除，请勿重复操作');
      }
      purgesInProgress.add(id);
      purgeLockAcquired = true;
      const initial = getDocument(db, id);
      if (!initial) throw documentNotFound();
      if (!initial.deleted_at) {
        throw new AppError(409, 'DOCUMENT_NOT_DELETED', '只能彻底删除回收站中的资料');
      }
      try {
        staged = await storage.stageRemoval(initial.storage_key);
      } catch (error) {
        if (error?.code === 'ENOENT') throw documentFileMissing();
        throw error;
      }

      withTransaction(db, () => {
        const document = getDocument(db, id);
        if (!document) throw documentNotFound();
        if (!document.deleted_at || document.storage_key !== initial.storage_key) {
          throw new AppError(409, 'DOCUMENT_STATE_CHANGED', '资料状态已变更，请刷新后重试');
        }
        writeOperationLog(db, {
          actor: req.user,
          action: 'document_purge',
          details: operationDetails(document),
          createdAt: nowIso()
        });
        const removed = db.prepare('DELETE FROM public_documents WHERE id = ? AND deleted_at IS NOT NULL').run(id);
        if (removed.changes !== 1) {
          throw new AppError(409, 'DOCUMENT_STATE_CHANGED', '资料状态已变更，请刷新后重试');
        }
      });
      databaseCommitted = true;

      try {
        await storage.finalizeRemoval(staged);
      } catch (error) {
        console.error('资料彻底删除最终清理失败', {
          documentId: id,
          code: error?.code || 'UNKNOWN'
        });
        throw new AppError(500, 'DOCUMENT_PURGE_FINALIZE_FAILED', '资料已隔离，但最终清理失败');
      }
      res.json({ data: { id } });
    } catch (error) {
      if (staged && !databaseCommitted) {
        try {
          await storage.rollbackRemoval(staged);
        } catch (rollbackError) {
          console.error('资料彻底删除回滚失败', {
            code: rollbackError?.code || 'UNKNOWN'
          });
        }
      }
      next(error);
    } finally {
      if (purgeLockAcquired) purgesInProgress.delete(id);
    }
  });

  return router;
}
