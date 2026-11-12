import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openController } from './storage.mjs';

process.umask(0o077);
let controller;
try { controller = await openController(fileURLToPath(new URL('../', import.meta.url))); }
catch (error) { console.error(error.status ? error.message : 'Kakuoku: помощнику нужны Node.js 24+, локальный Docker и доступ к его socket.'); process.exit(1); }
const token = randomBytes(32).toString('hex');
const origins = new Set(['http://127.0.0.1:3101', 'http://localhost:3101']);
const hosts = new Set(['127.0.0.1:3102', 'localhost:3102']);
const server = createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  try {
    if (!hosts.has(req.headers.host) || !origins.has(req.headers.origin)) return json({ error: 'Недопустимый источник запроса.' }, 403);
    res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST');
      res.setHeader('access-control-allow-headers', 'content-type, x-kakuoku-control-token');
      res.writeHead(204); res.end(); return;
    }
    const path = new URL(req.url, 'http://127.0.0.1:3102').pathname;
    if (req.method === 'GET' && path === '/storage') return json({ token, ...await controller.status() });
    const provided = Buffer.from(String(req.headers['x-kakuoku-control-token'] || ''));
    if (provided.length !== Buffer.byteLength(token) || !timingSafeEqual(provided, Buffer.from(token))) return json({ error: 'Обновите подключение к помощнику.' }, 403);
    if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') return json({ error: 'Ожидается JSON-запрос.' }, 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) return json({ error: 'Слишком большой запрос.' }, 413); chunks.push(chunk); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ error: 'Некорректный JSON.' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Ожидается объект.' }, 400);
    if (path === '/storage/plan' && Object.keys(data).length === 1) return json({ plan: await controller.plan(data.destination) });
    if (path === '/storage/move' && Object.keys(data).length === 1) return json({ job: await controller.start(data.id) }, 202);
    if (path === '/storage/recover' && Object.keys(data).length === 0) return json({ job: await controller.recover() }, 202);
    return json({ error: 'Неизвестная операция.' }, 404);
  } catch (error) { json({ error: error.status ? error.message : 'Помощник не смог выполнить операцию. Данные не удалены.' }, error.status || 500); }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.maxHeadersCount = 32;
server.listen(3102, '127.0.0.1', () => console.log('Kakuoku: локальный помощник запущен на 127.0.0.1:3102.'));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Kakuoku: порт помощника уже занят.' : 'Kakuoku: не удалось запустить помощник.'); process.exitCode = 1; });
