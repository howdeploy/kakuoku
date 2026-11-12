import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { defaults, openSettings } from '../server/settings.mjs';

const requests = [];
mock.module('../server/web.mjs', { namedExports: {
  postPublicJson: async (url, key, payload) => {
    requests.push(payload);
    return { choices: [{ message: { content: 'Fixture answer' } }] };
  },
  validatePublicUrl: value => new URL(value),
  readUrl: () => { throw new Error('Unexpected web access'); },
  serviceRequest: () => { throw new Error('Unexpected provider access'); },
  searchWeb: () => { throw new Error('Unexpected search'); },
} });
const { reply } = await import('../server/agent.mjs');
const config = { ...defaults, mode: 'chat', apiKey: 'fixture-key' };
const note = { id: 'current-note', assistant_name: 'Fixture', messages: [{ role: 'user', text: 'Describe this image', attachments: [{ id: 'image-1', name: 'image.jpeg', mime: 'image/jpeg' }] }] };
const jpeg = Buffer.from([255, 216, 255, 217]);

test('routes actual image parts to the selected vision model, without extra model calls', async () => {
  const ids = [];
  const before = requests.length;
  await reply(note, { ...config, visionModel: 'qwen-3.8-next' }, { imageForModel: async (...args) => { ids.push(args); return jpeg; } });
  assert.deepEqual(ids, [['current-note', 'image-1']]);
  assert.equal(requests.length, before + 1);
  const payload = requests.at(-1);
  assert.equal(payload.model, 'qwen-3.8-next');
  const part = payload.messages.at(-1).content.find(part => part.type === 'image_url');
  assert.equal(part.image_url.url, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
  assert(!JSON.stringify(payload).includes('fixture-key'));
});

test('disabled vision and notes mode never read images', async () => {
  const work = { imageForModel: () => { throw new Error('Unexpected image read'); } };
  await reply(note, { ...config, visionModel: 'off' }, work);
  assert.equal(requests.at(-1).model, config.model);
  assert(requests.at(-1).messages.every(message => typeof message.content === 'string'));
  const before = requests.length;
  await assert.rejects(reply(note, { ...config, mode: 'notes' }, work), /отключены/);
  assert.equal(requests.length, before);
});

test('only the last four image attachments of the supplied note enter context', async () => {
  const many = { ...note, messages: [{ ...note.messages[0], attachments: Array.from({ length: 6 }, (_, i) => ({ id: `image-${i}`, mime: 'image/png', name: 'fixture' })) }] };
  const ids = [];
  await reply(many, config, { imageForModel: async (noteId, id) => { assert.equal(noteId, note.id); ids.push(id); return jpeg; } });
  assert.deepEqual(ids, ['image-2', 'image-3', 'image-4', 'image-5']);
  assert.equal(requests.at(-1).messages.at(-1).content.filter(part => part.type === 'image_url').length, 4);
});

test('invalid processor output stops before a model request', async () => {
  const before = requests.length;
  await assert.rejects(reply(note, config, { imageForModel: async () => Buffer.alloc(1024 * 1024 + 1) }), /недопустимое изображение/);
  assert.equal(requests.length, before);
});

test('model settings preserve secrets and omitted fields, and reject a generator as vision', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const settings = openSettings(db);
    settings.save({ ...defaults, apiKey: 'fixture-secret', model: 'glm-5.3', visionModel: 'qwen-3.8-next' });
    settings.save({ endpoint: defaults.endpoint, mode: 'chat', prompts: defaults.prompts });
    assert.equal(settings.read().apiKey, 'fixture-secret');
    assert.equal(settings.read().model, 'glm-5.3');
    assert.equal(settings.publicSettings().visionModel, 'qwen-3.8-next');
    assert(!JSON.stringify(settings.publicSettings()).includes('fixture-secret'));
    assert.throws(() => settings.save({ ...defaults, visionModel: 'qwen-image-2.1' }), /Выберите модель/);
  } finally { db.close(); }
});
