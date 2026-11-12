import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';
import assert from 'node:assert/strict';

const stopping = new AbortController();
const jsonContentType = /^(?:application\/(?:[a-z0-9][a-z0-9!#$&^_.+-]*\+)?json|text\/json)$/i;
export function stopRequests() { stopping.abort(); }

export function isPublicAddress(address) {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
  return parsed.range() === 'unicast';
}

// Keep these boundary invariants executable without a separate test harness.
assert.equal(isPublicAddress('127.0.0.1'), false);
assert.equal(isPublicAddress('::ffff:192.168.1.1'), false);
assert.equal(isPublicAddress('169.254.169.254'), false);
assert.equal(isPublicAddress('::1'), false);
assert.equal(jsonContentType.test('application/json'), true);
assert.equal(jsonContentType.test('application/vnd.api+json'), true);
assert.equal(jsonContentType.test('application/javascript'), false);

export function validatePublicUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Разрешены только публичные HTTPS-ссылки без логина и нестандартного порта.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('Локальные адреса запрещены.');
  if (ipaddr.isValid(hostname) && !isPublicAddress(hostname)) throw new Error('Ссылка ведёт в непубличную сеть.');
  return url;
}

async function resolveHost(hostname, signal) {
  signal.throwIfAborted();
  stopping.signal.throwIfAborted();
  const resolver = new Resolver({ timeout: 1500, tries: 2 });
  const deadline = new AbortController();
  const combined = AbortSignal.any([signal, stopping.signal, deadline.signal]);
  const cancel = () => resolver.cancel();
  const timer = setTimeout(() => deadline.abort(), 5000);
  combined.addEventListener('abort', cancel, { once: true });
  try {
    const results = await Promise.all([4, 6].map(async family => {
      try { return (await resolver[`resolve${family}`](hostname)).map(address => ({ address, family })); }
      catch (error) {
        if (['ENODATA', 'ENOTFOUND'].includes(error.code)) return [];
        throw error;
      }
    }));
    combined.throwIfAborted();
    return results.flat();
  } catch (error) {
    signal.throwIfAborted();
    stopping.signal.throwIfAborted();
    const reason = deadline.signal.aborted || ['ETIMEOUT', 'ETIMEDOUT'].includes(error.code) ? 'DNS не ответил за отведённое время' : 'не удалось получить DNS-ответ';
    throw new Error(`${hostname}: ${reason}. Проверьте подключение и повторите запрос.`);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', cancel);
    resolver.cancel();
  }
}

async function publicDestination(raw, signal) {
  signal.throwIfAborted();
  stopping.signal.throwIfAborted();
  const url = validatePublicUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname) ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }] : await resolveHost(hostname, signal);
  signal.throwIfAborted();
  stopping.signal.throwIfAborted();
  if (!addresses.length) throw new Error(`${hostname}: DNS не вернул IP-адрес. Проверьте адрес сервиса.`);
  if (addresses.some(a => !isPublicAddress(a.address))) throw new Error('Ссылка ведёт в непубличную сеть.');
  // Pin the validated address for the TLS connection, keeping hostname verification.
  const selected = addresses[0];
  return { url, selected };
}

// Server-owned API transport: fixed callers choose endpoints/headers, never the model.
export async function serviceRequest(raw, { method = 'GET', headers = {}, payload, maxBytes = 1_500_000 } = {}, signal = new AbortController().signal) {
  const combined = AbortSignal.any([signal, stopping.signal, AbortSignal.timeout(20_000)]);
  const { url, selected } = await publicDestination(raw, combined);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method, signal: combined,
      lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      headers: { 'user-agent': 'kakuoku/0.1', accept: 'application/json', 'accept-encoding': 'identity', ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.destroy(); reject(new Error(`Сервис инструмента: HTTP ${res.statusCode}. Проверьте доступность, ключ и лимиты.`)); return; }
      const chunks = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) req.destroy(new Error('Ответ инструмента слишком большой.')); else chunks.push(chunk); });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => reject(new Error('Не удалось прочитать ответ инструмента.')));
    });
    req.on('error', () => reject(new Error('Нет ответа от сервиса инструмента или превышен лимит времени.')));
    req.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}

export async function postPublicJson(raw, apiKey, payload, signal = new AbortController().signal) {
  const { url, selected } = await publicDestination(raw, signal).catch(error => {
    signal.throwIfAborted();
    stopping.signal.throwIfAborted();
    throw new Error(`Не удалось подключиться к AI: ${error.message}`);
  });
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600_000);
    const fail = message => { clearTimeout(timer); reject(new Error(message)); };
    const req = request(url, {
      method: 'POST', signal: AbortSignal.any([controller.signal, stopping.signal, signal]),
      lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'identity' },
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy(); fail(`AI API: HTTP ${res.statusCode}. Проверьте эндпоинт, ключ, баланс и модель.`); return;
      }
      let bytes = 0; const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { req.destroy(); fail('Ответ AI API слишком большой.'); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { fail('AI API вернул некорректный JSON.'); }
      });
      res.on('error', () => fail('Не удалось прочитать ответ AI API.'));
    });
    req.on('error', () => fail('Нет ответа от AI API. Проверьте эндпоинт и подключение.'));
    req.end(JSON.stringify(payload));
  });
}

