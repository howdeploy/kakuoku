import { constants, createReadStream } from 'node:fs';
import { access, chmod, cp, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const execute = promisify(execFile);
const moveMarker = '.kakuoku-move.json';
const managedKey = 'x-kakuoku-managed-storage';
function fail(message) { throw Object.assign(new Error(message), { status: 409 }); }
async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function contains(parent, child) { return child === parent || child.startsWith(parent + sep); }

export async function destinationPath(input, root, source) {
  if (typeof input !== 'string' || input.length > 2048 || !isAbsolute(input) || /[\x00-\x1f\x7f,:]/.test(input)) fail('Укажите полный путь к отдельной папке данных, без запятых и двоеточий.');
  const destination = resolve(input);
  if ([parse(destination).root, resolve(homedir())].includes(destination) || contains(root, destination) || contains(destination, root)) fail('Выберите отдельную папку вне репозитория, не корень диска или домашнюю папку.');
  if (source && (contains(source, destination) || contains(destination, source))) fail('Новая папка должна находиться отдельно от прежнего хранилища.');
  const parent = dirname(destination);
  let canonical;
  try { canonical = await realpath(parent); await access(parent, constants.W_OK | constants.X_OK); }
  catch { fail('Родительская папка должна существовать и быть доступна для записи.'); }
  if (canonical !== parent) fail('Родительская папка не может находиться за символической ссылкой.');
  const stat = await exists(destination);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(destination)).length)) fail('Новая папка должна отсутствовать или быть пустой, без символических ссылок.');
  if (stat && stat.uid !== process.getuid()) fail('Пустая папка должна принадлежать пользователю, запустившему помощник.');
  if (stat && await realpath(destination) !== destination) fail('Папка данных не может быть символической ссылкой.');
  return destination;
}

export async function fileManifest(directory) {
  const result = [];
  async function walk(folder) {
    for (const name of (await readdir(folder)).sort()) {
      const path = join(folder, name), stat = await lstat(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) fail('Хранилище содержит ссылку или специальный файл. Перенос остановлен.');
      if (stat.isDirectory()) { result.push({ path: relative(directory, path), directory: true }); await walk(path); }
      else {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        result.push({ path: relative(directory, path), size: stat.size, hash: hash.digest('hex') });
      }
    }
  }
  await walk(directory);
  return result;
}

async function atomicWrite(path, content) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const folder = await open(dirname(path), 'r');
  try { await folder.sync(); } finally { await folder.close(); }
}

async function flushTree(path) {
  if ((await lstat(path)).isDirectory()) for (const name of await readdir(path)) await flushTree(join(path, name));
  const file = await open(path, 'r');
  try { await file.sync(); } finally { await file.close(); }
}

