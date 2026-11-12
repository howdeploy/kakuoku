import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openController } from '../host/storage.mjs';

const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'kakuoku-move-fixture-'));
const targetRoot = await mkdtemp(join(tmpdir(), 'kakuoku-move-target-'));
const name = `kakuoku-fixture-${randomUUID().slice(0, 8)}`;
const volume = `${name}-data`;
const docker = async (...args) => (await execute('docker', args, { cwd: root, timeout: 120_000, maxBuffer: 1_000_000 })).stdout.trim();
const compose = (...args) => docker('compose', '--project-directory', root, '-f', join(root, 'compose.yaml'), '-f', join(root, 'compose.override.yaml'), ...args);
let token = '';
async function api(path, data, options = {}) {
  const response = await fetch(`http://127.0.0.1:3114/api${path}`, { signal: AbortSignal.timeout(15_000),
    ...(data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-kakuoku-token': token }, body: JSON.stringify(data) }), ...options });
  assert(response.ok, `Fixture API ${path}: ${response.status}`);
  return response.json();
}
async function waitJob(controller) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await controller.status();
    if (!['running', 'committed', 'recovering'].includes(result.job.state)) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Fixture transfer timed out');
}
let created = false;
try {
  await writeFile(join(root, 'compose.override.yaml'), JSON.stringify({ 'x-kakuoku-managed-storage': true }), { mode: 0o600 });
  await writeFile(join(root, 'compose.yaml'), JSON.stringify({ name, services: { app: {
    image: 'kakuoku:pending', init: true, user: '1000:1000', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], stop_grace_period: '35s',
    pids_limit: 64, mem_limit: '768m', memswap_limit: '768m', cpus: 2, shm_size: '16m', ulimits: { nofile: { soft: 1024, hard: 1024 }, core: 0 },
    ports: ['127.0.0.1:3114:3100'], environment: { KAKUOKU_PUBLIC_PORT: '3114' }, volumes: ['data:/app/data'], tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777'],
  } }, volumes: { data: { external: true, name: volume } } }), { mode: 0o600 });
  await docker('volume', 'create', volume); created = true;
  await compose('up', '-d', '--no-build', '--pull', 'never');
  for (let attempt = 0; attempt < 30; attempt++) {
    try { token = (await api('/session')).token; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert(token, 'Fixture did not start');
  const { defaults } = await api('/settings');
  const settings = { ...defaults, apiKey: 'synthetic-private-key-not-for-network', mode: 'notes', tags: ['alpha', 'beta', 'gamma'] };
  await api('/settings', settings, { method: 'PATCH' });
  const { note } = await api('/notes', { title: 'Synthetic storage transfer' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=', 'base64');
  const uploadId = randomUUID();
  const uploaded = await fetch(`http://127.0.0.1:3114/api/notes/${note.id}/attachments/${uploadId}`, { method: 'PUT', headers: { 'x-kakuoku-token': token, 'x-kakuoku-filename': 'fixture.png', 'content-type': 'application/octet-stream' }, body: png });
  const uploadedBody = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(uploadedBody));
  await api(`/notes/${note.id}/messages`, { id: randomUUID(), text: 'Synthetic message preserved across transfer.', attachmentIds: [uploadId], attachments: [{ name: 'legacy.png', data: png.toString('base64') }] });
  const before = (await api(`/notes/${note.id}`)).note;
  let controller = await openController(root);
  const destination = join(targetRoot, 'data');
  const plan = await controller.plan(destination);
  await controller.start(plan.id);
  const result = await waitJob(controller);
  assert.equal(result.job.state, 'complete', result.job.message);
  assert.equal(result.storage.hostPath, destination);
  token = (await api('/session')).token;
  assert.deepEqual((await api(`/notes/${note.id}`)).note, before);
  assert.deepEqual((await api('/settings')).settings.tags, settings.tags);
  assert((await api('/settings')).settings.hasApiKey);
  for (const attachment of before.messages[0].attachments) {
    const response = await fetch(`http://127.0.0.1:3114/api/attachments/${attachment.id}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  }
  assert.equal((await controller.start(plan.id)).id, plan.id);
  await docker('volume', 'inspect', volume);
  // Recreate through ordinary Compose: the local override must retain the new mount.
  await docker('compose', 'up', '-d', '--no-build', '--pull', 'never', 'app');
  assert.equal((await controller.status()).storage.hostPath, destination);
  token = (await api('/session')).token;
  await api(`/notes/${note.id}/messages`, { id: randomUUID(), text: 'New message after the committed move must survive recovery.' });
  const committedNote = (await api(`/notes/${note.id}`)).note;
  const journal = join(root, '.data', 'host', 'move.json');
  const interrupted = JSON.parse(await readFile(journal, 'utf8'));
  interrupted.state = 'committed';
  await writeFile(journal, JSON.stringify(interrupted));
  controller = await openController(root);
  assert.equal((await controller.status()).job.state, 'interrupted');
  await controller.recover();
  assert.equal((await waitJob(controller)).job.state, 'complete');
  assert.deepEqual((await api(`/notes/${note.id}`)).note, committedNote);
  const faultPath = join(targetRoot, 'fault-target');
  const fault = await controller.plan(faultPath);
  await controller.start(fault.id);
  // Occupy it after plan validation, before pause's network request can finish.
  mkdirSync(faultPath); writeFileSync(join(faultPath, 'keep'), 'Do not overwrite');
  const rolledBack = await waitJob(controller);
  assert.equal(rolledBack.job.state, 'error', rolledBack.job.message);
  assert.equal(rolledBack.storage.hostPath, destination);
  assert.deepEqual((await api(`/notes/${note.id}`)).note, committedNote);
  assert.equal(await readFile(join(faultPath, 'keep'), 'utf8'), 'Do not overwrite');
  await mkdir(join(targetRoot, 'occupied'));
  await writeFile(join(targetRoot, 'occupied', 'keep'), 'Do not overwrite');
  await assert.rejects(controller.plan(join(targetRoot, 'occupied')));
  assert.equal(await readFile(join(targetRoot, 'occupied', 'keep'), 'utf8'), 'Do not overwrite');
  console.log(JSON.stringify({ transfer: 'passed', messages: 'preserved', blobAndFileAttachments: 'preserved', settings: 'preserved', sourceVolume: 'preserved', ordinaryCompose: 'new-mount-preserved', committedRecovery: 'new-messages-preserved', failedCopy: 'rolled-back-without-overwriting', occupiedDestination: 'rejected', fixtureRoot: root }));
} finally {
  if (created) {
    await docker('compose', 'down').catch(() => {});
    await docker('volume', 'rm', volume).catch(() => {});
  }
}
