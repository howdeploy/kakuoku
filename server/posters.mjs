import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const maximum = 512 * 1024;
const unavailable = message => Object.assign(new Error(message), { status: 503 });
const jpeg = data => data.length > 4 && data[0] === 255 && data[1] === 216 && data.at(-2) === 255 && data.at(-1) === 217;

export function renderFrame(input, image = false) {
  const limit = image ? 1024 * 1024 : maximum;
  return new Promise((resolveResult, reject) => {
    const worker = spawn(fileURLToPath(new URL('./bin/kakuoku-media-sandbox', import.meta.url)), ['/usr/bin/ffmpeg', ...(image ? ['--image'] : [])], { cwd: '/', env: {}, stdio: ['ignore', 'pipe', 'ignore', input.fd] });
    const chunks = []; let bytes = 0;
    const timer = setTimeout(() => worker.kill('SIGKILL'), 15_000);
    worker.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > limit) worker.kill('SIGKILL'); else chunks.push(chunk); });
    worker.on('error', () => { clearTimeout(timer); reject(unavailable('Обработчик медиа недоступен.')); });
    worker.on('close', code => {
      clearTimeout(timer);
      const result = Buffer.concat(chunks);
      if (code !== 0 || bytes > limit || !jpeg(result)) reject(unavailable(image ? 'Не удалось подготовить изображение для модели. Оригинал сохранён.' : 'Не удалось подготовить видеопревью в безопасном обработчике. Видео сохранено.'));
      else resolveResult(result);
    });
  });
}

export function openPosters(folder, store) {
  const jobs = new Map(), failed = new Set();
  let tail = Promise.resolve();
  const filename = id => resolve(folder, `${id}.preview.jpg`);
  async function cached(id) {
    let file;
    try {
      file = await open(filename(id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum) throw unavailable('Небезопасный файл превью.');
      const data = await file.readFile();
      if (!jpeg(data)) throw unavailable('Файл превью повреждён.');
      return data;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    finally { await file?.close(); }
  }
  async function generate(row) {
    let input, temporary, output;
    try {
      input = await open(resolve(folder, row.id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await input.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== row.size || stat.size > 128 * 1024 * 1024) throw unavailable('Исходный файл видео повреждён.');
      const data = await renderFrame(input);
      temporary = resolve(folder, `${randomUUID()}.preview.part`);
      output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await output.writeFile(data); await output.sync(); await output.close(); output = null;
      if (!store.db.prepare('SELECT 1 FROM media_attachments WHERE file_id=?').get(row.id)) throw unavailable('Исходное вложение удалено.');
      await rename(temporary, filename(row.id)); temporary = null;
      return data;
    } finally { await input?.close(); await output?.close(); if (temporary) await unlink(temporary).catch(() => {}); }
  }
  async function get(row) {
    const existing = await cached(row.id);
    if (existing) return existing;
    if (failed.has(row.id)) throw unavailable('Видеопревью недоступно. Оригинал видео сохранён.');
    if (jobs.has(row.id)) return jobs.get(row.id);
    if (jobs.size >= 16) throw unavailable('Очередь видеопревью заполнена.');
    const task = tail.then(() => generate(row)).catch(error => {
      // shortcut: failed decodes retry after server restart; expose manual retry if needed.
      if (failed.size >= 512) failed.delete(failed.values().next().value);
      failed.add(row.id); throw error;
    }).finally(() => jobs.delete(row.id));
    jobs.set(row.id, task); tail = task.catch(() => {});
    return task;
  }
  async function send(req, res, attachmentId) {
    const row = store.db.prepare('SELECT f.* FROM media_files f JOIN media_attachments a ON a.file_id=f.id WHERE a.id=?').get(attachmentId);
    if (!row || !row.mime.startsWith('video/')) throw Object.assign(new Error('Видеовложение не найдено.'), { status: 404 });
    const data = await get(row);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': data.length, 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox" });
    res.end(req.method === 'HEAD' ? undefined : data);
  }
  async function remove(id) {
    await jobs.get(id)?.catch(() => {});
    await unlink(filename(id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    failed.delete(id);
  }
  return { send, remove };
}