export async function openController(root) {
  // shortcut: native Linux host; validate Docker Desktop filesystem and durability semantics before supporting other hosts.
  if (process.platform !== 'linux') fail('Автоматический перенос пока поддерживается на Linux.');
  root = await realpath(root);
  const folder = join(root, '.data', 'host');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  if (await realpath(folder) !== folder) fail('Каталог локального помощника не может быть символической ссылкой.');
  await chmod(folder, 0o700);
  const override = join(root, 'compose.override.yaml'), journal = join(folder, 'move.json');
  if (process.env.COMPOSE_FILE) fail('Помощник использует compose.yaml и управляемый compose.override.yaml; COMPOSE_FILE не поддерживается.');
  for (const name of ['compose.override.yml', 'docker-compose.override.yaml', 'docker-compose.override.yml']) if (await exists(join(root, name))) fail('Обнаружен дополнительный Compose override. Согласуйте конфигурацию перед переносом.');
  let job = await exists(journal) ? JSON.parse(await readFile(journal, 'utf8')) : null;
  let plan = null, running = false;
  if (job && ['running', 'committed', 'recovering'].includes(job.state)) {
    job.state = 'interrupted'; job.message = 'Помощник был остановлен во время переноса. Нажмите «Продолжить восстановление».';
  }
  let endpoint = process.env.DOCKER_HOST;
  if (!endpoint) {
    const { stdout } = await execute('docker', ['context', 'inspect'], { timeout: 10_000, maxBuffer: 100_000 });
    endpoint = JSON.parse(stdout)[0]?.Endpoints?.docker?.Host;
  }
  if (!endpoint?.startsWith('unix://')) fail('Перенос поддерживает только локальный Docker через Unix socket.');
  async function docker(...args) {
    try { return (await execute('docker', ['--host', endpoint, ...args], { cwd: root, timeout: 600_000, maxBuffer: 4_000_000 })).stdout.trim(); }
    catch { fail('Команда Docker не завершилась успешно. Прежнее хранилище не удалялось.'); }
  }
  async function readOverride() {
    if (!await exists(override)) return null;
    const stat = await lstat(override);
    if (!stat.isFile() || stat.nlink !== 1) fail('Compose override должен быть обычным файлом.');
    const content = await readFile(override, 'utf8');
    let parsed;
    try { parsed = JSON.parse(content); } catch { fail('Существующий compose.override.yaml не создан помощником; он не будет перезаписан.'); }
    if (parsed[managedKey] !== true) fail('Существующий compose.override.yaml не принадлежит помощнику.');
    return content;
  }
  async function compose(...args) {
    const files = ['compose', '--project-directory', root, '-f', join(root, 'compose.yaml')];
    if (await exists(override)) files.push('-f', override);
    return docker(...files, ...args);
  }
  async function baseFingerprint() {
    const hash = createHash('sha256');
    for (const name of ['compose.yaml', '.env']) {
      const path = join(root, name);
      hash.update(name);
      if (await exists(path)) hash.update(await readFile(path));
    }
    return hash.digest('hex');
  }
  async function unchangedImage(source) {
    if (await docker('image', 'inspect', '--format', '{{.Id}}', source.imageRef) !== source.image) fail('Образ обновлён во время переноса. Завершите обновление отдельно.');
  }
  async function inspect() {
    const id = await compose('ps', '--all', '--quiet', 'app');
    if (!/^[a-f0-9]{12,64}$/.test(id)) fail('Не найден единственный контейнер Kakuoku. Сначала запустите приложение через Compose.');
    const [container] = JSON.parse(await docker('inspect', id));
    const mount = container.Mounts.filter(item => item.Destination === '/app/data');
    if (mount.length !== 1 || !['bind', 'volume'].includes(mount[0].Type)) fail('Не найдено отдельное хранилище /app/data.');
    const bindings = container.HostConfig.PortBindings?.['3100/tcp'];
    if (bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1') fail('Помощник работает только с локальным приложением Kakuoku.');
    return { id: container.Id, image: container.Image, imageRef: container.Config.Image, running: container.State.Running, source: mount[0].Source,
      storage: { kind: mount[0].Type, name: mount[0].Name || null, hostPath: mount[0].Type === 'bind' ? mount[0].Source : null, containerPath: '/app/data' },
      origin: `http://127.0.0.1:${bindings[0].HostPort}` };
  }
  async function app(snapshot, path, data) {
    const options = { signal: AbortSignal.timeout(10_000) };
    if (data !== undefined) {
      const session = await fetch(`${snapshot.origin}/api/session`, options).then(response => response.json());
      options.method = 'POST'; options.headers = { 'content-type': 'application/json', 'x-kakuoku-token': session.token }; options.body = JSON.stringify(data);
    }
    const response = await fetch(`${snapshot.origin}/api${path}`, options);
    if (!response.ok) fail(response.status === 404 ? 'Сначала обновите образ Kakuoku: он ещё не поддерживает перенос.' : 'Приложение занято или недоступно. Завершите операции и повторите перенос.');
    return response.json();
  }
  async function ready(snapshot, id) {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { const info = await app(snapshot, '/storage'); if (!info.demo && (id === undefined || (info.paused && info.moveId === id))) return; } catch { /* Wait for the inspected instance and, when switching, its matching move marker. */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    fail('Новый контейнер не подтвердил безопасный запуск.');
  }
  async function save() { await atomicWrite(journal, JSON.stringify(job)); }
  const publicJob = () => job && ({ id: job.id, state: job.state, message: job.message, destination: job.destination, backup: job.backup });
  async function restoreOverride() {
    const current = await readOverride();
    if (current !== job.previousOverride && current !== job.nextOverride) fail('Compose override изменён вне помощника; он не будет перезаписан.');
    if (job.previousOverride === null) { if (await exists(override)) { await readOverride(); await unlink(override); } }
    else await atomicWrite(override, job.previousOverride);
  }
  async function rollback() {
    if (await baseFingerprint() !== job.baseHash) fail('Конфигурация запуска изменена вне помощника. Автоматическое восстановление остановлено.');
    if (job.phase === 'committed') {
      const current = await inspect();
      if (current.storage.kind !== 'bind' || current.source !== job.destination) fail('Подключение изменилось после переноса; автоматическое восстановление остановлено.');
      await ready(current);
      await app(current, '/storage/resume', { id: job.id });
      job.state = 'complete'; job.message = 'Хранилище перенесено. Прежнее хранилище и резервная копия сохранены.'; await save(); return;
    }
    const current = await inspect();
    if (current.id !== job.source.id && (current.storage.kind !== 'bind' || current.source !== job.destination)) fail('Контейнер изменён вне помощника. Автоматическое восстановление остановлено.');
    if (current.id === job.source.id && current.running && job.phase === 'preparing') {
      await app(current, '/storage/resume', { id: job.id });
      job.state = 'error'; job.message = 'Приложение занято. Перенос не начат; дождитесь завершения операций и повторите.'; await save(); return;
    }
    if (current.id !== job.source.id && current.running) {
      const info = await app(current, '/storage');
      if (!info.paused || info.moveId !== job.id) fail('Новое хранилище уже принимает записи. Возврат к старому автоматически запрещён.');
      await compose('stop', 'app');
    }
    await restoreOverride();
    await unchangedImage(job.source);
    await compose('up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'app');
    const restored = await inspect();
    if (restored.source !== job.source.source) fail('Прежнее подключение хранилища не восстановлено.');
    await ready(restored);
    await app(restored, '/storage/resume', { id: job.id });
    job.state = 'error'; job.message = 'Перенос не завершён. Приложение возвращено к прежнему хранилищу; копии сохранены.'; await save();
  }
  async function move() {
    try {
      await app(job.source, '/storage/pause', { id: job.id });
      job.phase = 'copying'; job.message = 'Останавливаю приложение и сохраняю полную копию.'; await save();
      await compose('stop', 'app');
      if ((await inspect()).running) fail('Контейнер не остановлен.');
      await mkdir(job.backup, { recursive: true, mode: 0o700 });
      await docker('cp', `${job.source.id}:/app/data/.`, job.backup);
      const copied = await fileManifest(job.backup);
      if (copied.some(item => item.path === moveMarker)) fail('В исходном хранилище уже есть незавершённый перенос.');
      const databases = ['kakuoku.sqlite', 'mochi.sqlite'].filter(name => copied.some(item => item.path === name));
      if (databases.length !== 1) fail('Не найдена единственная база заметок.');
      const db = new DatabaseSync(join(job.backup, databases[0]), { readOnly: true });
      try { if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('Резервная копия SQLite не прошла проверку целостности.'); } finally { db.close(); }
      const before = await fileManifest(job.backup);
      await destinationPath(job.destination, root, job.source.source);
      await mkdir(job.destination, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      await chmod(job.destination, 0o700);
      job.message = 'Копирую данные на новое место и сверяю файлы.'; await save();
      for (const name of await readdir(job.backup)) await cp(join(job.backup, name), join(job.destination, name), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      assert.deepEqual(await fileManifest(job.destination), before, 'Контрольные суммы копии не совпали.');
      await flushTree(job.destination);
      await atomicWrite(join(job.destination, moveMarker), JSON.stringify({ id: job.id }));
      // A separate one-shot container owns only the selected copy and has no network or Docker socket.
      const own = 'const fs=require("node:fs");function own(p){const s=fs.lstatSync(p);if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile())||(s.isFile()&&s.nlink!==1))throw Error("Unsafe entry");fs.chownSync(p,0,0);if(s.isDirectory())for(const n of fs.readdirSync(p))own(p+"/"+n);fs.chownSync(p,1000,1000);}own("/data");';
      await docker('run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--security-opt', 'no-new-privileges:true', '--pids-limit', '32', '--memory', '128m', '--user', '0:0', '--mount', `type=bind,source=${job.destination},target=/data`, '--entrypoint', 'node', job.source.image, '-e', own);
      if (await readOverride() !== job.previousOverride) fail('Compose override изменён во время переноса.');
      if (await baseFingerprint() !== job.baseHash) fail('Конфигурация запуска изменена во время переноса.');
      await unchangedImage(job.source);
      job.phase = 'switching'; job.message = 'Подключаю новую папку и запускаю приложение.'; await save();
      job.nextOverride = JSON.stringify({ [managedKey]: true, services: { app: { volumes: [{ type: 'bind', source: job.destination.replace(/\$/g, () => '$$'), target: '/app/data', bind: { create_host_path: false } }] } } }, null, 2);
      await save();
      await atomicWrite(override, job.nextOverride);
      await compose('up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'app');
      const current = await inspect();
      if (current.source !== job.destination || current.image !== job.source.image) fail('Контейнер запущен с неожиданным хранилищем или образом.');
      await ready(current, job.id);
      // Persist commitment before allowing writes, so recovery can never discard new messages.
      job.phase = 'committed'; job.state = 'committed'; await save();
      await app(current, '/storage/resume', { id: job.id });
      job.state = 'complete'; job.message = 'Хранилище перенесено. Прежнее хранилище и резервная копия сохранены.'; await save();
    } catch (error) {
      job.failureCode = /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'TRANSFER_FAILED';
      const reason = error.status ? error.message : error.code === 'ENOSPC' ? 'Недостаточно места для копии.' : 'Не удалось проверить или скопировать данные. Проверьте свободное место, права и поддержку Linux-владельцев на новом диске.';
      try { await rollback(); if (job.state !== 'complete') { job.message += ` ${reason}`; await save(); } }
      catch (recoveryError) { job.recoveryCode = /^[A-Z_0-9]+$/.test(recoveryError.code || '') ? recoveryError.code : 'RECOVERY_FAILED'; job.state = 'interrupted'; job.message = `Перенос остановлен. Копии сохранены; нажмите «Продолжить восстановление». ${reason}`; await save(); }
    } finally { running = false; }
  }
  return {
    async status() {
      let storage = null;
      try { storage = (await inspect()).storage; } catch { /* The job remains visible while Docker recreates the container. */ }
      return { storage, job: publicJob() };
    },
    async plan(destination) {
      if (running || job?.state === 'interrupted') fail('Сначала завершите или восстановите текущий перенос.');
      const source = await inspect();
      if (!source.running) fail('Сначала запустите приложение.');
      const info = await app(source, '/storage');
      if (info.demo || info.paused) fail('Приложение ещё не готово к переносу.');
      const previousOverride = await readOverride();
      const path = await destinationPath(destination, root, source.source);
      plan = { id: randomUUID(), destination: path, source, previousOverride, baseHash: await baseFingerprint(), expires: Date.now() + 300_000 };
      return { id: plan.id, destination: path, storage: source.storage };
    },
    async start(id) {
      if (job?.id === id) return publicJob();
      if (running || job?.state === 'interrupted') fail('Уже есть незавершённый перенос.');
      if (!plan || plan.id !== id || plan.expires < Date.now()) fail('Предпросмотр устарел. Подготовьте план снова.');
      running = true;
      try {
        const current = await inspect();
        if (current.id !== plan.source.id || await readOverride() !== plan.previousOverride || await baseFingerprint() !== plan.baseHash) fail('Развёртывание изменилось. Подготовьте план снова.');
        await destinationPath(plan.destination, root, plan.source.source);
        job = { ...plan, backup: join(folder, 'moves', plan.id, 'data'), phase: 'preparing', state: 'running', message: 'Подготавливаю перенос.' };
        await save(); plan = null;
        void move().catch(() => { job.state = 'interrupted'; job.message = 'Не удалось сохранить журнал. Копии не удалены; освободите место и продолжите восстановление.'; });
        return publicJob();
      } catch (error) { running = false; if (job?.phase === 'preparing') { job.state = 'error'; job.message = 'Перенос не начат: не удалось сохранить подготовку.'; } throw error; }
    },
    async recover() {
      if (running || job?.state !== 'interrupted') fail('Нет прерванного переноса.');
      running = true; job.state = 'recovering'; job.message = 'Восстанавливаю согласованное подключение.';
      try { await save(); } catch (error) { running = false; job.state = 'interrupted'; throw error; }
      void rollback().catch(async () => { job.state = 'interrupted'; job.message = 'Автоматическое восстановление не завершено. Копии сохранены; проверьте Docker и повторите.'; await save(); }).catch(() => { job.state = 'interrupted'; job.message = 'Не удалось сохранить восстановление. Освободите место; копии не удалены.'; }).finally(() => { running = false; });
      return publicJob();
    },
  };
}
