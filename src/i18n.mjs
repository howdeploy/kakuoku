import { useSyncExternalStore } from 'react';
import english from './locales/en.json';

const storageKey = 'kakuoku.language';
const listeners = new Set();
let language = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
try {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'ru' || saved === 'en') language = saved;
} catch { /* The preference still works when browser storage is unavailable. */ }
const russian = Object.fromEntries(Object.entries(english).map(([source, target]) => [target, source]));
const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join(',');
for (const [source, target] of Object.entries(english)) {
  console.assert(placeholders(source) === placeholders(target), `Translation placeholders differ: ${source}`);
}
const templates = Object.entries(english).filter(([source]) => /\{\d+\}/.test(source)).flatMap(([source, target]) =>
  [[source, source, target], [target, source, target]].map(([pattern, ru, en]) => ({
    pattern: new RegExp(`^${pattern.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part) ? '([\\s\\S]*?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`), ru, en,
    slots: [...pattern.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1])),
  }))).sort((a, b) => b.ru.replace(/\{\d+\}/g, '').length - a.ru.replace(/\{\d+\}/g, '').length);

// Only service-error slots are translated recursively; note titles and file names stay intact.
const serviceSlots = {
  'Не удалось сохранить настройки. {0}': [0],
  '{0} Черновик возвращён в поле ввода; повторная отправка использует тот же ID.': [0],
  'Комментарий пока только в браузере: {0}': [0],
  '{0}: {1} Запрос на сервере мог продолжиться.': [1],
  '{0}: не удалось завершить закрытие. {1}': [1],
  '{0} Прежнее превью оставлено; переписка сохранена.': [0],
  'Создано общих заметок: {0}. Исходные чаты сохранены.{1}': [1],
  '{0} Уже создано общих заметок: {1}.': [0],
  '{0}: {1}': [1],
  '{0}: {1}. Проверьте подключение и повторите запрос.': [1],
  'Не удалось подключиться к AI: {0}': [0],
  'Поиск временно недоступен. DuckDuckGo: {0} Bing: {1}': [0, 1],
  'Перенос остановлен. Копии сохранены; нажмите «Продолжить восстановление». {0}': [0],
  'Вызовы не выполнены: {0}': [0],
  'Не удалось выполнить действие: {0}': [0],
  'Субтитры получены: {0}': [0],
  'Субтитры получены: {0}, передана ограниченная часть': [0],
};

// Translate UI and service strings only, never note bodies or other user content.
export function t(text, values) {
  if (typeof text !== 'string' || !text) return text;
  const key = text.trim();
  if (!key) return text;
  let source = Object.hasOwn(russian, key) ? russian[key] : key;
  let result = language === 'en' && Object.hasOwn(english, source) ? english[source] : source;
  if (!values && result === key && !Object.hasOwn(english, source)) {
    const template = templates.find(item => item.pattern.test(key));
    if (template) {
      const captures = template.pattern.exec(key).slice(1);
      values = [];
      template.slots.forEach((slot, index) => { values[slot] = captures[index]; });
      source = template.ru;
      result = language === 'en' ? template.en : template.ru;
    }
  }
  if (values) result = result.replace(/\{(\d+)\}/g, (match, index) => {
    const value = values[index];
    return serviceSlots[source]?.includes(Number(index)) ? t(value) : value ?? match;
  });
  return text.slice(0, text.length - text.trimStart().length) + result + text.slice(text.trimEnd().length);
}

export const getLanguage = () => language;
export const getLocale = () => language === 'ru' ? 'ru-RU' : 'en-US';
export function subscribeLanguage(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function setLanguage(next) {
  if (!['ru', 'en'].includes(next) || next === language) return;
  language = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the in-memory preference. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach(listener => listener());
}
export function useLanguage() { return useSyncExternalStore(subscribeLanguage, getLanguage); }
if (typeof document !== 'undefined') document.documentElement.lang = language;
