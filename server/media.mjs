import { constants, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { openPosters, renderFrame } from './posters.mjs';

export const mediaLimits = { fileBytes: 128 * 1024 * 1024, messageFiles: 4, storedBytes: 2 * 1024 ** 3, pendingPerNote: 16, concurrentUploads: 2 };
export const mediaTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/ogg', 'audio/opus', 'audio/webm'];
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }

async function detect(header) {
  return new Promise((resolveResult, reject) => {
    const worker = spawn(resolve(appRoot, 'server/bin/kakuoku-media-sandbox'), [
      process.execPath,
      '--max-old-space-size=32', '--permission',
      `--allow-fs-read=${resolve(appRoot, 'server/media-sniff.mjs')}`,
      `--allow-fs-read=${resolve(appRoot, 'package.json')}`,
      `--allow-fs-read=${resolve(appRoot, 'node_modules')}`,
      resolve(appRoot, 'server/media-sniff.mjs'),
    ], { cwd: '/', env: {}, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => worker.kill('SIGKILL'), 5000);
    worker.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024) worker.kill('SIGKILL');
    });
    worker.stdin.on('error', () => {});
    worker.on('error', () => { clearTimeout(timer); reject(Object.assign(new Error('Проверка медиа недоступна.'), { status: 503 })); });
    worker.on('close', code => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(output); } catch { /* Reject failed or timed-out inspection. */ }
      if (code === 125) reject(Object.assign(new Error('Linux/Docker не разрешает безопасную проверку медиа (Landlock/seccomp).'), { status: 503 }));
      else if (code !== 0 || output.length > 1024 || (output !== 'null' && (!result || typeof result.mime !== 'string'))) reject(Object.assign(new Error('Сбой безопасного обработчика медиа. Файл не проверен; попробуйте загрузить снова.'), { status: 503 }));
      else if (!mediaTypes.includes(result?.mime)) reject(Object.assign(new Error('Формат файла не поддерживается. Доступны PNG, JPEG, WebP, GIF, MP4/WebM и аудио MP3, M4A, WAV, FLAC, Ogg/Opus.'), { status: 415 }));
      else resolveResult(result.mime);
    });
    worker.stdin.end(header);
  });
}

