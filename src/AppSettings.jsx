import { t, getLocale, useLanguage, setLanguage } from './i18n.mjs';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { aiModels } from '../shared/ai-models.mjs';
import StorageSettings from './StorageSettings.jsx';
import './vendor/sl-url-input/buttons.js';
import './vendor/sl-url-input/buttons.css';
import './vendor/sl-password-input/buttons.css';
import './vendor/sl-save/buttons.js';
import './vendor/sl-save/buttons.css';

const sections = [{ id: 'connection', label: 'Подключение AI', icon: 'link' }, { id: 'agent', label: 'Агент', icon: 'chat' }, { id: 'tools', label: 'Инструменты', icon: 'tools' }, { id: 'tags', label: 'Теги', icon: 'tag' }, { id: 'storage', label: 'Хранилище', icon: 'storage' }];
const toolProviders = [{ id: 'tavily', title: 'Tavily', url: 'https://app.tavily.com/' }, { id: 'brave', title: 'Brave Search', url: 'https://api-dashboard.search.brave.com/' }, { id: 'supadata', title: 'Supadata', url: 'https://dash.supadata.ai/' }];
const modes = [{ id: 'chat', title: 'Чат', detail: 'Обсуждать мысли без поиска в интернете' }, { id: 'research', title: 'Исследование', detail: 'Проверять ссылки и находить новое' }, { id: 'notes', title: 'Только запись', detail: 'Сохранять мысли без обращений к AI' }];
const prompts = [{ id: 'chat', title: 'Диалог' }, { id: 'preview', title: 'Превью' }, { id: 'sorting', title: 'Сортировка' }];

function ConnectionField({ kind, value, onChange, disabled, placeholder, id = kind === 'password' ? 'ai-key' : 'ai-endpoint', describedBy }) {
  const language = useLanguage(), controller = useRef(null);
  const root = useRef(null);
  const password = kind === 'password';
  useEffect(() => {
    if (password) return;
    controller.current = window.MatteUrlInput.mount(root.current, { translate: t });
    return () => { controller.current.destroy(); controller.current = null; };
  }, [password]);
  useLayoutEffect(() => { controller.current?.refreshLocale(); }, [language]);
  return <div ref={root} className={`sl-field settings-field sl-field--${kind}`} data-validation="neutral" data-visible="false">
    <div className="sl-field__control">
      {!password && <svg className="sl-field__leading sl-field__globe" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.25" /><path className="sl-field__globe-axis" d="M3.9 12h16.2M12 3.75c2.35 2.2 3.55 4.95 3.55 8.25S14.35 18.05 12 20.25M12 3.75C9.65 5.95 8.45 8.7 8.45 12S9.65 18.05 12 20.25" /></svg>}
      <input id={id} className="sl-field__input" type={kind} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder={placeholder} autoComplete={password ? 'new-password' : 'off'} spellCheck="false" required={!password} maxLength={password ? 4096 : 2048} aria-describedby={describedBy || (!password ? `${id}-help` : undefined)} />
      {!password && <svg className="sl-field__validation" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g className="sl-field__invalid-icon"><path pathLength="1" d="m8.25 8.25 7.5 7.5" /><path pathLength="1" d="m15.75 8.25-7.5 7.5" /></g><path className="sl-field__valid-icon" pathLength="1" d="m5.5 12 4 4 9-9" /></svg>}
    </div>
    {!password && <p className="sl-field__helper" id={`${id}-help`} role="status" aria-live="polite">{t("Публичный HTTPS-адрес API, например https://api.ghostmetal.io/v1.")}</p>}
  </div>;
}

function SettingsTextarea({ id, label, value, onChange, disabled, maxLength = 12000, describedBy }) {
  const language = useLanguage();
  const root = useRef(null), controller = useRef(null);
  useEffect(() => {
    controller.current = window.MatteTextareaInput.mount(root.current, { translate: t });
    return () => controller.current.destroy();
  }, []);
  useEffect(() => { controller.current?.refresh(); }, [value, language]);
  return <div ref={root} className="sl-field sl-field--textarea settings-field settings-prompt">
    <div className="sl-field__control"><textarea id={id} className="sl-field__input" aria-label={label} aria-describedby={describedBy} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} spellCheck="false" /></div>
    <div className="settings-prompt-count"><span className="sl-field__helper" role="status" aria-live="polite" /><span><span data-count /> / {maxLength.toLocaleString(getLocale())}</span></div>
  </div>;
}

