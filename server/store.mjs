import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { avatarHeads, avatarFrameColors } from '../shared/avatars.mjs';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== resolve(directory)) throw new Error('Хранилище не может быть symlink.');
  // Keep existing database families intact, including WAL/SHM; never rename an open DB.
  const databases = ['kakuoku.sqlite', 'mochi.sqlite'];
  const existing = [];
  for (const name of databases) {
    let found = false;
    for (const suffix of ['', '-wal', '-shm']) {
      const stat = lstatSync(resolve(directory, name + suffix), { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)) throw new Error('Небезопасный файл SQLite.');
      if (stat) found = true;
    }
    if (found) existing.push(name);
  }
  if (existing.length > 1) throw new Error('Найдены две базы данных. Сначала явно выберите нужное хранилище; файлы оставлены без изменений.');
  const database = existing[0] || databases[0];
  if (existing.length && !lstatSync(resolve(directory, database), { throwIfNoEntry: false })) throw new Error('Найдены WAL/SHM без основного файла SQLite. Восстановите полное хранилище.');
  const db = new DatabaseSync(resolve(directory, database));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL, avatar INTEGER NOT NULL, assistant_name TEXT, avatar_options TEXT,
      pattern TEXT NOT NULL DEFAULT 'none', merge_key TEXT,
      revision INTEGER NOT NULL DEFAULT 0, summarized_revision INTEGER NOT NULL DEFAULT 0,
      summary_source TEXT NOT NULL DEFAULT 'local', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL,
      reply_to TEXT UNIQUE REFERENCES messages(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_note ON messages(note_id, created_at);
    CREATE INDEX IF NOT EXISTS attachments_message ON attachments(message_id);
    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_attachments (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES media_files(id)
    );
    CREATE INDEX IF NOT EXISTS media_message ON media_attachments(message_id);
    CREATE TABLE IF NOT EXISTS merge_sources (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL, title TEXT NOT NULL, revision INTEGER NOT NULL,
      PRIMARY KEY(note_id,source_id)
    );
    CREATE TABLE IF NOT EXISTS sort_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      note_id UNINDEXED, title, summary, body, tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK(id=1), avatar BLOB NOT NULL,
      mime TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function newAssistantName() {
    const starts = ['Буль','Шмя','Жу','Мур','Плю','Фыр','Ква','Хлю','Тю','Чу','Бря','Зю','Пых','Клю','Хру','Ля'];
    const middles = ['бы','мя','лю','пы','жу','фи','ва','ня','ши','мо','ту','кря','бли','дю','рё','фа'];
    const ends = ['льдых','рдык','мбум','няк','пух','бусь','лёп','фык','чум','ндель','клюк','мур','лёнок','дых','фунь','жик'];
    let name;
    do {
      name = starts[randomInt(starts.length)] + middles[randomInt(middles.length)] + middles[randomInt(middles.length)] + ends[randomInt(ends.length)];
    } while (db.prepare('SELECT 1 FROM notes WHERE assistant_name=?').get(name));
    return name;
  }
  function newAvatarOptions(selected, preserveFrame = false) {
    const pool = avatarHeads.map((_, index) => index).filter(index => index !== selected);
    const options = [{ head: selected, frame: preserveFrame && selected < 6 ? selected : randomInt(avatarFrameColors.length) }];
    while (options.length < 6) {
      const [head] = pool.splice(randomInt(pool.length), 1);
      options.push({ head, frame: randomInt(avatarFrameColors.length) });
    }
    return JSON.stringify(options);
  }
  transaction(() => {
    if (!db.prepare('PRAGMA table_info(notes)').all().some(column => column.name === 'assistant_name')) db.exec('ALTER TABLE notes ADD COLUMN assistant_name TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS notes_assistant_name ON notes(assistant_name)');
    for (const row of db.prepare('SELECT id FROM notes WHERE assistant_name IS NULL').all()) {
      db.prepare('UPDATE notes SET assistant_name=? WHERE id=?').run(newAssistantName(), row.id);
    }
    if (!db.prepare('PRAGMA table_info(notes)').all().some(column => column.name === 'avatar_options')) db.exec('ALTER TABLE notes ADD COLUMN avatar_options TEXT');
    for (const row of db.prepare('SELECT id,avatar FROM notes WHERE avatar_options IS NULL').all()) {
      db.prepare('UPDATE notes SET avatar_options=? WHERE id=?').run(newAvatarOptions(row.avatar, true), row.id);
    }
    if (!db.prepare('PRAGMA table_info(notes)').all().some(column => column.name === 'pattern')) db.exec("ALTER TABLE notes ADD COLUMN pattern TEXT NOT NULL DEFAULT 'none'");
    if (!db.prepare('PRAGMA table_info(notes)').all().some(column => column.name === 'merge_key')) db.exec('ALTER TABLE notes ADD COLUMN merge_key TEXT');
    if (!db.prepare('PRAGMA table_info(notes)').all().some(column => column.name === 'summary_key')) db.exec("ALTER TABLE notes ADD COLUMN summary_key TEXT NOT NULL DEFAULT ''");
    if (!db.prepare('PRAGMA table_info(notes)').all().some(column => column.name === 'tags')) db.exec("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS notes_merge_key ON notes(merge_key)');
    if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'request_hash')) db.exec('ALTER TABLE messages ADD COLUMN request_hash TEXT');
  });
  function index(id) {
    db.prepare('DELETE FROM notes_fts WHERE note_id=?').run(id);
    const note = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!note) return;
    const body = db.prepare(`SELECT text FROM messages WHERE note_id=? ORDER BY created_at, rowid`).all(id).map(m => m.text).join('\n');
    const names = db.prepare(`SELECT a.name FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.note_id=?
      UNION ALL SELECT f.name FROM media_files f JOIN media_attachments a ON a.file_id=f.id JOIN messages m ON m.id=a.message_id WHERE m.note_id=?`).all(id, id).map(a => a.name).join('\n');
    db.prepare('INSERT INTO notes_fts VALUES(?,?,?,?)').run(id, note.title, note.summary, `${body}\n${names}\n${JSON.parse(note.tags).join(' ')}`);
  }
  function note(id) {
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) return null;
    const messages = db.prepare('SELECT id,note_id,role,text,reply_to,created_at FROM messages WHERE note_id=? ORDER BY created_at, rowid').all(id);
    for (const message of messages) message.attachments = db.prepare(`SELECT id,name,mime,length(data) size FROM attachments WHERE message_id=?
      UNION ALL SELECT a.id,f.name,f.mime,f.size FROM media_attachments a JOIN media_files f ON f.id=a.file_id WHERE a.message_id=?`).all(message.id, message.id);
    return { ...row, tags: JSON.parse(row.tags), avatar_options: JSON.parse(row.avatar_options), messages,
      sources: db.prepare('SELECT source_id,title,revision FROM merge_sources WHERE note_id=?').all(id) };
  }
  function create({ title = 'Новая мысль', color = 'yellow', avatar = randomInt(avatarHeads.length), pattern = 'none' } = {}) {
    const id = randomUUID();
    transaction(() => {
      db.prepare('INSERT INTO notes(id,title,color,avatar,assistant_name,avatar_options,pattern,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, title, color, avatar, newAssistantName(), newAvatarOptions(avatar), pattern, new Date().toISOString());
      index(id);
    });
    return note(id);
  }
  function checkRevision(id, revision) {
    if (revision !== undefined && db.prepare('SELECT revision FROM notes WHERE id=?').get(id)?.revision !== revision) {
      throw Object.assign(new Error('Заметка изменилась. Перезагрузите её перед повтором.'), { status: 409 });
    }
  }
  function addMessage(noteId, { id = randomUUID(), text, role = 'user', replyTo = null, attachments = [], attachmentIds = [], requestHash = null, revision, afterSave }) {
    transaction(() => {
      checkRevision(noteId, revision);
      db.prepare('INSERT INTO messages(id,note_id,role,text,reply_to,created_at,request_hash) VALUES(?,?,?,?,?,?,?)').run(id, noteId, role, text, replyTo, new Date().toISOString(), requestHash);
      for (const attachment of attachments) db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?)').run(randomUUID(), id, attachment.name, attachment.mime, attachment.data);
      for (const fileId of attachmentIds) {
        const file = db.prepare('SELECT * FROM media_files WHERE id=? AND note_id=?').get(fileId, noteId);
        if (!file || db.prepare('SELECT 1 FROM media_attachments WHERE file_id=?').get(fileId)) throw Object.assign(new Error('Вложение недоступно или уже отправлено.'), { status: 409 });
        db.prepare('INSERT INTO media_attachments VALUES(?,?,?)').run(randomUUID(), id, fileId);
      }
      db.prepare('UPDATE notes SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(), noteId);
      index(noteId);
      afterSave?.();
    });
    return id;
  }
  function update(id, fields, revision) {
    transaction(() => {
      checkRevision(id, revision);
      const current = note(id);
      db.prepare(`UPDATE notes SET title=?,color=?,avatar=?,pattern=?,revision=revision+1,
        summarized_revision=CASE WHEN summarized_revision=revision THEN summarized_revision+1 ELSE summarized_revision END,
        updated_at=? WHERE id=?`).run(fields.title ?? current.title, fields.color ?? current.color, fields.avatar ?? current.avatar, fields.pattern ?? current.pattern, new Date().toISOString(), id);
      index(id);
    });
    return note(id);
  }
  function summarize(id, summary, revision, source, key = '', tags) {
    transaction(() => {
      checkRevision(id, revision);
      db.prepare('UPDATE notes SET summary=?,summarized_revision=?,summary_source=?,summary_key=?,tags=? WHERE id=? AND revision=?').run(summary, revision, source, key, JSON.stringify(tags ?? note(id).tags), id, revision);
      index(id);
    });
    return note(id);
  }
  function mergeKey(sources) {
    // Messages are immutable; appearance changes must not create duplicate summaries.
    return createHash('sha256').update(JSON.stringify(sources.map(source => [source.id, source.messages.length]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex');
  }
  function canConsolidate(sources) {
    return !db.prepare('SELECT 1 FROM notes WHERE merge_key=?').get(mergeKey(sources))
      && sources.every(source => db.prepare('SELECT revision FROM notes WHERE id=?').get(source.id)?.revision === source.revision);
  }
  function consolidate(group, sources) {
    let created = false;
    transaction(() => {
      if (!canConsolidate(sources)) return;
      const id = randomUUID(), stamp = new Date().toISOString(), first = sources[0];
      db.prepare('INSERT INTO notes(id,title,summary,color,avatar,assistant_name,avatar_options,pattern,merge_key,revision,summarized_revision,summary_source,updated_at,tags) VALUES(?,?,?,?,?,?,?,?,?,2,2,?,?,?)')
        .run(id, group.title, group.summary, first.color, first.avatar, newAssistantName(), newAvatarOptions(first.avatar), first.pattern, mergeKey(sources), 'agent', stamp, JSON.stringify(group.tags ?? []));
      const sourceMessage = randomUUID();
      db.prepare('INSERT INTO messages(id,note_id,role,text,reply_to,created_at) VALUES(?,?,?,?,?,?)').run(sourceMessage, id, 'user', `Собрать общую заметку из: ${sources.map(source => `«${source.title}»`).join(', ')}.`, null, stamp);
      db.prepare('INSERT INTO messages(id,note_id,role,text,reply_to,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), id, 'assistant', group.body, null, stamp);
      for (const source of sources) {
        db.prepare('INSERT INTO merge_sources VALUES(?,?,?,?)').run(id, source.id, source.title, source.revision);
        for (const attachment of db.prepare('SELECT a.id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.note_id=?').all(source.id)) {
          db.prepare(`INSERT INTO attachments SELECT ?,?,original.name,original.mime,original.data FROM attachments original WHERE original.id=?
            AND NOT EXISTS (SELECT 1 FROM attachments copied WHERE copied.message_id=? AND copied.name=original.name AND copied.mime=original.mime AND copied.data=original.data)`)
            .run(randomUUID(), sourceMessage, attachment.id, sourceMessage);
        }
        for (const attachment of db.prepare('SELECT a.file_id FROM media_attachments a JOIN messages m ON m.id=a.message_id WHERE m.note_id=?').all(source.id)) {
          db.prepare('INSERT INTO media_attachments SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM media_attachments WHERE message_id=? AND file_id=?)')
            .run(randomUUID(), sourceMessage, attachment.file_id, sourceMessage, attachment.file_id);
        }
      }
      index(id);
      created = true;
    });
    return created;
  }
  function list(query = '') {
    const tags = [...query.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)].map(match => match[1].normalize('NFKC').toLowerCase());
    const text = query.replace(/#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, '');
    const tokens = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 20) || [];
    if (query.trim() && !tokens.length && !tags.length) return [];
    const saved = "EXISTS (SELECT 1 FROM messages m WHERE m.note_id=n.id AND m.role='user')" + tags.map(() => ' AND EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value=?)').join('');
    const rows = tokens.length
      ? db.prepare(`SELECT n.* FROM notes_fts f JOIN notes n ON n.id=f.note_id WHERE notes_fts MATCH ? AND ${saved} ORDER BY rank, n.updated_at DESC`).all(tokens.map(t => `"${t}"*`).join(' AND '), ...tags)
      : db.prepare(`SELECT n.* FROM notes n WHERE ${saved} ORDER BY updated_at DESC`).all(...tags);
    return rows.map(row => ({ ...row, tags: JSON.parse(row.tags), avatar_options: JSON.parse(row.avatar_options), ...db.prepare(`SELECT count(*) message_count, sum(role='user') thought_count FROM messages WHERE note_id=?`).get(row.id),
      attachment_count: db.prepare(`SELECT (SELECT count(*) FROM attachments a JOIN messages m ON a.message_id=m.id WHERE m.note_id=?) +
        (SELECT count(*) FROM media_attachments a JOIN messages m ON a.message_id=m.id WHERE m.note_id=?) total`).get(row.id, row.id).total,
      link_count: db.prepare(`SELECT text FROM messages WHERE note_id=? AND role='user'`).all(row.id).reduce((n,m) => n + (m.text.match(/https?:\/\/\S+/g)?.length || 0), 0),
    }));
  }
  function pruneTags(catalog) {
    for (const row of db.prepare("SELECT id,tags FROM notes WHERE tags<>'[]'").all()) {
      const tags = JSON.parse(row.tags).filter(tag => catalog.includes(tag));
      if (JSON.stringify(tags) === row.tags) continue;
      db.prepare("UPDATE notes SET tags=?,summary_key='' WHERE id=?").run(JSON.stringify(tags), row.id);
      index(row.id);
    }
  }
  db.function('kakuoku_lower', { deterministic: true }, value => String(value ?? '').toLowerCase());
  function listMedia({ query = '', cursor, limit = 60 } = {}) {
    if (typeof query !== 'string' || query.length > 300 || !Number.isInteger(limit) || limit < 1 || limit > 60) throw Object.assign(new Error('Некорректные параметры галереи.'), { status: 400 });
    let after;
    if (cursor) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 200) throw new Error();
        after = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!after || Array.isArray(after) || Object.keys(after).length !== 2 || typeof after.at !== 'string' || typeof after.id !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(after.at) || !/^[a-f0-9-]{36}$/.test(after.id)) throw new Error();
      } catch { throw Object.assign(new Error('Некорректный курсор галереи.'), { status: 400 }); }
    }
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 20);
    const where = terms.map(() => 'instr(kakuoku_lower(name || char(10) || title),?) > 0');
    const params = [...terms];
    if (after) { where.push('(createdAt < ? OR (createdAt = ? AND id > ?))'); params.push(after.at, after.at, after.id); }
    const rows = db.prepare(`SELECT * FROM (
      SELECT a.id,a.name,a.mime,length(a.data) size,m.note_id noteId,n.title,n.color,m.created_at createdAt
      FROM attachments a JOIN messages m ON m.id=a.message_id JOIN notes n ON n.id=m.note_id
      UNION ALL
      SELECT a.id,f.name,f.mime,f.size,m.note_id noteId,n.title,n.color,m.created_at createdAt
      FROM media_attachments a JOIN media_files f ON f.id=a.file_id JOIN messages m ON m.id=a.message_id JOIN notes n ON n.id=m.note_id
    ) WHERE (mime LIKE 'image/%' OR mime LIKE 'video/%' OR mime LIKE 'audio/%')
    ${where.length ? `AND ${where.join(' AND ')}` : ''} ORDER BY createdAt DESC,id ASC LIMIT ?`).all(...params, limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map(row => ({ ...row, url: `/api/attachments/${row.id}`, previewUrl: row.mime.startsWith('video/') ? `/api/attachments/${row.id}/preview` : row.mime.startsWith('image/') ? `/api/attachments/${row.id}` : null }));
    const last = items.at(-1);
    return { items, nextCursor: more ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString('base64url') : null };
  }
  function remove(id, revision) {
    transaction(() => {
      checkRevision(id, revision);
      db.prepare('DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE note_id=?)').run(id);
      // Delete replies first because reply_to is a foreign key.
      db.prepare('DELETE FROM messages WHERE note_id=? AND role=?').run(id, 'assistant');
      db.prepare('DELETE FROM notes WHERE id=?').run(id);
      index(id);
    });
  }
  return { db, transaction, note, create, addMessage, update, summarize, canConsolidate, consolidate, list, listMedia, remove, pruneTags };
}
