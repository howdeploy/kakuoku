import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { seedDemo } from './demo.mjs';
import * as agent from './agent.mjs';
import { avatarHeads } from '../shared/avatars.mjs';
import { noteColors, notePatterns } from '../shared/appearance.mjs';
import { openSettings, defaults } from './settings.mjs';
import { openMedia, mediaLimits, mediaTypes } from './media.mjs';
import { stopRequests } from './web.mjs';
import { openResearch, researchWindowMs } from './research.mjs';
import { aiModels, imageModel } from '../shared/ai-models.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const demo = process.argv.includes('--demo');
// This flag selects the server mode; only the launch configuration establishes isolation.
if (!demo && process.env.KAKUOKU_PRODUCTION !== '1') throw new Error('Для приложения используйте docker compose up -d. Для дизайн-демки: npm run dev.');
process.umask(0o077);
const directory = demo ? resolve(root, '.data/demo') : '/app/data';
const storageMarker = resolve(directory, '.kakuoku-move.json');
let storageMoveId = existsSync(storageMarker) ? JSON.parse(readFileSync(storageMarker, 'utf8')).id : null;
if (existsSync(storageMarker) && (typeof storageMoveId !== 'string' || !idPattern.test(storageMoveId))) throw new Error('Повреждён маркер переноса. Восстановите операцию через локальный помощник.');
let storagePaused = Boolean(storageMoveId);
const store = openStore(directory);
const media = openMedia(directory, store);
const port = Number(process.env.PORT || 3100);
const token = randomBytes(32).toString('hex');
const settings = openSettings(store.db);
if (demo) seedDemo(store, settings.read().tags);
const research = openResearch(store.db);
const agentEnabled = (config = settings.read()) => !demo && Boolean(config.apiKey) && config.mode !== 'notes';
const sessionInfo = () => ({ token, demo, agentEnabled: agentEnabled(), model: settings.read().model });
const locks = new Set();
const previews = new Map();
const agentWork = new Set();
const deferredCloses = new Map();
function activity() {
  return [...new Set([...agentWork, ...previews.keys(), ...deferredCloses.keys()])].sort().map(noteId => ({ noteId, agentWorking: agentWork.has(noteId), previewPending: previews.has(noteId) || deferredCloses.has(noteId) }));
}
let sortJob = { state: 'idle', message: '' };
const previousJob = store.db.prepare('SELECT body FROM sort_jobs ORDER BY rowid DESC LIMIT 1').get();
if (previousJob) {
  sortJob = JSON.parse(previousJob.body);
  if (sortJob.state === 'running') {
    sortJob.state = 'error'; sortJob.message = 'Сортировка прервана перезапуском. Уже созданные заметки сохранены; можно начать новый запрос.';
    saveSortJob();
  }
}
const colors = noteColors.map(color => color.id);
const patterns = ['none', ...notePatterns.map(pattern => pattern.id)];
const publicPort = demo ? port : Number(process.env.KAKUOKU_PUBLIC_PORT || 3101);
if (![port, publicPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error('Некорректный порт.');
const allowedHosts = new Set([`127.0.0.1:${publicPort}`, `localhost:${publicPort}`, `[::1]:${publicPort}`]);
const http = createServer(handle);
let stopping = false;
let activeRequests = 0;
let vite;
if (demo) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({
    root, appType: 'spa',
    server: {
      middlewareMode: true, ws: { server: http },
      fs: { strict: true, allow: [root], deny: ['**/.data/**', '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**'] },
    },
  });
}

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Ожидается JSON.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 15_000_000) fail(413, 'Сообщение слишком большое: максимум 10 МБ фото.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object') fail(400, 'Ожидается JSON-объект.');
    return value;
  }
  catch { fail(400, 'Некорректный JSON.'); }
}
function getNote(id) {
  if (!idPattern.test(id)) fail(400, 'Некорректный идентификатор.');
  const note = store.note(id);
  if (!note) fail(404, 'Заметка не найдена.');
  return note;
}
async function exclusive(id, fn) {
  if (locks.has(id)) fail(409, 'Агент ещё работает с этой заметкой. Дождитесь завершения.');
  locks.add(id);
  try { getNote(id); return await fn(); } finally {
    locks.delete(id);
    const close = deferredCloses.get(id);
    if (close) {
      deferredCloses.delete(id);
      finishClose(id, close.config).then(close.resolve, close.reject);
    }
  }
}
function metadata(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Ожидается объект.');
  const fields = {};
  if (data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120) fail(400, 'Заголовок: от 1 до 120 символов.');
    fields.title = data.title.trim();
  }
  if (data.color !== undefined) {
    if (!colors.includes(data.color)) fail(400, 'Неизвестный цвет.');
    fields.color = data.color;
  }
  if (data.avatar !== undefined) {
    if (!Number.isInteger(data.avatar) || data.avatar < 0 || data.avatar >= avatarHeads.length) fail(400, 'Неизвестная аватарка.');
    fields.avatar = data.avatar;
  }
  if (data.pattern !== undefined) {
    if (!patterns.includes(data.pattern)) fail(400, 'Неизвестный узор.');
    fields.pattern = data.pattern;
  }
  return fields;
}
function revision(data) {
  if (data.revision !== undefined && (!Number.isSafeInteger(data.revision) || data.revision < 0)) fail(400, 'Некорректная ревизия.');
  return data.revision;
}
function images(items = []) {
  if (!Array.isArray(items) || items.length > 4) fail(400, 'Максимум 4 фото в сообщении.');
  let total = 0;
  return items.map(item => {
    if (typeof item?.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) fail(400, 'Некорректные данные фото.');
    const data = Buffer.from(item.data, 'base64');
    total += data.length;
    if (!data.length || total > 10_000_000) fail(413, 'Максимум 10 МБ фото в сообщении.');
    let mime;
    if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
    else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mime = 'image/jpeg';
    else if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') mime = 'image/webp';
    else fail(400, 'Можно прикрепить только PNG, JPEG или WebP.');
    if (typeof item.name !== 'string' || item.name.length > 200) fail(400, 'Некорректное имя фото.');
    return { data, mime, name: item.name.replace(/[\x00-\x1f/\\]/g, '_') || 'Фото' };
  });
}
function profile() {
  return { avatarVersion: store.db.prepare('SELECT updated_at FROM profile WHERE id=1').get()?.updated_at || null };
}
async function replyTo(id, messageId) {
  if (typeof messageId !== 'string' || !idPattern.test(messageId)) fail(400, 'Некорректный ID сообщения.');
  const note = getNote(id);
  const original = note.messages.find(m => m.id === messageId && m.role === 'user');
  if (!original) fail(404, 'Сообщение не найдено.');
  research.touch(id);
  if (note.messages.some(m => m.reply_to === messageId)) return { note };
  const config = settings.read();
  if (!agentEnabled(config)) return { note, warning: config.mode === 'notes' ? undefined : demo ? 'Мысль сохранена. Это дизайн-демо: GLM не подключён.' : 'Мысль сохранена. Подключите AI в настройках.' };
  const work = research.begin(id, messageId);
  agentWork.add(id);
  try {
    const result = await agent.reply(note, config, { ...work, imageForModel: media.imageForModel });
    // Only title edits may bypass the reply lock; append against their latest revision.
    store.addMessage(id, { text: result.text, role: 'assistant', replyTo: messageId, revision: getNote(id).revision,
      afterSave: () => work.finish(result.outcome, result.outcome === 'complete' ? 'Ответ готов.' : result.outcome === 'partial' ? 'Подготовлен частичный результат.' : 'Исследование завершено без достаточных данных.') });
    return { note: getNote(id) };
  } catch (error) {
    work.finish('error', error.message);
    return { note: getNote(id), warning: error.message, retryMessageId: messageId };
  } finally { agentWork.delete(id); }
}

