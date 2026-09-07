import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';

function invalidDocumentUploadError() {
  return Object.assign(new Error('资料上传请求格式不正确'), { code: 'INVALID_DOCUMENT_UPLOAD' });
}

export function parseDocumentUpload(req, { storage, maxFiles, maxFileBytes }) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const candidates = [];
    const rejected = [];
    const createdPaths = new Set();
    const activeStreams = new Set();
    const jobs = [];
    let parser;
    let parsingFinished = false;
    let failure;
    let finalizing = false;
    let settled = false;

    async function removeCreatedFiles() {
      await Promise.allSettled([...createdPaths].map(tempPath => storage.removeTemp(tempPath)));
    }

    async function finish() {
      if (settled || finalizing || (!parsingFinished && !failure)) return;
      finalizing = true;
      await Promise.allSettled(jobs);
      if (failure) {
        await removeCreatedFiles();
        settled = true;
        reject(failure);
        return;
      }
      settled = true;
      resolve({ fields, candidates, rejected });
    }

    function fail(error) {
      if (failure || settled) return;
      failure = error instanceof Error ? error : new Error(String(error));
      failure.closeConnection = true;
      req.unpipe(parser);
      req.resume();
      for (const stream of activeStreams) stream.destroy(failure);
      void finish();
    }

    try {
      parser = Busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: { files: maxFiles, fileSize: maxFileBytes, fields: 2, parts: maxFiles + 3 }
      });
    } catch (error) {
      const uploadError = invalidDocumentUploadError();
      uploadError.closeConnection = true;
      req.resume();
      reject(uploadError);
      return;
    }

    parser.on('field', (name, value) => {
      if (name === 'category' || name === 'description') fields[name] = value;
    });

    parser.on('file', (fieldName, file, info) => {
      const originalName = info.filename;
      if (fieldName !== 'files') {
        rejected.push({ originalName, code: 'INVALID_UPLOAD_FIELD' });
        file.resume();
        return;
      }

      let tempPath;
      let writer;
      try {
        tempPath = storage.createTempPath();
        writer = createWriteStream(tempPath, { flags: 'wx' });
      } catch (error) {
        file.resume();
        fail(error);
        return;
      }
      createdPaths.add(tempPath);
      activeStreams.add(file);
      activeStreams.add(writer);
      let tooLarge = false;

      file.once('limit', () => {
        tooLarge = true;
      });

      const job = pipeline(file, writer)
        .then(async () => {
          if (tooLarge) {
            await storage.removeTemp(tempPath);
            rejected.push({ originalName, code: 'FILE_TOO_LARGE' });
          } else {
            candidates.push({ originalName, reportedMime: info.mimeType, tempPath });
          }
        })
        .catch(fail)
        .finally(() => {
          activeStreams.delete(file);
          activeStreams.delete(writer);
        });
      jobs.push(job);
    });

    parser.once('filesLimit', () => {
      fail(Object.assign(new Error('资料上传文件数量超过限制'), { code: 'LIMIT_FILE_COUNT' }));
    });
    parser.once('fieldsLimit', () => {
      fail(Object.assign(new Error('资料上传字段超过限制'), { code: 'INVALID_DOCUMENT_UPLOAD' }));
    });
    parser.once('partsLimit', () => {
      fail(Object.assign(new Error('资料上传内容段超过限制'), { code: 'INVALID_DOCUMENT_UPLOAD' }));
    });
    parser.once('error', () => fail(invalidDocumentUploadError()));
    parser.once('finish', () => {
      parsingFinished = true;
      void finish();
    });
    req.once('aborted', () => fail(new Error('上传请求已中止')));
    req.once('error', fail);
    req.pipe(parser);
  });
}
