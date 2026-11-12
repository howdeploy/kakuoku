import { randomUUID } from 'node:crypto';

export const researchWindowMs = 30 * 60 * 1000;

export function openResearch(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL, state TEXT NOT NULL, events TEXT NOT NULL,
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_note ON research_runs(note_id);
    CREATE TABLE IF NOT EXISTS research_materials (
      id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      tool TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_material_run ON research_materials(run_id);
  `);
  for (const row of db.prepare("SELECT id,events FROM research_runs WHERE state='running'").all()) {
    const events = JSON.parse(row.events);
    events.push({ kind: 'error', text: 'Работа прервана перезапуском. Сохранённые материалы остались; запрос можно повторить.', at: new Date().toISOString() });
    db.prepare("UPDATE research_runs SET state='interrupted',events=? WHERE id=?").run(JSON.stringify(events), row.id);
  }
  function latest(noteId, messageId) {
    const row = messageId
      ? db.prepare('SELECT * FROM research_runs WHERE note_id=? AND message_id=? ORDER BY rowid DESC LIMIT 1').get(noteId, messageId)
      : db.prepare('SELECT * FROM research_runs WHERE note_id=? ORDER BY rowid DESC LIMIT 1').get(noteId);
    if (!row) return null;
    return { id: row.id, messageId: row.message_id, state: row.state, events: JSON.parse(row.events), updatedAt: row.updated_at, expiresAt: new Date(Date.parse(row.updated_at) + researchWindowMs).toISOString() };
  }
  function begin(noteId, messageId) {
    if (!db.prepare("SELECT 1 FROM messages WHERE id=? AND note_id=? AND role='user'").get(messageId, noteId)) throw Object.assign(new Error('Сообщение не найдено.'), { status: 404 });
    const now = new Date().toISOString();
    const previous = db.prepare('SELECT * FROM research_runs WHERE note_id=? ORDER BY rowid DESC LIMIT 1').get(noteId);
    const active = previous && Date.now() - Date.parse(previous.updated_at) < researchWindowMs;
    const sessionId = active ? previous.session_id : randomUUID();
    // Expiry changes context selection only; archived materials are never deleted here.
    const materials = active ? db.prepare(`SELECT m.tool,m.arguments,m.result,m.created_at FROM research_materials m
      JOIN research_runs r ON r.id=m.run_id WHERE r.note_id=? AND r.session_id=? ORDER BY m.id DESC LIMIT 50`).all(noteId, sessionId)
      .map(row => ({ tool: row.tool, arguments: JSON.parse(row.arguments), result: JSON.parse(row.result), at: row.created_at })) : [];
    const id = randomUUID();
    db.prepare('INSERT INTO research_runs VALUES(?,?,?,?,?,?,?,?)').run(id, noteId, messageId, sessionId, 'running', '[]', now, now);
    function progress(kind, text) {
      const row = db.prepare('SELECT events FROM research_runs WHERE id=?').get(id);
      if (!row) throw new Error('Журнал исследования недоступен.');
      const events = JSON.parse(row.events);
      events.push({ kind, text: String(text).slice(0, 1000), at: new Date().toISOString() });
      db.prepare('UPDATE research_runs SET events=?,updated_at=? WHERE id=?').run(JSON.stringify(events), new Date().toISOString(), id);
    }
    function material(tool, args, result) {
      db.prepare('INSERT INTO research_materials(run_id,tool,arguments,result,created_at) VALUES(?,?,?,?,?)').run(id, tool, JSON.stringify(args), JSON.stringify(result), new Date().toISOString());
    }
    function finish(state, text) {
      if (!['complete', 'partial', 'unavailable', 'error'].includes(state)) throw new Error('Некорректный итог исследования.');
      progress(state === 'error' ? 'error' : 'done', text);
      db.prepare('UPDATE research_runs SET state=? WHERE id=?').run(state, id);
    }
    progress('starting', 'Готовлю ответ');
    if (materials.length) progress('context', 'Использую сохранённые материалы этой заметки.');
    return { id, materials, progress, material, finish };
  }
  function touch(noteId) {
    const previous = db.prepare('SELECT id,updated_at FROM research_runs WHERE note_id=? ORDER BY rowid DESC LIMIT 1').get(noteId);
    if (previous && Date.now() - Date.parse(previous.updated_at) < researchWindowMs) db.prepare('UPDATE research_runs SET updated_at=? WHERE id=?').run(new Date().toISOString(), previous.id);
  }
  return { begin, latest, touch };
}