async function finishClose(id, config) {
  const note = getNote(id);
  if (!note.messages.some(message => message.role === 'user')) return exclusive(id, async () => ({ deleted: true, ...await media.removeNote(id, note.revision) }));
  return summarizeNote(id, config);
}
function closeNote(id) {
  const pending = deferredCloses.get(id);
  if (pending) return pending.promise;
  const config = settings.read();
  if (!locks.has(id)) return finishClose(id, config);
  const task = { config };
  task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
  deferredCloses.set(id, task);
  return task.promise;
}

async function summarizeNote(id, config = settings.read()) {
  const note = getNote(id);
  const enabled = agentEnabled(config);
  const key = enabled ? createHash('sha256').update(JSON.stringify({ format: 'tags:1', tags: config.tags, policy: agent.previewPolicy, prompt: config.prompts.preview, endpoint: config.endpoint, model: config.model })).digest('hex') : 'local:1';
  const pending = previews.get(id);
  if (pending) {
    const result = await pending.promise;
    if (pending.revision === note.revision && pending.key === key) return result;
    return summarizeNote(id, config);
  }
  if (locks.has(id)) fail(409, 'Агент ещё работает с этой заметкой. Дождитесь завершения.');
  if (note.revision === note.summarized_revision && note.summary_key === key) return { note };
  if (!enabled) return { note: store.summarize(id, agent.localPreview(note), note.revision, 'local', key) };
  const task = { revision: note.revision, key };
  task.promise = (async () => {
    try {
      const { summary, tags } = await agent.summarize(note, config);
      const current = store.note(id);
      if (!current) return { deleted: true };
      if (current.revision !== note.revision) return { note: current, warning: 'Заметка изменилась во время подготовки превью. Прежнее превью сохранено; закройте заметку снова для обновления.' };
      return { note: store.summarize(id, summary, note.revision, 'agent', key, tags.filter(tag => settings.read().tags.includes(tag))) };
    } catch (error) {
      const current = store.note(id);
      return current ? { note: current, warning: `${error.message} Прежнее превью оставлено; переписка сохранена.` } : { deleted: true };
    } finally { previews.delete(id); }
  })();
  // Only the snapshot is held during AI; edits remain available and the commit checks its revision.
  previews.set(id, task);
  return task.promise;
}

