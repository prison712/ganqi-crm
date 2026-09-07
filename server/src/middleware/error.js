import { AppError } from '../errors.js';

export function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', '请求的资源不存在'));
}

export function errorHandler(error, _req, res, _next) {
  if (error.documentUpload) {
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: { code: 'TOO_MANY_FILES', message: `单次最多上传 ${error.maxUploadFiles} 个文件` }
      });
    }
    return res.status(400).json({
      error: { code: 'INVALID_DOCUMENT_UPLOAD', message: '资料上传请求格式不正确' }
    });
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: 'Excel 文件不能超过 5MB' } });
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: { code: 'INVALID_UPLOAD_FIELD', message: '上传字段不正确，请选择一个 .xlsx 文件' } });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求数据不能超过 1MB' } });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: '请求数据格式不正确' } });
  }
  const status = error.status || 500;
  if (status === 500) {
    console.error(error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '服务器开小差了，请稍后重试' }
    });
  }
  res.status(status).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    }
  });
}
