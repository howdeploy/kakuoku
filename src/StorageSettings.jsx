import { t } from './i18n.mjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function StorageSettings({ Icon, active, demo, onRelocated }) {
  const [destination, setDestination] = useState('');
  const [preview, setPreview] = useState(null);
  const [storage, setStorage] = useState(null), [job, setJob] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const token = useRef(''), completed = useRef(null), relocated = useRef(onRelocated);
  relocated.current = onRelocated;
  const working = ['running', 'committed', 'recovering'].includes(job?.state);
  const blocked = working || job?.state === 'interrupted';

  const helper = useCallback(async (path, data, signal) => {
    let response;
    try {
      response = await fetch(`http://127.0.0.1:3102${path}`, {
        method: data === undefined ? 'GET' : 'POST',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        ...(data === undefined ? {} : { headers: { 'content-type': 'application/json', 'x-kakuoku-control-token': token.current }, body: JSON.stringify(data) }),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(t("Помощник переноса недоступен. На Linux запустите npm run host из папки приложения и обновите подключение. На Windows и macOS перенос через этот помощник пока не поддерживается."));
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || t("Помощник не смог выполнить операцию."));
    return result;
  }, []);
  const refresh = useCallback(async signal => {
    const result = await helper('/storage', undefined, signal);
    token.current = result.token;
    setStorage(result.storage); setJob(result.job); setError('');
    if (result.job?.state === 'complete' && completed.current !== result.job.id) {
      completed.current = result.job.id;
      await relocated.current();
    }
    return result;
  }, [helper]);

  useEffect(() => {
    if (!active || demo) return;
    const controller = new AbortController();
    setLoading(true);
    refresh(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, demo, refresh]);
  useEffect(() => {
    if (!active || demo || !working) return;
    const controller = new AbortController(); let timer;
    async function poll() {
      try { await refresh(controller.signal); }
      catch (error) { if (!controller.signal.aborted) setError(error.message); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
    }
    timer = setTimeout(poll, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, demo, working, refresh]);
  async function prepare(event) {
    event.preventDefault(); setBusy(true); setError(''); setPreview(null);
    try { await refresh(); setPreview((await helper('/storage/plan', { destination: destination.trim() })).plan); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function execute(path, data) {
    setBusy(true); setError('');
    try { const result = await helper(path, data); setJob(result.job); setPreview(null); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function reconnect() {
    setLoading(true);
    try { await refresh(); } catch (error) { setError(error.message); }
    finally { setLoading(false); }
  }

  return <>
    <div className="storage-overview">
      <span className="storage-mark" aria-hidden="true"><Icon name="storage" size={28} /></span>
      <div><h3>{t("Все данные в одном месте")}</h3><p>{t("Заметки, переписка, вложения и настройки переносятся вместе.")}</p></div>
    </div>
    <dl className="storage-details">
      <div><dt>{t("Хранилище приложения")}</dt><dd>{demo ? t("Отдельная база дизайн-демо") : storage ? storage.kind === 'bind' ? t("Выбранная папка на компьютере") : t("Отдельный Docker volume") : loading ? t("Загружаю…") : t("Помощник не подключён")}</dd></div>
      {storage?.name && <div><dt>Volume</dt><dd><code>{storage.name}</code></dd></div>}
      {storage?.hostPath && <div><dt>{t("Папка на компьютере")}</dt><dd><code>{storage.hostPath}</code></dd></div>}
      {storage && <div><dt>{t("Папка в контейнере")}</dt><dd><code>{storage.containerPath}</code></dd></div>}
    </dl>
    {demo && <p className="settings-help">{t("Дизайн-демо хранит данные отдельно. Перенос выполняется в приложении на порту 3101.")}</p>}
    {!demo && <button className="text-button" type="button" disabled={loading || busy} onClick={reconnect}>{t("Обновить подключение")}</button>}
    {error && <p className="settings-error" role="alert">{t(error)}</p>}
    {job && <div className="storage-plan" role="status" aria-live="polite">
      <h3>{working ? t("Перенос хранилища") : job.state === 'complete' ? t("Готово") : t("Состояние переноса")}</h3>
      <p>{t(job.message)}</p>
      {job.destination && <p>{t("Новая папка: ")}<code>{job.destination}</code></p>}
      {job.backup && <p>{t("Резервная копия: ")}<code>{job.backup}</code></p>}
      {job.state === 'interrupted' && <button type="button" className="text-button" disabled={busy} onClick={() => execute('/storage/recover', {})}>{t("Продолжить восстановление")}</button>}
    </div>}

    <form className="storage-relocation" onSubmit={prepare}>
      <h3>{t("Перенести на другой диск")}</h3>
      <p className="settings-help">{t("Автоматический перенос через локальный помощник пока доступен только на Linux. Веб-приложение использует хранилище, подключённое при запуске Docker.")}</p>
      <div className="settings-row"><label htmlFor="storage-destination">{t("Новая папка")}</label><div>
        <input id="storage-destination" className="settings-select" type="text" value={destination} onChange={event => { setDestination(event.target.value); setPreview(null); }} placeholder={t("Полный путь к папке данных")} disabled={demo || busy || blocked} required pattern="/.+" maxLength={2048} autoComplete="off" spellCheck="false" aria-describedby="storage-destination-help" title={t("Укажите полный путь к папке на Linux, начиная с /")} />
        <p id="storage-destination-help" className="settings-help">{t("Полный путь к новой или пустой папке на нужном диске. Родительская папка должна существовать. В неё будут перенесены база, вложения и настройки.")}</p>
      </div></div>
      <button className="text-button storage-preview-button" type="submit" disabled={demo || busy || blocked || loading || !storage}>{busy ? t("Подготавливаю…") : t("Предпросмотр переноса")}<Icon name="arrow" size={17} /></button>
    </form>

    {preview && <div className="storage-plan" role="status" aria-live="polite">
      <h3>{t("План переноса")}</h3>
      <p>{t("Новое расположение: ")}<code>{preview.destination}</code></p>
      <ol><li>{t("Остановить приложение, чтобы база и вложения копировались вместе.")}</li><li>{t("Скопировать всё хранилище в новую папку.")}</li><li>{t("Подключить новое хранилище и запустить приложение.")}</li><li>{t("Сохранить прежнее хранилище до проверки данных на новом месте.")}</li></ol>
      <p className="settings-help">{t("Во время переноса приложение будет временно недоступно. Прежнее хранилище и полная резервная копия сохранятся. Закрытие настроек не отменит перенос.")}</p>
      <button className="text-button" type="button" disabled={busy || blocked} onClick={() => execute('/storage/move', { id: preview.id })}>{t("Перенести данные")}<Icon name="arrow" size={17} /></button>
    </div>}
  </>;
}
