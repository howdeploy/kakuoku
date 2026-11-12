import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasFileTransfer, transferFiles } from '../src/media-input.mjs';

test('clipboard and drop use actual files, with FileList fallback and no duplicates', () => {
  const file = { name: 'image.jpeg', type: '', size: 1024 };
  const item = { kind: 'file', getAsFile: () => file };
  assert.deepEqual(transferFiles({ items: [item], files: [file] }), [file]);
  assert.deepEqual(transferFiles({ items: [item], files: [] }), [file]);
  assert.deepEqual(transferFiles({ files: [file] }), [file]);
  assert.deepEqual(transferFiles({ items: [{ ...item, getAsFile: () => null }], files: [file] }), [file]);
  assert.deepEqual(transferFiles({ items: [{ kind: 'string', type: 'text/html' }] }), []);
  assert.deepEqual(transferFiles(null), []);
});

test('protected drag-over recognizes files before bytes become readable; text stays native', () => {
  assert.equal(hasFileTransfer({ types: ['Files'], items: [], files: [] }), true);
  assert.equal(hasFileTransfer({ items: [{ kind: 'file' }] }), true);
  assert.equal(hasFileTransfer({ types: ['text/plain', 'text/uri-list'], items: [{ kind: 'string' }] }), false);
  assert.equal(hasFileTransfer(null), false);
});
