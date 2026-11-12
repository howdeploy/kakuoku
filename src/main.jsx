import { t, useLanguage } from './i18n.mjs';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Agentation, loadAnnotations, saveAnnotations } from 'agentation';
import { avatarHeads, avatarFrameColors } from '../shared/avatars.mjs';
import { noteColors, notePatterns } from '../shared/appearance.mjs';
import SendButton from './SendButton.jsx';
import SearchField from './SearchField.jsx';
import AppSettings from './AppSettings.jsx';
import RichText from './RichText.jsx';
import PreviewStatus from './PreviewStatus.jsx';
import ResearchProgress from './ResearchProgress.jsx';
import Gallery, { Media } from './Gallery.jsx';
import CollectionHeading from './CollectionHeading.jsx';
import { transferFiles, hasFileTransfer } from './media-input.mjs';
import './vendor/sl-collection/buttons.js';
import './vendor/sl-collection/buttons.css';
import './vendor/sl-textarea/buttons.js';
import './vendor/sl-textarea/buttons.css';
import './vendor/sl-loading/buttons.js';
import './vendor/sl-loading/buttons.css';
import './style.css';

const colors = noteColors.map(color => color.id);
const colorNames = noteColors.map(color => color.name);
const patternChoices = [{ id: 'none', name: 'Без узора' }, ...notePatterns];
const avatarNames = avatarHeads.map(head => head.name);
const originalAvatarOptions = avatarHeads.slice(0, 6).map((_, head) => ({ head, frame: head }));
let session;
async function api(path, options = {}, refreshSession = true) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-kakuoku-token': session?.token || '', ...options.headers },
  });
  const result = await response.json();
  if (refreshSession && response.status === 403 && result.error === 'Перезагрузите приложение для обновления сессии.') {
    // The server rejected the token before executing the request, so one retry is safe.
    session = await api('/session', {}, false);
    return api(path, options, false);
  }
  if (!response.ok) throw Object.assign(new Error(result.error || t("Не удалось сохранить. Попробуйте ещё раз.")), { status: response.status });
  return result;
}
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result.split(',')[1] });
    reader.onerror = () => reject(new Error(t("Не удалось прочитать фото.")));
    reader.readAsDataURL(file);
  });
}
function Icon({ name, size = 20, ...props }) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    tools: <><path d="M4 6h16M4 12h16M4 18h16" /><rect x="7" y="3.5" width="4" height="5" rx="1.3" fill="var(--paper)" /><rect x="14" y="9.5" width="4" height="5" rx="1.3" fill="var(--paper)" /><rect x="7" y="15.5" width="4" height="5" rx="1.3" fill="var(--paper)" /></>,
    tag: <><path d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z" /><circle cx="7" cy="8" r="1.5" /></>,
    storage: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.65 3.6 3 8 3s8-1.35 8-3V5M4 12c0 1.65 3.6 3 8 3s8-1.35 8-3" /></>,
    broom: <><path d="M20 3 11.5 13.5" /><path d="m8 11 7 5-3.5 5H3l5-10Z" fill="currentColor" fillOpacity=".07" /><path d="m7 13 6.6 4.7M7 17l-2 4m5-2-1 2" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="m5 12 14 0m-6-6 6 6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    link: <><path d="m10 13 4-4M9 15l-1.5 1.5a4 4 0 0 1-5.7-5.7l4-4a4 4 0 0 1 5.7 0M15 9l1.5-1.5a4 4 0 0 1 5.7 5.7l-4 4a4 4 0 0 1-5.7 0" transform="translate(0 -1) scale(.96)" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
    chat: <><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 1 1 18 0Z" /><circle className="chat-dot" cx="7" cy="10.5" r="1" fill="currentColor" stroke="none" style={{ '--dot-order': 0 }} /><circle className="chat-dot" cx="11" cy="10.5" r="1" fill="currentColor" stroke="none" style={{ '--dot-order': 1 }} /><circle className="chat-dot" cx="15" cy="10.5" r="1" fill="currentColor" stroke="none" style={{ '--dot-order': 2 }} /></>,
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5L20 2Z" /></>,
    check: <path d="m5 12 4 4 10-10" />,
    trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    back: <path d="m14 5-7 7 7 7" />,
    settings: <><path d="m9 3-.7 2.2-2 .9L4 5.7 2.5 8.3l1.7 1.6-.2 2.2-1.7 1.6L4 16.3l2.3-.4 1.8 1.3.4 2.3h3l.8-2.2 2-.9 2.3.4 1.5-2.6-1.7-1.6.2-2.2 1.7-1.6L17 6.2l-2.3.4-1.8-1.3-.4-2.3Z" /><circle cx="10.5" cy="11.2" r="3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