function saveSortJob() {
  store.db.prepare('INSERT INTO sort_jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(sortJob.id, JSON.stringify(sortJob));
}
async function sortNotes(config, id) {
  sortJob = { id, state: 'running', message: 'Агент читает заметки и ищет общие темы.', created: 0, skipped: 0 };
  try {
    saveSortJob();
    const notes = store.list().map(note => store.note(note.id));
    const groups = notes.length > 1 ? await agent.planMerges(notes, config) : [];
    for (let index = 0; index < groups.length; index++) {
      sortJob.message = `Собирает общую заметку ${index + 1} из ${groups.length}.`;
      saveSortJob();
      const group = groups[index];
      const sources = group.ids.map(id => notes.find(note => note.id === id));
      if (!store.canConsolidate(sources)) {
        sortJob.skipped++;
        saveSortJob();
        continue;
      }
      const merged = await agent.mergeNotes(group, sources, config);
      if (store.consolidate({ ...merged, tags: merged.tags.filter(tag => settings.read().tags.includes(tag)) }, sources)) sortJob.created++;
      else sortJob.skipped++;
      saveSortJob();
    }
    sortJob.state = 'complete';
    sortJob.message = groups.length ? `Создано общих заметок: ${sortJob.created}. Исходные чаты сохранены.${sortJob.skipped ? ` Пропущено уже собранных или изменившихся групп: ${sortJob.skipped}.` : ''}` : 'Заметок с общей темой для объединения не найдено.';
  } catch (error) {
    sortJob.state = 'error';
    sortJob.message = `${error.message}${sortJob.created ? ` Уже создано общих заметок: ${sortJob.created}.` : ''}`;
  } finally {
    try { saveSortJob(); }
    catch { sortJob.state = 'error'; sortJob.message = 'Не удалось сохранить статус сортировки. Проверьте свободное место; созданные заметки сохранены.'; }
  }
}

async function handle(req, res) {
  activeRequests++;
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  try {
    if (stopping) fail(503, 'Сервер завершает работу. Повторите после запуска.');
    if (!allowedHosts.has(req.headers.host)) fail(403, 'Недопустимый Host.');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const documentNavigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' && !path.startsWith('/api/');
    if (req.headers['sec-fetch-site'] === 'cross-site' && !documentNavigation) fail(403, 'Межсайтовый доступ запрещён.');
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && !documentNavigation) fail(403, 'Недопустимый Origin.');
    if (path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-kakuoku-token'] !== token) fail(403, 'Перезагрузите приложение для обновления сессии.');
      if (path === '/api/session' && req.method === 'GET') return json(res, sessionInfo());
      if (path === '/api/storage' && req.method === 'GET') return json(res, { demo, paused: storagePaused, moveId: storageMoveId });
      if (['/api/storage/pause', '/api/storage/resume'].includes(path) && req.method === 'POST') {
        if (demo) fail(409, 'Перенос доступен только для приложения в контейнере.');
        const input = await body(req);
        if (typeof input.id !== 'string' || !idPattern.test(input.id)) fail(400, 'Некорректный ID переноса.');
        if (path.endsWith('/pause')) {
          if (storagePaused && storageMoveId !== input.id) fail(409, 'Уже выполняется другой перенос.');
          if (locks.size || previews.size || deferredCloses.size || sortJob.state === 'running' || activeRequests > 1) fail(409, 'Дождитесь завершения текущих операций приложения.');
          storageMoveId = input.id;
          storagePaused = true;
        } else {
          if (storageMoveId && storageMoveId !== input.id) fail(409, 'ID переноса не совпадает.');
          if (existsSync(storageMarker)) {
            if (JSON.parse(readFileSync(storageMarker, 'utf8')).id !== input.id) fail(409, 'Маркер переноса изменился.');
            unlinkSync(storageMarker);
          }
          storageMoveId = null;
          storagePaused = false;
        }
        return json(res, { paused: storagePaused, moveId: storageMoveId });
      }
      if (storagePaused) fail(503, 'Хранилище переносится. Дождитесь завершения в настройках.');
      if (path === '/api/capabilities' && req.method === 'GET') {
        const config = settings.read(), vision = imageModel(config);
        return json(res, {
          media: { ...mediaLimits, types: mediaTypes, streamingUpload: true, range: true, analysis: 'images', imageAnalysis: { enabled: agentEnabled(config) && aiModels.some(model => model.id === vision && model.vision), types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxImages: 4, maxEdge: 1600, maxBytesPerImage: 1024 * 1024, gif: 'first-frame', model: vision }, gallery: true, videoPreview: 'jpeg', pageSize: 60 },
          agent: { modes: ['chat', 'research', 'notes'], chatScope: 'current-note', sortingScope: 'saved-notes', tools: ['read_url', 'search_web', 'youtube_transcript'], mediaUnderstanding: true, mediaKinds: ['image'], models: aiModels },
          tools: { ...settings.publicSettings().tools, searchProviders: ['builtin', 'tavily', 'brave', 'off'], youtubeProviders: ['local', 'supadata', 'off'], youtubeScope: 'user-links-in-current-note', youtubeUnderstanding: 'captions-only' },
          research: { windowSeconds: researchWindowMs / 1000, finalization: 'finish_research', maxModelCalls: config.researchMaxCalls, minAllowedModelCalls: 4, maxAllowedModelCalls: 12, timeoutSeconds: 660 },
          revisions: 'optional revision on PATCH and messages; If-Match on DELETE',
        });
      }
      if (path === '/api/settings' && req.method === 'GET') return json(res, { settings: settings.publicSettings(), defaults, session: sessionInfo() });
      if (path === '/api/activity' && req.method === 'GET') return json(res, { activity: activity() });
      if (path === '/api/media' && req.method === 'GET') {
        const value = url.searchParams.get('limit');
        if (value !== null && !/^\d{1,2}$/.test(value)) fail(400, 'Некорректный размер страницы медиа.');
        return json(res, store.listMedia({ query: url.searchParams.get('q') || '', cursor: url.searchParams.get('cursor'), limit: value === null ? 60 : Number(value) }));
      }
      if (path === '/api/settings' && req.method === 'PATCH') {
        const input = await body(req);
        const value = store.transaction(() => {
          const saved = settings.save(input);
          if (input.tags !== undefined) store.pruneTags(saved.tags);
          return saved;
        });
        return json(res, { settings: value, session: sessionInfo() });
      }
      if (path === '/api/sort' && req.method === 'GET') return json(res, { job: sortJob });
      if (path === '/api/sort' && req.method === 'POST') {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Ожидается объект.');
        const config = settings.read();
        if (!agentEnabled(config)) return json(res, { job: { state: 'unavailable', message: config.mode === 'notes' ? 'В режиме «Только запись» AI отключён. Выберите другой режим в настройках.' : demo ? 'В дизайн-демо GLM не подключён. Объединение будет доступно с агентом в контейнере.' : 'Подключите AI в настройках для объединения заметок.' } });
        if (input.id !== undefined && (typeof input.id !== 'string' || !idPattern.test(input.id))) fail(400, 'Некорректный ID операции.');
        const previous = input.id && store.db.prepare('SELECT body FROM sort_jobs WHERE id=?').get(input.id);
        if (previous) return json(res, { job: JSON.parse(previous.body) });
        if (sortJob.state !== 'running') void sortNotes(config, input.id || randomUUID());
        return json(res, { job: sortJob }, 202);
      }
      if (path === '/api/profile' && req.method === 'GET') return json(res, { profile: profile() });
      if (path === '/api/profile/avatar' && req.method === 'POST') {
        const [image] = images([await body(req)]);
        if (image.data.length > 2_000_000) fail(413, 'Аватарка должна быть не больше 2 МБ.');
        store.db.prepare('INSERT INTO profile VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET avatar=excluded.avatar,mime=excluded.mime,updated_at=excluded.updated_at').run(image.data, image.mime, new Date().toISOString());
        return json(res, { profile: profile() });
      }
      if (path === '/api/profile/avatar' && req.method === 'DELETE') {
        store.db.prepare('DELETE FROM profile WHERE id=1').run();
        return json(res, { profile: profile() });
      }
      if (path === '/api/profile/avatar' && req.method === 'GET') {
        const image = store.db.prepare('SELECT avatar,mime FROM profile WHERE id=1').get();
        if (!image) fail(404, 'Своя аватарка ещё не выбрана.');
        res.writeHead(200, { 'content-type': image.mime, 'content-length': image.avatar.length, 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox" });
        return res.end(image.avatar);
      }
      if (path === '/api/notes' && req.method === 'GET') {
        if ((url.searchParams.get('q') || '').length > 300) fail(400, 'Поисковый запрос слишком длинный.');
        return json(res, { notes: store.list(url.searchParams.get('q') || '').map(note => ({ ...note, agentWorking: agentWork.has(note.id), previewPending: previews.has(note.id) || deferredCloses.has(note.id) })), activity: activity() });
      }
      if (path === '/api/notes' && req.method === 'POST') return json(res, { note: store.create(metadata(await body(req))) }, 201);
      const upload = path.match(/^\/api\/notes\/([a-f0-9-]+)\/attachments(?:\/([a-f0-9-]+))?$/);
      if (upload) {
        const [, id, uploadId] = upload;
        getNote(id);
        if (!uploadId && req.method === 'GET') return json(res, { attachments: media.pending(id) });
        if (uploadId && req.method === 'PUT') return json(res, await exclusive(id, async () => ({ attachment: await media.upload(req, id, uploadId) })), 201);
        if (uploadId && req.method === 'DELETE') return json(res, await exclusive(id, async () => { await media.discard(id, uploadId); return { ok: true }; }));
      }
      const match = path.match(/^\/api\/notes\/([a-f0-9-]+)(?:\/(messages|summary|reply|close|research))?$/);
      if (match) {
        const [, id, action] = match;
        getNote(id);
        if (!action && req.method === 'GET') return json(res, { note: getNote(id), busy: locks.has(id), agentWorking: agentWork.has(id), previewPending: previews.has(id) || deferredCloses.has(id), research: research.latest(id) });
        if (action === 'research' && req.method === 'GET') {
          const messageId = url.searchParams.get('messageId');
          if (messageId !== null && !idPattern.test(messageId)) fail(400, 'Некорректный ID сообщения.');
          return json(res, { research: research.latest(id, messageId) });
        }
        if (!action && req.method === 'PATCH') {
          const data = await body(req);
          const fields = metadata(data);
          if (fields.avatar !== undefined && !getNote(id).avatar_options.some(option => option.head === fields.avatar)) fail(400, 'Эта аватарка не входит в набор заметки.');
          if (data.previousTitle !== undefined && (typeof data.previousTitle !== 'string' || data.previousTitle.length > 120 || fields.title === undefined)) fail(400, 'Некорректное прежнее название.');
          const expectedRevision = revision(data);
          const update = () => {
            const current = getNote(id);
            if (data.previousTitle !== undefined && data.previousTitle !== current.title) fail(409, 'Название уже изменилось. Откройте заметку заново перед переименованием.');
            return { note: store.update(id, fields, expectedRevision ?? current.revision) };
          };
          if (agentWork.has(id) && Object.keys(fields).length === 1 && fields.title !== undefined) return json(res, update());
          return json(res, await exclusive(id, update));
        }
        if (!action && req.method === 'DELETE') {
          const expected = req.headers['if-match'];
          if (expected !== undefined && !/^"\d+"$/.test(expected)) fail(400, 'If-Match должен содержать ревизию в кавычках.');
          const expectedRevision = expected === undefined ? undefined : revision({ revision: Number(expected.slice(1, -1)) });
          return json(res, await exclusive(id, async () => ({ ok: true, ...await media.removeNote(id, expectedRevision) })));
        }
        if (action === 'messages' && req.method === 'POST') {
          const data = await body(req);
          if (!data || typeof data.text !== 'string' || data.text.length > 20000 || typeof data.id !== 'string' || !idPattern.test(data.id)) fail(400, 'Сообщение: до 20 000 символов и уникальный ID.');
          const attachments = images(data.attachments);
          const attachmentIds = data.attachmentIds ?? [];
          if (!Array.isArray(attachmentIds) || attachments.length + attachmentIds.length > 4 || new Set(attachmentIds).size !== attachmentIds.length || attachmentIds.some(value => typeof value !== 'string' || !idPattern.test(value))) fail(400, 'Нужно до четырёх уникальных ID вложений.');
          if (!data.text.trim() && !attachments.length && !attachmentIds.length) fail(400, 'Добавьте мысль или вложение.');
          const expectedRevision = revision(data);
          const requestHash = createHash('sha256').update(JSON.stringify({ text: data.text.trim(), attachmentIds, attachments: attachments.map(item => ({ name: item.name, mime: item.mime, sha256: createHash('sha256').update(item.data).digest('hex') })) })).digest('hex');
          return json(res, await exclusive(id, async () => {
            const existing = store.db.prepare('SELECT note_id,request_hash FROM messages WHERE id=?').get(data.id);
            if (existing && existing.note_id !== id) fail(409, 'ID сообщения уже используется.');
            if (existing?.request_hash && existing.request_hash !== requestHash) fail(409, 'Этот ID сообщения уже сохранён с другим содержимым.');
            if (!existing) store.addMessage(id, { id: data.id, text: data.text.trim(), attachments, attachmentIds, requestHash, revision: expectedRevision });
            return replyTo(id, data.id);
          }));
        }
        if (action === 'reply' && req.method === 'POST') {
          const data = await body(req);
          return json(res, await exclusive(id, () => replyTo(id, data?.messageId)));
        }
        if ((action === 'summary' || action === 'close') && req.method === 'POST') {
          if (action === 'close') {
            const input = await body(req);
            if (input?.messageId !== undefined) {
              if (typeof input.messageId !== 'string' || !idPattern.test(input.messageId)) fail(400, 'Некорректный ID ожидаемого сообщения.');
              if (!getNote(id).messages.some(message => message.id === input.messageId && message.role === 'user') && !locks.has(id)) fail(409, 'Отправляемое сообщение ещё не сохранено. Закрытие не удалило черновик.');
            }
          }
          return json(res, await (action === 'close' ? closeNote(id) : summarizeNote(id)));
        }
      }
      const preview = path.match(/^\/api\/attachments\/([a-f0-9-]{36})\/preview$/);
      if (preview && ['GET', 'HEAD'].includes(req.method)) return await media.preview(req, res, preview[1]);
      const attachment = path.match(/^\/api\/attachments\/([a-f0-9-]{36})$/);
      if (attachment && ['GET', 'HEAD'].includes(req.method)) return await media.send(req, res, attachment[1]);
      if (path === '/api/feedback' && req.method === 'GET' && demo) return json(res, { annotations: store.db.prepare('SELECT * FROM feedback ORDER BY updated_at').all().map(r => JSON.parse(r.body)) });
      if (path === '/api/feedback' && req.method === 'POST' && demo) {
        const data = await body(req);
        if (!Array.isArray(data) || data.length > 500 || JSON.stringify(data).length > 1_000_000) fail(400, 'Слишком много комментариев.');
        store.db.exec('BEGIN IMMEDIATE');
        try {
          store.db.prepare('DELETE FROM feedback').run();
          for (const item of data) {
            if (typeof item?.id !== 'string' || typeof item.comment !== 'string') fail(400, 'Некорректный комментарий.');
            store.db.prepare('INSERT INTO feedback VALUES(?,?,?)').run(item.id, JSON.stringify(item), new Date().toISOString());
          }
          store.db.exec('COMMIT');
        } catch (error) { store.db.exec('ROLLBACK'); throw error; }
        return json(res, { ok: true });
      }
      fail(404, 'Неизвестный запрос.');
    }
    if (vite) return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
    if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Метод не поддерживается.');
    const dist = resolve(root, 'dist');
    let filename = resolve(dist, `.${decodeURIComponent(path)}`);
    if (!filename.startsWith(dist + sep)) filename = resolve(dist, 'index.html');
    if (!existsSync(filename) || !statSync(filename).isFile()) filename = resolve(dist, 'index.html');
    if (!realpathSync(filename).startsWith(realpathSync(dist) + sep)) fail(403, 'Недопустимый путь.');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    const content = req.method === 'HEAD' ? undefined : readFileSync(filename);
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:3102; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.writeHead(200, { 'content-type': types[extname(filename)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    return res.end(content);
  } catch (error) {
    if (!res.headersSent) json(res, { error: error.status ? error.message : 'Не удалось выполнить запрос. Данные не удалены.' }, error.status || 500);
    else res.end();
    if (!error.status) console.error('Kakuoku: request failed.');
  } finally { activeRequests--; }
}

http.requestTimeout = 720_000;
http.headersTimeout = 15_000;
http.maxHeadersCount = 64;
http.listen(port, demo ? '127.0.0.1' : '0.0.0.0', () => console.log(`Kakuoku ${demo ? 'design demo + Agentation' : 'app'}: http://localhost:${publicPort}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  stopRequests();
  http.close();
  http.closeIdleConnections();
  const deadline = Date.now() + 25_000;
  const timer = setInterval(async () => {
    if (activeRequests || previews.size || sortJob.state === 'running') {
      if (Date.now() < deadline) return;
      http.closeAllConnections();
      // SQLite transactions are synchronous; a forced stop cannot interrupt one halfway.
      process.exit(1);
    }
    clearInterval(timer);
    await vite?.close();
    store.db.close();
    process.exit(0);
  }, 100);
});