export async function publicPage(raw, redirects = 0, signal = new AbortController().signal, rss = false) {
  const { url, selected } = await publicDestination(raw, signal);
  const response = await new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const req = request(url, {
      method: 'GET',
      signal: AbortSignal.any([controller.signal, stopping.signal, signal]),
      lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
      headers: { 'user-agent': 'kakuoku/0.1 (public link reader)', accept: rss ? 'application/rss+xml,application/xml,text/xml' : 'text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1', 'accept-encoding': 'identity' },
    }, res => {
      const finish = value => { clearTimeout(timer); resolve(value); };
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirect = res.headers.location;
        res.destroy(); finish({ redirect }); return;
      }
      if (res.statusCode !== 200) { res.destroy(); clearTimeout(timer); reject(new Error(`Сайт ответил HTTP ${res.statusCode}`)); return; }
      const contentType = String(res.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
      const supported = rss ? /^(text\/xml|application\/(rss\+xml|xml))$/.test(contentType) : /^text\/(html|plain)$/.test(contentType) || jsonContentType.test(contentType);
      if (!supported) {
        res.destroy(); clearTimeout(timer); reject(new Error(rss ? 'Поисковый сервис не вернул RSS.' : 'Чтение поддерживает только HTML, обычный текст и JSON.')); return;
      }
      let bytes = 0; const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1_500_000) { req.destroy(new Error('Страница слишком большая.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => finish({ html: Buffer.concat(chunks).toString('utf8'), url: url.href, contentType }));
      res.on('error', () => { clearTimeout(timer); reject(new Error('Не удалось прочитать публичную страницу.')); });
    });
    req.on('error', () => { clearTimeout(timer); reject(new Error('Нет ответа от публичного сайта.')); });
    req.end();
  });
  if (response.redirect) {
    if (redirects >= 3) throw new Error('Слишком много перенаправлений.');
    return publicPage(new URL(response.redirect, url).href, redirects + 1, signal, rss);
  }
  return response;
}

export async function readUrl(url, signal) {
  const page = await publicPage(url, 0, signal);
  const format = jsonContentType.test(page.contentType) ? 'json' : page.contentType === 'text/plain' ? 'text' : 'html';
  let text = page.html, title = '';
  if (format === 'json') {
    text = text.replace(/^\uFEFF/, '').trim();
    try { JSON.parse(text); } catch { throw new Error('Ресурс вернул некорректный JSON.'); }
    // Keep the original text: parsing and serializing would round large numeric IDs.
  } else if (format === 'html') {
    const $ = load(text);
    $('script,style,noscript,iframe,form,nav,footer,svg').remove();
    title = $('title').text().slice(0, 300);
    text = $('body').text().replace(/\s+/g, ' ').trim();
  }
  return { url: page.url, title, text: text.slice(0, 18000), format, contentType: page.contentType, truncated: text.length > 18000, untrusted: true };
}

export async function searchWeb(query, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new Error('Нужен поисковый запрос до 300 символов.');
  let primaryError;
  try {
    const page = await publicPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, 0, signal);
    const $ = load(page.html);
    const results = [];
    $('.result').slice(0, 6).each((_, element) => {
      const link = $(element).find('.result__a');
      try {
        const wrapper = new URL(link.attr('href'), 'https://duckduckgo.com');
        const url = validatePublicUrl(wrapper.searchParams.get('uddg') || wrapper.href);
        results.push({ title: link.text().slice(0, 200), url: url.href, snippet: $(element).find('.result__snippet').text().slice(0, 500) });
      } catch { /* Ignore malformed search result links. */ }
    });
    if (!results.length) throw new Error('Поиск не вернул доступных результатов; возможно, сервис запросил CAPTCHA.');
    return { results, provider: 'duckduckgo', untrusted: true };
  } catch (error) {
    if (signal?.aborted || stopping.signal.aborted) throw error;
    primaryError = error;
  }
  try {
    const page = await publicPage(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, 0, signal, true);
    const $ = load(page.html, { xml: true });
    const results = [];
    $('channel > item').each((_, element) => {
      if (results.length >= 6) return;
      const item = $(element);
      try {
        const url = validatePublicUrl(item.children('link').text());
        results.push({ title: item.children('title').text().slice(0, 200), url: url.href, snippet: load(item.children('description').text()).text().slice(0, 500) });
      } catch { /* Ignore malformed or non-HTTPS search result links. */ }
    });
    if (!results.length) throw new Error('RSS не содержит доступных HTTPS-результатов.');
    return { results, provider: 'bing', untrusted: true };
  } catch (error) {
    if (signal?.aborted || stopping.signal.aborted) throw error;
    throw new Error(`Поиск временно недоступен. DuckDuckGo: ${primaryError.message} Bing: ${error.message}`);
  }
}
