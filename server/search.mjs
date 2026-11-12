import { load } from 'cheerio';
import { searchWeb, serviceRequest, validatePublicUrl } from './web.mjs';

export async function search(query, config, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new Error('Нужен поисковый запрос до 300 символов.');
  const provider = config.tools.searchProvider;
  if (config.mode !== 'research' || provider === 'off') throw new Error('Поиск отключён в настройках.');
  if (provider === 'builtin') return searchWeb(query, signal);
  if (!['tavily', 'brave'].includes(provider)) throw new Error('Поисковый провайдер недоступен.');
  const key = config.tools.keys[provider];
  if (!key) throw new Error('Добавьте ключ выбранного поиска в настройках инструментов.');
  const response = provider === 'tavily'
    ? await serviceRequest('https://api.tavily.com/search', { method: 'POST', headers: { authorization: `Bearer ${key}` }, payload: { query, search_depth: 'basic', max_results: 6, include_answer: false, include_raw_content: false, auto_parameters: false } }, signal)
    : await serviceRequest(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`, { headers: { 'x-subscription-token': key } }, signal);
  let value;
  try { value = JSON.parse(response.text); } catch { throw new Error('Поисковый API вернул некорректный JSON.'); }
  const rows = provider === 'tavily' ? value?.results : value?.web?.results;
  if (!Array.isArray(rows)) throw new Error('Поисковый API не вернул список результатов.');
  const results = [];
  for (const row of rows.slice(0, 6)) {
    try { results.push({ url: validatePublicUrl(row.url).href, title: load(String(row.title || '')).text().slice(0, 200), snippet: load(String(provider === 'tavily' ? row.content || '' : row.description || '')).text().slice(0, 1000) }); }
    catch { /* Discard malformed or non-public links, never expose provider payloads. */ }
  }
  return { results, provider, untrusted: true };
}