function Avatar({ index = 0, src, label, size = 56, options = originalAvatarOptions }) {
  const frame = avatarFrameColors[options.find(option => option.head === index)?.frame ?? 0];
  const [layers, setLayers] = useState([{ index, src, id: 0, loaded: false }]);
  const latest = useRef({ index, src });
  const sequence = useRef(0);
  const cleanup = useRef(null);
  useLayoutEffect(() => {
    if (latest.current.index === index && latest.current.src === src) return;
    latest.current = { index, src };
    const id = ++sequence.current;
    clearTimeout(cleanup.current);
    setLayers(current => [...current, { index, src, id, loaded: false }]);
  }, [index, src]);
  useEffect(() => () => clearTimeout(cleanup.current), []);
  function loaded(id) {
    setLayers(current => current.map(layer => layer.id === id ? { ...layer, loaded: true } : layer));
    if (id === sequence.current) {
      clearTimeout(cleanup.current);
      cleanup.current = setTimeout(() => setLayers(current => current.filter(layer => layer.id >= id)), 360);
    }
  }
  return <span className="avatar-stack" style={{ '--avatar-size': `${size}px` }} role="img" aria-label={label || t(avatarNames[index])}>
    {layers.map(layer => {
      const head = avatarHeads[layer.index];
      return layer.src
        ? <img key={layer.id} className={`avatar avatar-layer ${layer.loaded ? 'is-loaded' : ''}`} src={layer.src} alt="" aria-hidden="true" onLoad={() => loaded(layer.id)} />
        : <svg key={layer.id} className={`avatar avatar-layer ${layer.loaded ? 'is-loaded' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
          <rect x="3" y="3" width="94" height="94" rx="21" fill="#fff" />
          {head.src
            ? <image href={head.src} x="5" y="5" width="90" height="90" onLoad={() => loaded(layer.id)} />
            : <svg x="5" y="5" width="90" height="90" viewBox={head.box.map((value, axis) => axis < 2 ? value + 18 : value - 36).join(' ')}><image href="/avatars.png" width="1536" height="1024" onLoad={() => loaded(layer.id)} /></svg>}
          <g className="avatar-frame" fill="none">
            <rect className="avatar-rim" x="3" y="3" width="94" height="94" rx="21" stroke={frame} strokeWidth="6" />
            <rect x=".75" y=".75" width="98.5" height="98.5" rx="23" stroke="#20251f" strokeWidth="1.5" />
            <rect x="6.5" y="6.5" width="87" height="87" rx="18" stroke="#20251f" strokeWidth="1.3" />
          </g>
        </svg>;
    })}
  </span>;
}

function Settings({ section, avatar, hasAvatar, onUpdated, onClosed, onPortal }) {
  const dialog = useRef(null);
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element.showModal(); onPortal(element);
    return () => { element.close(); onPortal(null); };
  }, [onPortal]);
  function close() {
    if (busy) return;
    dialog.current.classList.add('leaving');
    setTimeout(onClosed, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }
  async function upload(file) {
    if (!file || busy) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2_000_000) { setError(t("Выберите PNG, JPEG или WebP до 2 МБ.")); return; }
    setBusy(true); setError('');
    try { const result = await api('/profile/avatar', { method: 'POST', body: JSON.stringify(await readImage(file)) }); onUpdated(result.profile); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true); setError('');
    try { const result = await api('/profile/avatar', { method: 'DELETE' }); onUpdated(result.profile); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="settings-heading"><h2 id="settings-title">{section === 'profile' ? t("Профиль") : t("Настройки")}</h2><button className="icon-button" onClick={close} disabled={busy} aria-label={t("Закрыть настройки")}><Icon name="close" /></button></div>
    {section === 'profile' ? <div className="profile-settings"><Avatar src={avatar} label={t("Ваша аватарка")} size={112} /><input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { upload(event.target.files[0]); event.target.value = ''; }} /><button className="profile-upload" onClick={() => input.current.click()} disabled={busy}>{t("Выбрать аватарку")}</button><button className="text-button" onClick={reset} disabled={busy || !hasAvatar}>{t("Вернуть стандартную")}</button>{error && <p className="settings-error" role="alert">{t(error)}</p>}</div> : <div className="settings-placeholder">{t("Пока пусто")}</div>}
  </dialog>;
}
function Sorting({ onClosed, onUpdated, onPortal }) {
  const language = useLanguage(), describeRef = useRef(null);
  useLayoutEffect(() => { describeRef.current?.(); }, [language]);
  const dialog = useRef(null);
  const root = useRef(null);
  useEffect(() => {
    const element = dialog.current, panel = root.current;
    element.showModal(); onPortal(element);
    let job;
    const describe = () => {
      if (!job) return;
      const title = job.state === 'running' ? t("Агент пересобирает заметки") : job.state === 'complete' ? t("Готово") : job.state === 'unavailable' ? t("Нужен подключённый агент") : t("Сортировка не завершена");
      panel.querySelector('[data-title]').textContent = title;
      panel.querySelector('[data-detail]').textContent = t(job.message);
      if (job.state !== 'running') panel.querySelector(job.state === 'complete' ? '[data-live]' : '[data-error]').textContent = `${title}. ${t(job.message)}`;
    };
    describeRef.current = describe;
    const feedback = window.MatteFeedback.mount(panel, { translate: t, onAction: async (_action, { signal }) => {
      let timer, wake;
      const cancelWait = () => { clearTimeout(timer); wake?.(); };
      signal.addEventListener('abort', cancelWait, { once: true });
      try {
        job = (await api('/sort', { method: 'POST', body: '{}', signal })).job;
        describe();
        while (job.state === 'running') {
          await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 900); });
          wake = null; signal.throwIfAborted();
          job = (await api('/sort', { signal })).job;
          describe();
        }
        if (job.state !== 'complete') throw new Error(job.message);
        onUpdated();
      } catch (error) {
        if (!job || job.state === 'running') job = { state: 'error', message: error.message };
        throw error;
      } finally { signal.removeEventListener('abort', cancelWait); clearTimeout(timer); }
    } });
    panel.addEventListener('feedbackcomplete', describe);
    panel.addEventListener('feedbackerror', describe);
    feedback.run('sort');
    return () => { describeRef.current = null; panel.removeEventListener('feedbackcomplete', describe); panel.removeEventListener('feedbackerror', describe); feedback.destroy(); element.close(); onPortal(null); };
  }, [onPortal]);
  function close() {
    dialog.current.classList.add('leaving');
    setTimeout(() => { onUpdated(); onClosed(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }
  return <dialog ref={dialog} className="settings-dialog sorting-dialog" aria-labelledby="sort-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <button className="icon-button sorting-close" onClick={close} aria-label={t("Закрыть окно сортировки")}><Icon name="close" /></button>
    <div ref={root} className="fb-demo sort-status" data-feedback="loading" tabIndex={-1}>
      <div className="fb-scene"><div className="fb-card fb-loader-card"><div className="fb-dots" aria-hidden="true"><i /><i /><i /></div><h3 id="sort-title" data-title>{t("Сортировка")}</h3><p data-detail>{t("Заметки с общими темами будут собраны вместе.")}</p></div></div>
      <span className="fb-sr" data-live role="status" aria-live="polite" aria-atomic="true" /><span className="fb-sr" data-error role="alert" aria-atomic="true" />
    </div>
  </dialog>;
}

function NotePattern({ value }) {
  return <span className="note-pattern" aria-hidden="true">{notePatterns.map(pattern => <span key={pattern.id} className={`pattern-layer ${value === pattern.id ? 'is-active' : ''}`} style={{ backgroundImage: `url(/patterns/${pattern.id}.svg)` }} />)}</span>;
}

function Card({ note, onOpen, index, updating, working }) {
  const summary = note.summary || t("Пока чистый лист. Откройте чат и оставьте первую мысль.");
  return <button type="button" className={`note-card tone-${note.color}`} onClick={() => onOpen(note.id)} style={{ '--card-order': Math.min(index, 5) }} aria-label={t("{0}. Открыть чат", [note.title])} data-note-title={note.title}>
    <NotePattern value={note.pattern} />
    <div className="card-top"><Avatar index={note.avatar} options={note.avatar_options} /><h2>{note.title}</h2></div>
    <div className="card-summary">{working ? <PreviewStatus label={t("Агент работает")} /> : updating && <PreviewStatus />}{summary}</div>
    <div className="card-tags" aria-label={note.tags?.length ? t("Теги: {0}", [note.tags.join(', ')]) : t("Без тегов")}>{note.tags?.length ? note.tags.map(tag => <span key={tag} title={t("Поиск: #{0}", [tag])}>#{tag}</span>) : <span className="card-tags-empty">{t("Без тегов")}</span>}</div>
  </button>;
}

function NoteGrid({ notes, loading, onOpen, previewing, replying, activity }) {
  const grid = useRef(null);
  useLayoutEffect(() => {
    const cells = [...grid.current.children];
    const layout = () => {
      const gap = parseFloat(getComputedStyle(grid.current).getPropertyValue('--note-gap'));
      for (const cell of cells) {
        const rows = Math.ceil(cell.firstElementChild.offsetHeight + gap);
        console.assert(Number.isFinite(rows) && rows > 0, 'Invalid note height');
        cell.style.gridRowEnd = `span ${rows}`;
      }
    };
    layout();
    const observer = new ResizeObserver(layout);
    cells.forEach(cell => observer.observe(cell.firstElementChild));
    return () => observer.disconnect();
  }, [notes]);
  return <div ref={grid} className={`note-grid ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
    {notes.map((note,index) => <div className="note-cell" key={note.id}><Card note={note} index={index} working={Boolean(replying[note.id] || note.agentWorking || activity.some(item => item.noteId === note.id && item.agentWorking))} updating={Boolean(previewing[note.id] || note.previewPending || activity.some(item => item.noteId === note.id && item.previewPending))} onOpen={onOpen} /></div>)}
  </div>;
}

function Chat({ noteId, initialNote = null, onClosed, onClosing, onReply, onUpdated, onPortal, sessionInfo, userAvatar }) {
  const language = useLanguage();
  const dialog = useRef(null);
  const scroller = useRef(null);
  const upload = useRef(null);
  const textInput = useRef(null);
  const composer = useRef(null);
  const composerControl = useRef(null);
  const sendControl = useRef(null);
  const hasScrolled = useRef(false);
  const [note, setNote] = useState(initialNote);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [patching, setPatching] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const [error, setError] = useState('');
  const [retryId, setRetryId] = useState(null);
  const [pendingMessage, setPendingMessage] = useState(null);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [researchProgress, setResearchProgress] = useState(null);
  const [researchMessageId, setResearchMessageId] = useState(null);
  const [recoveringReply, setRecoveringReply] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleBeforeEdit = useRef('');
  const cancelTitleEdit = useRef(false);
  const pendingPatch = useRef(null);
  const draftRef = useRef(null);
  const uploadedFiles = useRef(new Map());
  const closed = useRef(false);
  const saving = busy || closing || recoveringReply || patching;
  const closeBlocked = closing || patching || (busy && !waitingForReply && !recoveringReply);
  const titleBlocked = closeBlocked || !note;
  const hasMessages = note?.messages.some(message => message.role === 'user');
  const acceptNote = useCallback(next => setNote(current => current && current.revision > next.revision ? current : next), []);

  useLayoutEffect(() => {
    const controller = window.MatteTextareaInput.mount(composer.current, { translate: t });
    composerControl.current = controller;
    return () => { controller.destroy(); composerControl.current = null; };
  }, []);
  useLayoutEffect(() => { composerControl.current?.refresh(); }, [text, language]);

  useEffect(() => {
    const element = dialog.current;
    element.showModal(); onPortal(element);
    const abort = new AbortController();
    if (!initialNote) api(`/notes/${noteId}`, { signal: abort.signal }).then(({ note, busy, research }) => {
      acceptNote(note);
      if (busy && research?.state === 'running') {
        setResearchProgress(research); setResearchMessageId(research.messageId);
        setRecoveringReply(true); setWaitingForReply(true);
      } else if (busy) setError(t("В этой заметке ещё выполняется запрос. Переписка сохранена; откройте её после завершения."));
      else if (sessionInfo.agentEnabled && note.messages.at(-1)?.role === 'user') {
        setRetryId(note.messages.at(-1).id);
        setError(t("Ответ на последнее сообщение не сохранён. Можно повторить запрос."));
      }
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => { abort.abort(); element.close(); onPortal(null); };
  }, [noteId, initialNote, onPortal, acceptNote]);
  useEffect(() => {
    if (!waitingForReply || !researchMessageId) return;
    const abort = new AbortController();
    let timer, failures = 0;
    async function poll() {
      try {
        const { research } = await api(`/notes/${noteId}/research?messageId=${encodeURIComponent(researchMessageId)}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        failures = 0;
        if (research) setResearchProgress(research);
        if (recoveringReply && research && research.state !== 'running') {
          const { note } = await api(`/notes/${noteId}`, { signal: abort.signal });
          if (abort.signal.aborted) return;
          acceptNote(note);
          if (!note.messages.some(message => message.reply_to === researchMessageId)) {
            setRetryId(researchMessageId); setError(research.events.at(-1)?.text || t("Ответ не сохранён. Можно повторить запрос."));
          }
          setRecoveringReply(false); setWaitingForReply(false); setResearchMessageId(null); onUpdated();
          return;
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        if (++failures >= 3 && recoveringReply) {
          setRecoveringReply(false); setWaitingForReply(false); setResearchMessageId(null);
          setError(t("Не удалось получить состояние работы. Запрос на сервере мог продолжиться; откройте заметку позже."));
          return;
        }
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 1000);
    }
    poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [waitingForReply, researchMessageId, recoveringReply, noteId, acceptNote]);
  useEffect(() => {
    if (!note) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: !hasScrolled.current || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    hasScrolled.current = true;
  }, [note?.messages.length, pendingMessage, waitingForReply, researchProgress?.events.length]);
  useEffect(() => {
    const warn = event => { if (text.trim() || files.length || saving) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [text, files.length, saving]);

  async function patch(fields, previousTitle = note?.title) {
    const titleOnly = Object.keys(fields).length === 1 && fields.title !== undefined;
    if (!note || (titleOnly ? titleBlocked : saving)) return;
    setPatching(true); setError('');
    const request = api(`/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ ...fields, ...(titleOnly ? { previousTitle } : {}) }) });
    pendingPatch.current = request;
    try { const result = await request; acceptNote(result.note); onUpdated(); }
    catch (error) { setError(error.message); }
    finally { if (pendingPatch.current === request) pendingPatch.current = null; setPatching(false); }
  }
  async function chooseFiles(list) {
    if (saving || !note) return;
    const candidates = Array.from(list || []);
    if (files.length + candidates.length > 4) { setError(t("Не больше четырёх медиа за раз.")); return; }
    if (candidates.some(file => file.size > 128 * 1024 * 1024)) { setError(t("Размер каждого файла — до 128 МиБ.")); return; }
    setError(''); setFiles(current => [...current, ...candidates]); draftRef.current = null;
  }
  function pasteMedia(event) {
    const incoming = transferFiles(event.clipboardData);
    if (!incoming.length) return;
    event.preventDefault();
    chooseFiles(incoming);
  }
  function dropMedia(event) {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation();
    const incoming = transferFiles(event.dataTransfer);
    if (incoming.length) chooseFiles(incoming);
    else if (!saving) setError(t("Не удалось получить файл из перетаскивания. Выберите файл кнопкой вложения или вставьте скопированное изображение через Ctrl+V."));
  }
  async function payload(signal) {
    if (draftRef.current) return draftRef.current;
    const attachmentIds = [];
    for (const file of files) {
      let record = uploadedFiles.current.get(file);
      if (!record) { record = { id: crypto.randomUUID(), uploaded: false }; uploadedFiles.current.set(file, record); }
      if (!record.uploaded) {
        try {
          await api(`/notes/${noteId}/attachments/${record.id}`, { method: 'PUT', body: file, signal, headers: { 'content-type': 'application/octet-stream', 'x-kakuoku-filename': encodeURIComponent(file.name) } });
          record.uploaded = true;
        } catch (error) {
          if (signal?.aborted) throw error;
          const { attachments } = await api(`/notes/${noteId}/attachments`);
          record.uploaded = attachments.some(item => item.id === record.id && item.size === file.size);
          if (!record.uploaded) throw error;
        }
      }
      attachmentIds.push(record.id);
    }
    draftRef.current = { id: crypto.randomUUID(), text, attachmentIds };
    return draftRef.current;
  }
  async function send({ signal } = {}) {
    if (saving || (!text.trim() && !files.length)) throw new Error(t("Добавьте сообщение или фото."));
    const attachments = files.map(file => ({ name: file.name, mime: file.type || 'application/octet-stream', url: URL.createObjectURL(file) }));
    setBusy(true); setError('');
    setPendingMessage({ text: text.trim(), attachments });
    setResearchProgress(null);
    setWaitingForReply(false);
    setText(''); setFiles([]);
    try {
      const data = await payload(signal);
      setResearchMessageId(data.id);
      setWaitingForReply(sessionInfo.agentEnabled);
      const result = await onReply(noteId, data, false, note?.title);
      acceptNote(result.note); setText(''); setFiles([]); draftRef.current = null; uploadedFiles.current.clear();
      setRetryId(result.retryMessageId || null);
      if (result.warning && sessionInfo.agentEnabled) setError(result.warning);
      onUpdated();
    } catch (error) {
      setText(text); setFiles(files);
      setError(t("{0} Черновик возвращён в поле ввода; повторная отправка использует тот же ID.", [error.name === 'AbortError' ? 'Отправка прервана в интерфейсе; сообщение уже могло сохраниться.' : error.message]));
      throw error;
    } finally {
      setPendingMessage(null); setWaitingForReply(false); setResearchMessageId(null); setBusy(false);
      attachments.forEach(file => URL.revokeObjectURL(file.url));
      textInput.current?.focus();
    }
  }
  async function retry() {
    setBusy(true); setError('');
    setResearchProgress(null); setResearchMessageId(retryId);
    setWaitingForReply(sessionInfo.agentEnabled);
    try {
      const result = await onReply(noteId, { messageId: retryId }, true, note?.title);
      acceptNote(result.note); setRetryId(result.retryMessageId || null);
      if (result.warning && sessionInfo.agentEnabled) setError(result.warning);
      onUpdated();
    } catch (error) { setError(error.message); }
    finally { setWaitingForReply(false); setResearchMessageId(null); setBusy(false); }
  }
  async function close() {
    if (closeBlocked || closed.current) return;
    closed.current = true;
    setClosing(true); setError('');
    try {
      await pendingPatch.current;
      onClosing(noteId, note?.title || t("Заметка"), researchMessageId);
      dialog.current.classList.add('leaving');
      const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
      setTimeout(() => { onUpdated(); onClosed(); }, motion);
    } catch (error) { closed.current = false; setError(error.message); setClosing(false); throw error; }
  }
  async function remove() {
    setBusy(true);
    try { await api(`/notes/${noteId}`, { method: 'DELETE' }); onUpdated(); closed.current = true; onClosed(); }
    catch (error) { setError(error.message); setBusy(false); }
  }

  return <dialog ref={dialog} className={`chat-dialog tone-${note?.color || 'white'}`} data-note-title={note?.title} data-note-id={noteId} onPaste={pasteMedia} onDragOver={event => { if (hasFileTransfer(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = saving || !note ? 'none' : 'copy'; } }} onDrop={dropMedia} onKeyDownCapture={event => { if (event.key === 'Escape' && !editingTitle && (waitingForReply || recoveringReply)) { event.preventDefault(); event.stopPropagation(); close().catch(() => {}); } }} onCancel={event => { event.preventDefault(); close().catch(() => {}); }} onClick={event => { if (event.target === dialog.current) close().catch(() => {}); }} aria-labelledby="chat-title">
    <div className="chat-shell">
      <header className="chat-header">
        <NotePattern value={note?.pattern} />
        {note && <button className="avatar-button" onClick={() => setAppearance(!appearance)} disabled={saving} aria-label={t("Выбрать аватарку и цвет")} aria-expanded={appearance}><Avatar index={note.avatar} options={note.avatar_options} size={52} /><span className="avatar-edit"><Icon name="down" size={11} /></span></button>}
        <div className="chat-heading"><h2 id="chat-title">{editingTitle ? <input className="title-input" aria-label={t("Название заметки")} value={titleDraft} maxLength={120} autoFocus onFocus={event => event.currentTarget.select()} onChange={event => setTitleDraft(event.target.value)} onBlur={() => { setEditingTitle(false); if (!cancelTitleEdit.current && titleDraft.trim() && titleDraft.trim() !== titleBeforeEdit.current) patch({ title: titleDraft.trim() }, titleBeforeEdit.current); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelTitleEdit.current = true; event.currentTarget.blur(); } }} /> : <button className="title-button" disabled={titleBlocked} aria-label={t("Редактировать название")} onClick={() => { cancelTitleEdit.current = false; titleBeforeEdit.current = note.title; setTitleDraft(note.title); setEditingTitle(true); }}>{note?.title || t("Открываю заметку…")}</button>}</h2></div>
        <button className="icon-button close-chat" onClick={() => close().catch(() => {})} disabled={closeBlocked} aria-label={t("Закрыть чат и обновить превью")}><Icon name="close" size={23} /></button>
      </header>
      {note && <div className={`appearance-disclosure ${appearance ? 'is-open' : ''}`} inert={!appearance ? true : undefined} aria-hidden={!appearance}><div className="appearance-clip"><section className="appearance" aria-label={t("Оформление заметки")}>
        <div className="avatar-options">{(note.avatar_options || originalAvatarOptions).map(({ head }) => <button key={head} className={note.avatar === head ? 'selected' : ''} aria-label={t(avatarNames[head])} aria-pressed={note.avatar === head} disabled={saving} onClick={() => patch({ avatar: head })}><Avatar index={head} options={note.avatar_options} size={44} /></button>)}</div>
        <div className="appearance-bottom"><div className="color-options">{colors.map((color,index) => <button key={color} className={`color-swatch tone-${color} ${note.color === color ? 'selected' : ''}`} disabled={saving} aria-pressed={note.color === color} aria-label={t(colorNames[index])} onClick={() => patch({ color })}><Icon name="check" size={16} /></button>)}</div>{hasMessages && <button className="text-button danger" disabled={saving} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} />{t("Удалить")}</button>}</div>
        <div className="pattern-options">{patternChoices.map(pattern => <button key={pattern.id} className={`pattern-choice ${(note.pattern || 'none') === pattern.id ? 'selected' : ''}`} title={t(pattern.name)} aria-label={t(pattern.name)} aria-pressed={(note.pattern || 'none') === pattern.id} disabled={saving} onClick={() => patch({ pattern: pattern.id })}><NotePattern value={pattern.id} />{pattern.id === 'none' && <Icon name="close" size={18} />}<span className="pattern-selected"><Icon name="check" size={13} /></span></button>)}</div>
      </section></div></div>}
      {confirmDelete && hasMessages && <div className="delete-confirm" role="alert"><p>{t("Удалить заметку вместе с перепиской и фото? Вернуть её не получится.")}</p><button className="text-button" onClick={() => setConfirmDelete(false)} disabled={saving}>{t("Оставить")}</button><button className="text-button danger" onClick={remove} disabled={saving}>{t("Удалить заметку")}</button></div>}
      <div className="conversation" ref={scroller} aria-label={t("Переписка")} tabIndex={0}>
        {note && !note.messages.length && !pendingMessage && <div className="chat-empty">{t("Как видишь пусто")}</div>}
        {note?.messages.map(message => <article key={message.id} className={`message message-${message.role}`}>
          <div className="message-meta">{message.role === 'user' ? <><Avatar src={userAvatar} label={t("Вы")} size={28} />{t("Вы")}</> : <><Avatar index={note.avatar} options={note.avatar_options} size={28} />{note.assistant_name}</>}</div>
          <div className="message-text message-markdown"><RichText text={message.text} /></div>
          {message.attachments.length > 0 && <div className="message-images">{message.attachments.map(file => <figure key={file.id}><Media item={file} expanded /><figcaption>{file.name}</figcaption></figure>)}</div>}
        </article>)}
        {pendingMessage && !note?.messages.some(message => message.id === researchMessageId) && <article className="message message-user" aria-label={t("Отправляемое сообщение")}>
          <div className="message-meta"><Avatar src={userAvatar} label={t("Вы")} size={28} />{t("Вы")}</div>
          {pendingMessage.text && <div className="message-text message-markdown"><RichText text={pendingMessage.text} /></div>}
          {pendingMessage.attachments.length > 0 && <div className="message-images">{pendingMessage.attachments.map((file, index) => <figure key={index}><Media item={file} expanded /><figcaption>{file.name}</figcaption></figure>)}</div>}
          <div className="message-pending-status" role="status">{t("Отправляется…")}</div>
        </article>}
        {waitingForReply && note && <article className="message message-assistant" aria-label={t("Ход работы агента")}>
          <div className="message-meta"><Avatar index={note.avatar} options={note.avatar_options} size={28} />{note.assistant_name}</div>
          <ResearchProgress progress={researchProgress} />
        </article>}
        {error && <article className="message message-error" role="alert"><p>{t(error)}</p>{retryId && <button className="text-button" onClick={retry} disabled={saving}>{t("Повторить ответ")}</button>}{hasMessages && !saving && <button className="text-button" onClick={() => { closed.current = true; onUpdated(); onClosed(); }}>{t("Закрыть с прежним превью")}</button>}</article>}
      </div>
      <div className="chat-controls">
        <form ref={composer} className="composer sl-field sl-field--textarea" data-source="sl-ui:matte-textarea-input" onSubmit={event => { event.preventDefault(); sendControl.current?.start(); }}>
          {files.length > 0 && <div className="pending-files">{files.map((file,index) => <span key={`${file.name}-${index}`}><Icon name="image" size={15} />{file.name}<button type="button" aria-label={t("Убрать {0}", [file.name])} disabled={saving} onClick={() => { setFiles(files.filter((_,i) => i !== index)); draftRef.current = null; }}><Icon name="close" size={13} /></button></span>)}</div>}
          <div className="sl-field__control">
            <textarea ref={textInput} className="sl-field__input" id="chat-message" value={text} maxLength={20000} disabled={saving || !note} onChange={event => { setText(event.target.value); draftRef.current = null; }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendControl.current?.start(); } }} placeholder=" " aria-label={t("Сообщение")} aria-describedby="chat-message-help" rows={1} />
            <label className="sl-field__label" htmlFor="chat-message">{t("Мысль, ссылка или что-то ещё…")}</label>
            <span className="sl-field__counter sr-only" aria-hidden="true"><span data-count>0</span><span>/20000</span></span>
          </div>
          <p className="sl-field__helper sr-only" id="chat-message-help">{t("До 20 000 символов.")}</p>
          <div className="composer-bottom"><input ref={upload} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mp4,audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/opus,audio/webm" multiple onChange={event => { chooseFiles(event.target.files); event.target.value = ''; }} /><button type="button" className="icon-button" aria-label={t("Прикрепить медиа")} disabled={saving || !note} onClick={() => upload.current.click()}><Icon name="image" /></button><button type="button" className="icon-button" aria-label={t("Вставить ссылку")} disabled={saving || !note} onClick={() => { if (!text) setText('https://'); textInput.current.focus(); }}><Icon name="link" /></button><SendButton ref={sendControl} onSend={send} disabled={saving || !note || (!text.trim() && !files.length)} /></div>
        </form>
      </div>
    </div>
  </dialog>;
}

function App() {
  const language = useLanguage();
  const navigation = useRef(null);
  const navigationController = useRef(null);
  useLayoutEffect(() => { navigationController.current?.refreshLocale(); }, [language]);
  const [section, setSection] = useState(0);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [notes, setNotes] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [previewing, setPreviewing] = useState({});
  const [replying, setReplying] = useState({});
  const [activity, setActivity] = useState([]);
  const replyRequests = useRef(new Map());
  const [activeId, setActiveId] = useState(null);
  const [createdNote, setCreatedNote] = useState(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [portal, setPortal] = useState(null);
  const [feedbackError, setFeedbackError] = useState('');
  const [profile, setProfile] = useState({ avatarVersion: null });
  const [settings, setSettings] = useState(null);
  const [sortingOpen, setSortingOpen] = useState(false);
  const userAvatar = profile.avatarVersion ? `/api/profile/avatar?v=${encodeURIComponent(profile.avatarVersion)}` : '/user-avatar.svg';
  const search = useRef(null);
  const createBar = useRef(null);
  const lastCreatedAvatar = useRef(null);
  const feedback = useRef(new Map());
  const feedbackQueue = useRef(Promise.resolve());
  const setDialogPortal = useCallback(element => setPortal(element), []);

  useEffect(() => {
    const controller = window.MatteNavigation.mount(navigation.current, { onChange: setSection, translate: t });
    navigationController.current = controller;
    return () => { controller.destroy(); navigationController.current = null; };
  }, []);

  useEffect(() => {
    api('/session').then(async info => {
      session = info;
      try { setProfile((await api('/profile')).profile); }
      catch (error) { setNotice(error.message); }
      if (info.demo) {
        try {
          const { annotations } = await api('/feedback');
          const merged = new Map([...loadAnnotations(location.pathname), ...annotations].map(a => [a.id,a]));
          feedback.current = merged;
          saveAnnotations(location.pathname, [...merged.values()]);
        } catch (error) { setFeedbackError(error.message); }
      }
      setSessionInfo(info);
    }).catch(error => { setNotice(error.message); setLoading(false); });
  }, []);
  useEffect(() => {
    if (!sessionInfo) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api(`/notes?q=${encodeURIComponent(query)}`, { signal: abort.signal }).then(({ notes, activity }) => { setNotes(notes); setActivity(activity || []); setLoading(false); }).catch(error => { if (error.name !== 'AbortError') { setNotice(error.message); setLoading(false); } });
    }, query ? 160 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, refresh, sessionInfo]);
  useEffect(() => {
    if (!sessionInfo || (!activity.length && !Object.keys(replying).length && !Object.keys(previewing).length)) return;
    const abort = new AbortController();
    let timer, previous = JSON.stringify(activity), failures = 0;
    async function poll() {
      try {
        const result = await api('/activity', { signal: abort.signal });
        if (abort.signal.aborted) return;
        const next = JSON.stringify(result.activity);
        if (next !== previous) { previous = next; setRefresh(value => value + 1); }
        setActivity(result.activity); failures = 0;
      } catch (error) { if (!abort.signal.aborted && ++failures === 3) setNotice(t("Не удалось обновить состояние агента. Сервер мог продолжить работу.")); }
      if (!abort.signal.aborted) timer = setTimeout(poll, 1500);
    }
    poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [sessionInfo, activity.length, Object.keys(replying).length, Object.keys(previewing).length]);
  useEffect(() => {
    const keydown = event => {
      if (event.ctrlKey && event.key.toLowerCase() === 'k' && !activeId && !sortingOpen) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeId, sortingOpen]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  function saveFeedback(annotation, action = 'set') {
    if (action === 'delete') feedback.current.delete(annotation.id);
    else if (action === 'clear') annotation.forEach(item => feedback.current.delete(item.id));
    else feedback.current.set(annotation.id, annotation);
    const snapshot = JSON.stringify([...feedback.current.values()]);
    feedbackQueue.current = feedbackQueue.current.catch(() => {}).then(() => api('/feedback', { method: 'POST', body: snapshot })).then(() => setFeedbackError('')).catch(error => setFeedbackError(t("Комментарий пока только в браузере: {0}", [error.message])));
  }
  async function create() {
    if (!sessionInfo || creating) return;
    setCreating(true);
    try {
      const choices = avatarNames.map((_, index) => index).filter(index => index !== lastCreatedAvatar.current);
      const avatar = choices[Math.floor(Math.random() * choices.length)];
      const { note } = await api('/notes', { method: 'POST', body: JSON.stringify({ title: t('Новая мысль'), color: colors[notes.length % colors.length], avatar }) });
      lastCreatedAvatar.current = note.avatar;
      setCreatedNote(note);
      setActiveId(note.id); setRefresh(n => n + 1);
    } catch (error) { setNotice(error.message); }
    finally { setCreating(false); }
  }
  function requestReply(noteId, data, retry, title = t("Заметка")) {
    if (replyRequests.current.has(noteId)) return replyRequests.current.get(noteId);
    setReplying(current => ({ ...current, [noteId]: true }));
    // The application owns HTTP work; closing Chat only destroys its presentation.
    const promise = api(`/notes/${noteId}/${retry ? 'reply' : 'messages'}`, { method: 'POST', body: JSON.stringify(data) })
      .then(result => { if (result.warning) setNotice(`${title}: ${result.warning}`); return result; })
      .catch(error => { setNotice(t("{0}: {1} Запрос на сервере мог продолжиться.", [title, error.message])); throw error; })
      .finally(() => {
        replyRequests.current.delete(noteId);
        setReplying(current => { const next = { ...current }; delete next[noteId]; return next; });
        setRefresh(value => value + 1);
      });
    replyRequests.current.set(noteId, promise);
    setRefresh(value => value + 1);
    return promise;
  }
  function updatePreview(noteId, title, messageId) {
    // Keep the request outside Chat so unmounting the dialog does not own its result.
    setPreviewing(current => ({ ...current, [noteId]: (current[noteId] || 0) + 1 }));
    const pendingReply = replyRequests.current.get(noteId);
    const closeRequest = () => api(`/notes/${noteId}/close`, { method: 'POST', body: JSON.stringify(messageId ? { messageId } : {}) });
    closeRequest().catch(async error => {
      if (error.status !== 409 || !pendingReply) throw error;
      await pendingReply.catch(() => {});
      return closeRequest();
    })
      .then(result => { if (result.warning) setNotice(`${title}: ${result.warning}`); })
      .catch(error => setNotice(t("{0}: не удалось завершить закрытие. {1}", [title, error.message])))
      .finally(() => {
        setPreviewing(current => {
          const next = { ...current, [noteId]: current[noteId] - 1 };
          if (!next[noteId]) delete next[noteId];
          return next;
        });
        setRefresh(n => n + 1);
      });
  }
  function closeChat() { setActiveId(null); setCreatedNote(null); if (section === 0) requestAnimationFrame(() => createBar.current?.focus()); }
  return <>
    <main ref={navigation} className="collection collection-navigation" data-navigation="carousel">
      <div className="collection-heading"><CollectionHeading /><SearchField ref={search} value={query} onChange={setQuery} label={section === 1 ? t("Поиск по имени файла и названию заметки") : t("Поиск по заметкам, переписке и #тегам")} /><div className="collection-tools"><button className="profile-button" aria-label={t("Профиль и аватарка")} onClick={() => setSettings('profile')} disabled={!sessionInfo}><Avatar src={userAvatar} label={t("Вы")} size={40} /></button><button className="settings-button" aria-label={t("Настройки приложения")} onClick={() => setSettings('app')} disabled={!sessionInfo}><Icon name="settings" size={30} /></button></div></div>
      {notice && <div className="collection-notice" role="alert">{t(notice)}<button className="text-button" onClick={() => { setRefresh(n => n + 1); setNotice(''); }}>{t("Обновить")}</button></div>}
      <div className="section-stage"><div className="section-track">
      <section className="section-panel" data-section-panel="0" aria-labelledby="notes-section-title">
      <div className="collection-actions">
        <button className="sort-note" type="button" disabled={!sessionInfo} aria-haspopup="dialog" aria-expanded={sortingOpen} onClick={() => setSortingOpen(true)}><Icon name="broom" size={28} /><span>{t("Сортировка")}</span></button>
        <button ref={createBar} className="create-note" onClick={create} disabled={creating || !sessionInfo}><span className="create-icon"><Icon name="plus" size={23} /></span><span>{creating ? t("Создаю…") : t("Новая заметка")}</span><span className="create-tail"><Icon name="chat" size={26} /></span></button>
      </div>
      {!sortingOpen && (loading && !notes.length ? <div className="loading-state" role="status"><span className="thinking-dots"><i /><i /><i /></span>{t("Собираю ваши заметки…")}</div> : notes.length ? <NoteGrid notes={notes} loading={loading} previewing={previewing} replying={replying} activity={activity} onOpen={setActiveId} /> : <div className="collection-empty"><Avatar index={0} src={query ? '/search-empty-avatar.png' : undefined} label={query ? t("Чудак с усами и моноклем") : undefined} size={92} /><h2>{query ? t("Такого мы не имем-с") : t("Место для первой мысли")}</h2>{!query && <p>{t("Не нужно придумывать структуру. Просто начните разговор.")}</p>}<button className="text-button" onClick={query ? () => setQuery('') : create}>{query ? t("Показать все заметки") : t("Создать заметку")}<Icon name="arrow" size={17} /></button></div>)}
      </section>
      <section className="section-panel" data-section-panel="1" aria-labelledby="gallery-section-title" aria-hidden="true" inert><Gallery request={api} enabled={section === 1} ready={Boolean(sessionInfo)} refresh={refresh} query={query} Icon={Icon} onOpen={setActiveId} onPortal={setDialogPortal} /></section>
      </div></div>
    </main>
    {activeId && sessionInfo && <Chat key={activeId} noteId={activeId} initialNote={createdNote?.id === activeId ? createdNote : null} sessionInfo={sessionInfo} userAvatar={userAvatar} onClosed={closeChat} onClosing={updatePreview} onReply={requestReply} onUpdated={() => setRefresh(n => n + 1)} onPortal={setDialogPortal} />}
    {settings === 'profile' && <Settings section={settings} avatar={userAvatar} hasAvatar={Boolean(profile.avatarVersion)} onUpdated={setProfile} onClosed={() => setSettings(null)} onPortal={setDialogPortal} />}
    {settings === 'app' && <AppSettings request={api} Icon={Icon} onUpdated={info => { session = info; setSessionInfo(info); setRefresh(n => n + 1); }} onClosed={() => setSettings(null)} onPortal={setDialogPortal} onError={setNotice} />}
    {sortingOpen && <Sorting onClosed={() => setSortingOpen(false)} onUpdated={() => setRefresh(n => n + 1)} onPortal={setDialogPortal} />}
    {feedbackError && <div className="feedback-error" role="alert">{t(feedbackError)}</div>}
    {sessionInfo?.demo && <Agentation appName={t("Kakuoku — дизайн-демо")} portalContainer={portal || document.body} onAnnotationAdd={a => saveFeedback(a)} onAnnotationUpdate={a => saveFeedback(a)} onAnnotationDelete={a => saveFeedback(a,'delete')} onAnnotationsClear={a => saveFeedback(a,'clear')} onSubmit={async (_output, annotations) => { annotations.forEach(a => feedback.current.set(a.id,a)); await feedbackQueue.current; await api('/feedback', { method: 'POST', body: JSON.stringify([...feedback.current.values()]) }); setNotice(t("Комментарии к дизайну сохранены.")); }} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