function SaveButton({ onSave, disabled }) {
  const language = useLanguage(), controller = useRef(null);
  const root = useRef(null), latest = useRef(onSave);
  latest.current = onSave;
  useEffect(() => {
    controller.current = window.MatteButtons.mount(root.current, { translate: t, onSave: context => latest.current(context) });
    return () => { controller.current.destroy(); controller.current = null; };
  }, []);
  useLayoutEffect(() => { controller.current?.refreshLocale(); }, [language]);
  useEffect(() => { root.current.querySelector('button').disabled = disabled; }, [disabled]);
  return <div ref={root} className="button-kit settings-save">
    <button className="bk-button bk-button--save" data-action="save" type="button" data-state="idle" disabled={disabled}>
      <span className="bk-surface" aria-hidden="true"><span className="bk-progress" /><span className="bk-label bk-label-idle">{t("Сохранить")}</span><span className="bk-label bk-label-saving">{t("Сохраняю")}<span className="bk-ellipsis">…</span></span><span className="bk-label bk-label-saved"><svg className="bk-check" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 12.5 9.2 17.5 20 6.5" pathLength="1" /></svg><span className="bk-saved-text">{t("Сохранено")}</span></span></span>
      <span className="bk-sr-only">{t("Сохранить настройки")}</span>
    </button><span className="bk-sr-only" data-feedback role="status" aria-live="polite" aria-atomic="true" />
  </div>;
}

function moveChoice(event, items, index, select) {
  const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
  if (!direction && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + direction + items.length) % items.length;
  select(items[next].id);
  event.currentTarget.parentElement.children[next].focus();
}