export function byteRange(value, size) {
  if (value === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}
assert.deepEqual(byteRange('bytes=-2', 10), { start: 8, end: 9, partial: true });
assert.equal(byteRange('bytes=10-', 10), null);
assert.equal(byteRange('bytes=0-1,4-5', 10), null);

export function openMedia(directory, store) {
  const folder = resolve(directory, 'media');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (lstatSync(folder).isSymbolicLink() || realpathSync(folder) !== folder) throw new Error('Каталог медиа не может быть symlink.');
  const posters = openPosters(folder, store);
  let active = 0;
  let imageJobs = 0;
  function filename(id) {
    if (!idPattern.test(id)) fail(400, 'Некорректный ID вложения.');
    return resolve(folder, id);
  }
  async function upload(req, noteId, id) {
    const path = filename(id);
    if (store.db.prepare('SELECT 1 FROM media_files WHERE id=?').get(id)) fail(409, 'Этот ID уже загружен. Получите список вложений заметки.');
    if (active >= mediaLimits.concurrentUploads) fail(429, 'Дождитесь завершения других загрузок.');
    if (store.db.prepare('SELECT count(*) n FROM media_files f WHERE note_id=? AND NOT EXISTS(SELECT 1 FROM media_attachments a WHERE a.file_id=f.id)').get(noteId).n >= mediaLimits.pendingPerNote) fail(409, 'Сначала отправьте или удалите неотправленные вложения.');
    if (req.headers['content-type'] !== 'application/octet-stream') fail(415, 'Ожидается application/octet-stream.');
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > mediaLimits.fileBytes)) fail(413, 'Файл превышает 128 МиБ.');
    let name;
    try { name = decodeURIComponent(req.headers['x-kakuoku-filename'] || 'Вложение'); } catch { fail(400, 'Некорректное имя файла.'); }
    if (!name || name.length > 200) fail(400, 'Имя файла: от 1 до 200 символов.');
    name = name.replace(/[\x00-\x1f\x7f/\\]/g, '_');
    let file, committed = false, size = 0;
    const hash = createHash('sha256');
    active++;
    const timer = setTimeout(() => req.destroy(), 120_000);
    try {
      try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') fail(409, 'ID файла уже занят. Выберите новый UUID; существующий файл сохранён.');
        throw error;
      }
      const chunks = []; let headerSize = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > mediaLimits.fileBytes) fail(413, 'Файл превышает 128 МиБ.');
        hash.update(chunk);
        if (headerSize < 65_536) {
          const part = chunk.subarray(0, 65_536 - headerSize);
          chunks.push(part); headerSize += part.length;
        }
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await file.write(chunk, offset);
          if (!bytesWritten) throw new Error('Failed to write media.');
          offset += bytesWritten;
        }
      }
      if (size < 16) fail(415, 'Файл слишком короткий для медиа.');
      const mime = await detect(Buffer.concat(chunks));
      await file.sync();
      const directory = await open(folder, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
      const sha256 = hash.digest('hex');
      store.db.exec('BEGIN IMMEDIATE');
      try {
        if (!store.note(noteId)) fail(404, 'Заметка удалена.');
        if (store.db.prepare('SELECT coalesce(sum(size),0) size FROM media_files').get().size + size > mediaLimits.storedBytes) fail(413, 'Достигнут лимит медиа: 2 ГиБ.');
        store.db.prepare('INSERT INTO media_files VALUES(?,?,?,?,?,?,?)').run(id, noteId, name, mime, size, sha256, new Date().toISOString());
        store.db.exec('COMMIT'); committed = true;
      } catch (error) { store.db.exec('ROLLBACK'); throw error; }
      return { id, name, mime, size, sha256, analysis: mime.startsWith('image/') ? 'not-requested' : 'unavailable' };
    } finally {
      clearTimeout(timer); active--;
      await file?.close();
      // Only remove this request's incomplete file; never clean saved data on startup.
      if (file && !committed) await unlink(path).catch(() => {});
    }
  }
  function pending(noteId) {
    return store.db.prepare('SELECT id,name,mime,size,sha256 FROM media_files f WHERE note_id=? AND NOT EXISTS(SELECT 1 FROM media_attachments a WHERE a.file_id=f.id)').all(noteId);
  }
  async function imageForModel(noteId, attachmentId) {
    filename(attachmentId);
    const row = store.db.prepare(`SELECT f.id,f.size,f.mime FROM media_files f
      JOIN media_attachments a ON a.file_id=f.id JOIN messages m ON m.id=a.message_id
      WHERE a.id=? AND m.note_id=?`).get(attachmentId, noteId);
    const legacy = row ? null : store.db.prepare(`SELECT a.mime,a.data FROM attachments a
      JOIN messages m ON m.id=a.message_id WHERE a.id=? AND m.note_id=?`).get(attachmentId, noteId);
    if (!row && !legacy) fail(404, 'Изображение не принадлежит текущей заметке.');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes((row || legacy).mime)) fail(415, 'Для анализа доступны PNG, JPEG, WebP и первый кадр GIF.');
    if (imageJobs >= 2) fail(429, 'Дождитесь завершения обработки других изображений.');
    imageJobs++;
    let input, output, temporary;
    try {
      if (legacy) {
        if (legacy.data.length > mediaLimits.fileBytes) fail(413, 'Изображение превышает лимит обработки.');
        const path = resolve(folder, `${randomUUID()}.vision.part`);
        output = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        temporary = path;
        await output.writeFile(legacy.data); await output.close(); output = null;
      }
      input = await open(temporary || filename(row.id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await input.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== (row ? row.size : legacy.data.length) || stat.size > mediaLimits.fileBytes) fail(409, 'Исходное изображение повреждено.');
      return await renderFrame(input, true);
    } finally {
      await input?.close(); await output?.close();
      if (temporary) await unlink(temporary).catch(() => {});
      imageJobs--;
    }
  }
  async function discard(noteId, id) {
    filename(id);
    const row = store.db.prepare('SELECT id FROM media_files WHERE id=? AND note_id=?').get(id, noteId);
    if (!row) fail(404, 'Вложение не найдено.');
    if (store.db.prepare('SELECT 1 FROM media_attachments WHERE file_id=?').get(id)) fail(409, 'Отправленное вложение нельзя удалить отдельно от сообщения.');
    await unlink(filename(id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    store.db.prepare('DELETE FROM media_files WHERE id=?').run(id);
  }
  async function removeNote(noteId, revision) {
    const candidates = store.db.prepare(`SELECT id FROM media_files WHERE note_id=? UNION
      SELECT a.file_id id FROM media_attachments a JOIN messages m ON m.id=a.message_id WHERE m.note_id=?`).all(noteId, noteId);
    store.remove(noteId, revision);
    let retained = 0;
    for (const { id } of candidates) {
      if (store.db.prepare('SELECT 1 FROM media_attachments WHERE file_id=?').get(id)) continue;
      try {
        await posters.remove(id);
        await unlink(filename(id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        store.db.prepare('DELETE FROM media_files WHERE id=?').run(id);
      } catch { retained++; }
    }
    return retained ? { warning: 'Заметка удалена, но часть файлов не удалось удалить с диска.' } : {};
  }
  async function send(req, res, id) {
    filename(id);
    const row = store.db.prepare(`SELECT f.*,a.id attachment_id FROM media_files f JOIN media_attachments a ON a.file_id=f.id WHERE a.id=?`).get(id);
    const legacy = row ? null : store.db.prepare('SELECT name,mime,data FROM attachments WHERE id=?').get(id);
    if (!row && !legacy) fail(404, 'Вложение не найдено.');
    const item = row || legacy;
    let file;
    try {
      if (row) {
        file = await open(filename(row.id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== row.size) fail(409, 'Файл вложения повреждён.');
      }
      const size = row ? row.size : legacy.data.length;
      const range = byteRange(req.headers.range, size);
      res.setHeader('accept-ranges', 'bytes');
      res.setHeader('cache-control', 'no-store');
      if (!range) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return;
      }
      const { start, end, partial } = range;
      res.setHeader('content-type', item.mime);
      res.setHeader('content-security-policy', "default-src 'none'; sandbox");
      res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(item.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`);
      res.setHeader('content-length', end - start + 1);
      if (partial) res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
      res.writeHead(partial ? 206 : 200);
      if (req.method === 'HEAD') { res.end(); return; }
      await pipeline(row ? file.createReadStream({ start, end, autoClose: false }) : Readable.from([legacy.data.subarray(start, end + 1)]), res);
    } finally { await file?.close(); }
  }
  return { upload, pending, discard, removeNote, send, preview: posters.send, imageForModel };
}
