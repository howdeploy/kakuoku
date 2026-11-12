import { t } from './i18n.mjs';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function Media({ item, expanded = false, onError }) {
  const [posterFailed, setPosterFailed] = useState(false);
  const src = item.url || `/api/attachments/${encodeURIComponent(item.id)}`;
  if (item.mime.startsWith('video/') && !expanded && item.previewUrl && !posterFailed) return <img src={item.previewUrl} alt={item.name} loading="lazy" draggable="false" onError={() => setPosterFailed(true)} />;
  if (item.mime.startsWith('video/')) return <video src={src} controls={expanded} preload="metadata" muted={!expanded} playsInline onError={onError} aria-label={item.name} />;
  if (item.mime.startsWith('audio/')) return expanded ? <audio src={src} controls preload="metadata" onError={onError} aria-label={item.name} /> : <svg className="gallery-audio-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="18" y="7" width="12" height="23" rx="6" /><path d="M12 23v2a12 12 0 0 0 24 0v-2M24 37v5m-6 0h12" /></svg>;
  return <img src={src} alt={item.name} loading={expanded ? 'eager' : 'lazy'} draggable="false" onError={onError} />;
}

function MediaCard({ item, Icon, onSelect, onOpen }) {
  const [failed, setFailed] = useState(false);
  const audio = item.mime.startsWith('audio/'), video = item.mime.startsWith('video/');
  return <article className={`gallery-card tone-${item.color}`}>
    <button className={`gallery-preview ${audio ? 'is-audio' : ''} ${failed ? 'is-unavailable' : ''}`} type="button" onClick={() => onSelect(item)} aria-label={t("Открыть {0}", [item.name])}>
      {failed ? <span className="gallery-unavailable"><Icon name="image" size={32} /><span>{t("Файл недоступен")}</span></span> : <Media item={item} onError={() => setFailed(true)} />}
      {audio && !failed && <span className="gallery-audio-name">{item.name}</span>}
      {video && !failed && <span className="gallery-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5.5v13l10-6.5Z" /></svg></span>}
      {item.mime === 'image/gif' && <span className="gallery-format">GIF</span>}
    </button>
    <button className="gallery-source" type="button" onClick={() => onOpen(item.noteId)} aria-label={t("Открыть заметку «{0}»", [item.title])}><Icon name="chat" size={17} /><span>{item.title}</span></button>
  </article>;
}

function GalleryGrid({ items, Icon, onSelect, onOpen }) {
  const root = useRef(null);
  useLayoutEffect(() => {
    const grid = root.current, cells = [...grid.children];
    function layout() {
      const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--gallery-gap'));
      for (const cell of cells) cell.style.gridRowEnd = `span ${Math.max(1, Math.ceil(cell.firstElementChild.offsetHeight + gap))}`;
    }
    layout();
    const observer = new ResizeObserver(layout);
    cells.forEach(cell => observer.observe(cell.firstElementChild));
    return () => observer.disconnect();
  }, [items]);
  return <div ref={root} className="gallery-grid">{items.map(item => <div className="gallery-cell" key={item.id}><MediaCard item={item} Icon={Icon} onSelect={onSelect} onOpen={onOpen} /></div>)}</div>;
}

function MediaViewer({ item, Icon, onClosed, onOpen, onPortal }) {
  const dialog = useRef(null), closeTimer = useRef(null), closing = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element.showModal(); onPortal(element);
    return () => { clearTimeout(closeTimer.current); element.close(); onPortal(null); };
  }, [onPortal]);
  function close(openNote = false) {
    if (closing.current) return;
    closing.current = true;
    dialog.current.querySelectorAll('audio,video').forEach(media => media.pause());
    dialog.current.classList.add('leaving');
    closeTimer.current = setTimeout(() => { onClosed(); if (openNote) onOpen(item.noteId); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }
  return <dialog ref={dialog} className={`settings-dialog gallery-dialog tone-${item.color}`} aria-labelledby="gallery-file-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <header className="gallery-viewer-heading"><h2 id="gallery-file-title">{item.name}</h2><button className="icon-button" type="button" aria-label={t("Закрыть просмотр")} onClick={() => close()}><Icon name="close" size={23} /></button></header>
    <div className={`gallery-viewer-media ${item.mime.startsWith('audio/') ? 'is-audio' : ''}`}>{failed ? <p role="alert">{t("Не удалось открыть файл.")}</p> : <Media item={item} expanded onError={() => setFailed(true)} />}</div>
    <footer><button className="gallery-source" type="button" onClick={() => close(true)}><Icon name="chat" size={19} /><span>{item.title}</span></button></footer>
  </dialog>;
}

export default function Gallery({ request, enabled, ready, refresh, query, Icon, onOpen, onPortal }) {
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [reload, setReload] = useState(0), [selected, setSelected] = useState(null);
  const [cursor, setCursor] = useState(null), [loadingMore, setLoadingMore] = useState(false);
  const moreRequest = useRef(null);
  useEffect(() => {
    if (!enabled || !ready) return;
    const controller = new AbortController(), signal = controller.signal;
    setLoading(true); setLoadingMore(false); setError(''); setCursor(null);
    async function load() {
      const result = await request(`/media?q=${encodeURIComponent(query)}&limit=60`, { signal });
      if (signal.aborted) return;
      setItems(result.items); setCursor(result.nextCursor);
    }
    load().catch(error => { if (!signal.aborted) setError(error.message); }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => { controller.abort(); moreRequest.current?.abort(); };
  }, [request, enabled, ready, refresh, reload, query]);
  async function more() {
    if (!cursor || loading || loadingMore) return;
    const controller = new AbortController(); moreRequest.current = controller;
    setLoadingMore(true); setError('');
    try {
      const result = await request(`/media?q=${encodeURIComponent(query)}&limit=60&cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal });
      if (!controller.signal.aborted) { setItems(current => [...new Map([...current, ...result.items].map(item => [item.id, item])).values()]); setCursor(result.nextCursor); }
    } catch (error) { if (!controller.signal.aborted) setError(error.message); }
    finally { if (!controller.signal.aborted) setLoadingMore(false); }
  }
  return <>
    {error && <div className="collection-notice" role="alert">{t(error)}<button className="text-button" type="button" onClick={() => setReload(value => value + 1)}>{t("Повторить")}</button></div>}
    <div className={`gallery-feed ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
      {loading && !items.length ? <div className="loading-state" role="status">{t("Загружаю медиа…")}</div> : items.length ? <GalleryGrid items={items} Icon={Icon} onSelect={setSelected} onOpen={onOpen} /> : !error && <div className="collection-empty gallery-empty"><Icon name="image" size={56} /><h2>{query.trim() ? t("Такого мы не имем-с") : t("Здесь пока пусто")}</h2></div>}
      {cursor && <button type="button" className="text-button" onClick={more} disabled={loading || loadingMore}>{loadingMore ? t("Загружаю медиа…") : t("Ещё медиа")}</button>}
    </div>
    {selected && <MediaViewer key={selected.id} item={selected} Icon={Icon} onClosed={() => setSelected(null)} onOpen={onOpen} onPortal={onPortal} />}
  </>;
}
