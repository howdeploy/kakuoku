import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openSettings, defaults } from '../server/settings.mjs';
import { normalizeTagCatalog, validTagSelection } from '../shared/tags.mjs';
import { destinationPath, fileManifest } from '../host/storage.mjs';

test('tag edits, exact intersections and cache invalidation preserve messages and secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kakuoku-tags-'));
  const store = openStore(directory);
  try {
    const settings = openSettings(store.db);
    settings.save({ ...defaults, mode: 'notes', apiKey: 'fixture-private-key', tags: ['#Alpha', ' ＢＥＴＡ ', 'gamma'] });
    assert.deepEqual(settings.read().tags, ['alpha', 'beta', 'gamma']);
    assert(!JSON.stringify(settings.publicSettings()).includes('fixture-private-key'));
    const note = store.create({ title: 'Synthetic topic' });
    store.addMessage(note.id, { text: 'A synthetic message that must remain unchanged.' });
    store.summarize(note.id, 'Synthetic preview', store.note(note.id).revision, 'agent', 'cached-preview', settings.read().tags);
    assert.equal(store.list('#ALPHA #gamma')[0].id, note.id);
    assert.equal(store.list('#alpha #missing').length, 0);
    assert.equal(store.list('beta')[0].id, note.id);
    const messages = store.note(note.id).messages;
    store.transaction(() => {
      const saved = settings.save({ endpoint: defaults.endpoint, mode: 'notes', prompts: defaults.prompts, tags: ['beta', 'gamma'] });
      store.pruneTags(saved.tags);
    });
    assert.deepEqual(store.note(note.id).tags, ['beta', 'gamma']);
    assert.equal(store.note(note.id).summary_key, '');
    assert.equal(store.list('#alpha').length, 0);
    assert.deepEqual(store.note(note.id).messages, messages);
    assert.equal(settings.read().apiKey, 'fixture-private-key');
    assert.throws(() => normalizeTagCatalog(['alpha', '#ALPHA']));
    assert(!validTagSelection(['beta', 'outside'], ['beta', 'gamma']));
    assert(validTagSelection([], []));
  } finally { store.db.close(); await rm(directory, { recursive: true }); }
});

test('storage planning rejects populated folders and links; hashes detect changed copies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kakuoku-paths-'));
  try {
    const project = join(directory, 'project');
    await assert.rejects(destinationPath(project, project, null));
    await assert.rejects(destinationPath('/', project, null));
    await assert.rejects(destinationPath(directory, project, null));
    assert.equal(await destinationPath(join(directory, 'new-data'), project, null), join(directory, 'new-data'));
    await writeFile(join(directory, 'content'), 'synthetic');
    await assert.rejects(destinationPath(directory, join(tmpdir(), 'other-project'), null));
    const before = await fileManifest(directory);
    await writeFile(join(directory, 'content'), 'changed');
    assert.notDeepEqual(await fileManifest(directory), before);
    await symlink(join(directory, 'content'), join(directory, 'link'));
    await assert.rejects(fileManifest(directory));
  } finally { await rm(directory, { recursive: true }); }
});