export default function AppSettings({ request, Icon, onUpdated, onClosed, onPortal, onError }) {
  const language = useLanguage();
  const dialog = useRef(null), closing = useRef(false), closeTimer = useRef(null);
  const [section, setSection] = useState('connection');
  const [prompt, setPrompt] = useState('chat');
  const [saved, setSaved] = useState(null), [draft, setDraft] = useState(null), [defaults, setDefaults] = useState(null);
  const [apiKey, setApiKey] = useState(''), [clearApiKey, setClearApiKey] = useState(false);
  const [toolKeys, setToolKeys] = useState({}), [clearToolKeys, setClearToolKeys] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [reload, setReload] = useState(0), [demo, setDemo] = useState(false);
  const dirty = Boolean(draft && (JSON.stringify(draft) !== JSON.stringify(saved) || apiKey || clearApiKey || Object.values(toolKeys).some(Boolean) || clearToolKeys.length));
  useEffect(() => {
    const element = dialog.current;
    element.showModal(); onPortal(element);
    return () => { clearTimeout(closeTimer.current); element.close(); onPortal(null); };
  }, [onPortal]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    request('/settings', { signal: controller.signal }).then(result => {
      setSaved(result.settings); setDraft(result.settings); setDefaults(result.defaults); setDemo(result.session.demo);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, reload]);
  function close() {
    if (closing.current) return;
    closing.current = true; dialog.current.classList.add('leaving');
    closeTimer.current = setTimeout(onClosed, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }
  function change(fields) { setDraft(current => ({ ...current, ...fields })); setError(''); }
  async function save() {
    if (!dirty || busy) return;
    setBusy(true); setError('');
    try {
      // Closing the panel must not cancel a save already sent to the server.
      const result = await request('/settings', { method: 'PATCH', body: JSON.stringify({ endpoint: draft.endpoint, model: draft.model, visionModel: draft.visionModel, mode: draft.mode, prompts: draft.prompts, researchMaxCalls: draft.researchMaxCalls, tags: draft.tags, ...(apiKey ? { apiKey } : {}), clearApiKey,
        tools: { searchProvider: draft.tools.searchProvider, youtubeProvider: draft.tools.youtubeProvider, keys: Object.fromEntries(Object.entries(toolKeys).filter(([, value]) => value)), clearKeys: clearToolKeys } }) });
      setSaved(result.settings); setDraft(result.settings); setApiKey(''); setClearApiKey(false); setToolKeys({}); setClearToolKeys([]); onUpdated(result.session);
    } catch (error) {
      if (closing.current) onError(t("Не удалось сохранить настройки. {0}", [error.message]));
      else setError(error.message);
      throw error;
    }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="settings-dialog app-settings-dialog" aria-labelledby="app-settings-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <div className="settings-brand"><Icon name="settings" size={25} /><span>{t("Настройки")}</span></div>
        <nav className="settings-nav" aria-label={t("Разделы настроек")} style={{ '--section-index': sections.findIndex(item => item.id === section) }}>
          <span className="settings-nav-marker" aria-hidden="true" />
          {sections.map(item => <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}><span className="settings-nav-icon"><Icon name={item.icon} size={21} /></span><span>{t(item.label)}</span></button>)}
        </nav>
      </aside>
      <div className="settings-main">
        <header className="settings-main-heading"><h2 id="app-settings-title">{t(sections.find(item => item.id === section).label)}</h2><button className="icon-button" type="button" aria-label={t("Закрыть настройки")} onClick={close}><Icon name="close" /></button></header>
        <div className="settings-content">
          <div className="settings-row"><label htmlFor="interface-language">{t('Язык интерфейса')}</label><div><select id="interface-language" className="settings-select" value={language} onChange={event => setLanguage(event.target.value)}><option value="ru" lang="ru">Русский</option><option value="en" lang="en">English</option></select></div></div>
          {loading ? <div className="settings-loading" role="status">{t("Загружаю настройки…")}</div> : !draft ? <div className="settings-load-error"><p className="settings-error" role="alert">{t(error)}</p><button className="text-button" onClick={() => setReload(value => value + 1)}>{t("Попробовать снова")}</button></div> : <>
            <section className="settings-section" hidden={section !== 'connection'} aria-label={t("Подключение AI")}>
              <div className="settings-row"><label htmlFor="ai-endpoint">{t("Эндпоинт")}</label><div><ConnectionField kind="url" value={draft.endpoint} onChange={endpoint => change({ endpoint })} disabled={busy} placeholder="https://api.ghostmetal.io/v1" /></div></div>
              <div className="settings-row"><label htmlFor="ai-key">{t("Ключ этого API")}</label><div><ConnectionField kind="password" value={apiKey} onChange={value => { setApiKey(value); setClearApiKey(false); setError(''); }} disabled={busy || clearApiKey} placeholder={clearApiKey ? t("Ключ будет удалён") : saved.hasApiKey ? t("Введите новый ключ для замены") : t("Вставьте ключ провайдера API")} />{saved.hasApiKey && <button className="text-button settings-remove-key" type="button" disabled={busy} onClick={() => { setClearApiKey(value => !value); setApiKey(''); }}>{clearApiKey ? t("Отменить удаление") : t("Удалить ключ")}</button>}</div></div>
              <div className="settings-row"><label htmlFor="chat-model">{t("Модель чата")}</label><div>
                <select id="chat-model" className="settings-select" value={draft.model} disabled={busy} onChange={event => change({ model: event.target.value })}>{!aiModels.some(item => item.id === draft.model) && <option value={draft.model}>{draft.model}</option>}{aiModels.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select>
                <p className="settings-help">{t("Используется для текстового диалога, превью и сортировки. Сохранение не вызывает модель.")}</p>
              </div></div>
              <div className="settings-row"><label htmlFor="vision-model">{t("Анализ изображений")}</label><div>
                <select id="vision-model" className="settings-select" value={draft.visionModel} disabled={busy} onChange={event => change({ visionModel: event.target.value })}><option value="same">{t("Та же модель, что в чате")}</option>{aiModels.filter(item => item.vision).map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}<option value="off">{t("Выключен")}</option></select>
                <p className="settings-help">{t("Для ответа с изображениями используется эта модель и тот же API-ключ. До четырёх последних PNG/JPEG/WebP/GIF текущей заметки; у GIF только первый кадр. Подготовленные копии отправляются провайдеру, оригиналы сохраняются. Видео и аудио здесь не анализируются.")}</p>
              </div></div>
            </section>
            <section className="settings-section" hidden={section !== 'agent'} aria-label={t("Агент")}>
              <div className="settings-mode-section"><h3 id="agent-mode-label">{t("Режим")}</h3><div className="settings-modes" role="radiogroup" aria-labelledby="agent-mode-label">{modes.map((item, index) => <button key={item.id} type="button" role="radio" aria-checked={draft.mode === item.id} tabIndex={draft.mode === item.id ? 0 : -1} disabled={busy} onClick={() => change({ mode: item.id })} onKeyDown={event => moveChoice(event, modes, index, mode => change({ mode }))}><span className="settings-radio-dot" aria-hidden="true" /><strong>{t(item.title)}</strong><span>{t(item.detail)}</span></button>)}</div></div>
              <div className="settings-prompts-heading"><h3>{t("Промпты")}</h3><button className="text-button" type="button" disabled={busy || draft.prompts[prompt] === defaults.prompts[prompt]} onClick={() => change({ prompts: { ...draft.prompts, [prompt]: defaults.prompts[prompt] } })}>{t("По умолчанию")}</button></div>
              <div className="settings-prompt-tabs" role="tablist" aria-label={t("Промпты агента")}>{prompts.map((item, index) => <button key={item.id} id={`prompt-tab-${item.id}`} type="button" role="tab" aria-selected={prompt === item.id} aria-controls="settings-prompt-panel" tabIndex={prompt === item.id ? 0 : -1} onClick={() => setPrompt(item.id)} onKeyDown={event => moveChoice(event, prompts, index, setPrompt)}>{t(item.title)}</button>)}</div>
              <div key={prompt} id="settings-prompt-panel" className="settings-prompt-panel" role="tabpanel" aria-labelledby={`prompt-tab-${prompt}`}><SettingsTextarea id={`prompt-${prompt}`} label={t("Промпт: {0}", [t(prompts.find(item => item.id === prompt).title)])} value={draft.prompts[prompt]} onChange={value => change({ prompts: { ...draft.prompts, [prompt]: value } })} disabled={busy} /></div>
              <p className="settings-help">{draft.mode === 'notes' ? t("В этом режиме AI отключён. Промпты применятся после смены режима.") : t("Диалог — ответы в чате. Превью — выжимка при закрытии. Сортировка — объединение общих тем.")}</p>
            </section>
            <section className="settings-section" hidden={section !== 'tags'} aria-label={t("Теги")}>
              <label className="settings-tags-label" htmlFor="tag-catalog">{t("Набор тегов")}</label>
              <p id="tag-catalog-help" className="settings-help settings-tags-intro">{t("Один тег на строку, до 64 тегов. Буквы, цифры, дефис или подчёркивание — до 24 символов. После обновления превью AI заново выбирает 3–5 тегов из этого набора. Если тегов меньше трёх — использует доступные.")}</p>
              <SettingsTextarea id="tag-catalog" label={t("Набор тегов")} describedBy="tag-catalog-help tag-catalog-policy" maxLength={4096} value={draft.tags.join('\n')} onChange={value => change({ tags: value.split('\n') })} disabled={busy} />
              <p id="tag-catalog-policy" className="settings-help">{t("Удалённые из набора теги исчезнут с карточек после сохранения. Новые назначатся при следующем обновлении превью. ")}{demo ? t("В демке AI отключён; теги примеров заданы заранее.") : draft.mode === 'notes' ? t("В режиме «Только запись» автоматический выбор отключён.") : t("Выбор тегов входит в запрос превью.")}</p>
            </section>
            <section className="settings-section" hidden={section !== 'tools'} aria-label={t("Инструменты")}>
              <div className="settings-row"><label htmlFor="research-max-calls">{t("Лимит исследования")}</label><div>
                <select id="research-max-calls" className="settings-select" value={draft.researchMaxCalls} disabled={busy} onChange={event => change({ researchMaxCalls: Number(event.target.value) })}>{Array.from({ length: 9 }, (_, index) => index + 4).map(value => <option key={value} value={value}>{t("До ")}{value}{t(" обращений")}</option>)}</select>
                <p className="settings-help">{t("Последнее обращение — для итога. Больший лимит позволяет проверить больше источников и может увеличить расход API. Исследование заканчивается раньше, если ответ готов.")}</p>
              </div></div>
              <div className="settings-row"><label htmlFor="search-provider">{t("Поиск")}</label><div>
                <select id="search-provider" className="settings-select" value={draft.tools.searchProvider} disabled={busy} onChange={event => change({ tools: { ...draft.tools, searchProvider: event.target.value } })}><option value="builtin">{t("Встроенный · без ключа")}</option><option value="tavily">Tavily API</option><option value="brave">Brave Search API</option><option value="off">{t("Выключен")}</option></select>
                <p className="settings-help">{draft.tools.searchProvider === 'builtin' ? t("DuckDuckGo и резервный поиск Bing. Доступность зависит от ограничений сайтов.") : draft.tools.searchProvider === 'off' ? t("Агент сможет читать присланные веб-страницы, но не выполнять поиск.") : t("Запросы расходуют лимит выбранного сервиса. Автоматического перехода на другой провайдер нет.")}</p>
              </div></div>
              <div className="settings-row"><label htmlFor="youtube-provider">{t("YouTube и Shorts")}</label><div>
                <select id="youtube-provider" className="settings-select" value={draft.tools.youtubeProvider} disabled={busy} onChange={event => change({ tools: { ...draft.tools, youtubeProvider: event.target.value } })}><option value="local">{t("Локальные субтитры · без ключа")}</option><option value="supadata">Supadata API</option><option value="off">{t("Выключен")}</option></select>
                <p className="settings-help">{draft.tools.youtubeProvider === 'off' ? t("Получение субтитров отключено.") : draft.tools.youtubeProvider === 'local' ? t("Готовые и автоматические субтитры через youtube-transcript-api. YouTube может ограничить доступ с вашего IP.") : t("Внешний сервис получает ссылку ролика и расходует свой лимит. Запрашиваются существующие субтитры, без платной генерации речи.")}</p>
                <p className="settings-help">{t("Агент изучает речь из субтитров ролика, ссылку на который вы прислали в текущую заметку. Кадры и звук он не видит. Если субтитров нет, анализ недоступен.")}</p>
              </div></div>
              {toolProviders.filter(provider => [draft.tools.searchProvider, draft.tools.youtubeProvider].includes(provider.id)).map(provider => <div className="settings-row" key={provider.id}><label htmlFor={`tool-key-${provider.id}`}>{t("Ключ ")}{provider.title}</label><div>
                <ConnectionField id={`tool-key-${provider.id}`} describedBy={`tool-key-${provider.id}-help`} kind="password" value={toolKeys[provider.id] || ''} disabled={busy || clearToolKeys.includes(provider.id)} placeholder={clearToolKeys.includes(provider.id) ? t("Ключ будет удалён") : saved.tools.hasKeys[provider.id] ? t("Введите новый ключ для замены") : t("Вставьте API-ключ")} onChange={value => { setToolKeys(current => ({ ...current, [provider.id]: value })); setClearToolKeys(current => current.filter(id => id !== provider.id)); setError(''); }} />
                <p id={`tool-key-${provider.id}-help`} className="settings-help">{clearToolKeys.includes(provider.id) ? t("Ключ удалится после сохранения.") : saved.tools.hasKeys[provider.id] ? t("Ключ сохранён на сервере. Пустое поле оставит его без изменений.") : t("Ключ не задан.")} <a href={provider.url} target="_blank" rel="noreferrer noopener">{t("Кабинет ")}{provider.title}</a></p>
                {saved.tools.hasKeys[provider.id] && <button type="button" className="text-button settings-remove-key" disabled={busy} onClick={() => { setClearToolKeys(current => current.includes(provider.id) ? current.filter(id => id !== provider.id) : [...current, provider.id]); setToolKeys(current => ({ ...current, [provider.id]: '' })); }}>{clearToolKeys.includes(provider.id) ? t("Отменить удаление") : t("Удалить ключ")}</button>}
              </div></div>)}
            </section>
            <section className="settings-section" hidden={section !== 'storage'} aria-label={t("Хранилище")}><StorageSettings Icon={Icon} active={section === 'storage'} demo={demo} onRelocated={async () => onUpdated(await request('/session'))} /></section>
          </>}
        </div>
        <footer className="settings-footer">
          <div className="settings-footer-status" aria-live="polite">{error && draft ? <p className="settings-error" role="alert">{t(error)}</p> : <span>{dirty ? t("Есть несохранённые изменения") : ''}</span>}</div>
          <div className="settings-footer-actions" hidden={section === 'storage'}>{draft && <SaveButton onSave={save} disabled={busy || !dirty} />}</div>
        </footer>
      </div>
    </div>
  </dialog>;
}
