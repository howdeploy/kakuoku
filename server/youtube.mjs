import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serviceRequest, validatePublicUrl } from './web.mjs';

const idPattern = /^[A-Za-z0-9_-]{11}$/;
const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']);

export function youtubeIds(note) {
  const ids = new Set();
  for (const message of note.messages.filter(item => item.role === 'user')) {
    for (const match of message.text.matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
      try {
        const url = validatePublicUrl(match[0].replace(/[).,;!?\]}]+$/, ''));
        if (!hosts.has(url.hostname)) continue;
        const id = url.hostname === 'youtu.be' ? url.pathname.split('/')[1] : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null;
        if (idPattern.test(id || '')) ids.add(id);
      } catch { /* Only explicit public YouTube URLs in this note grant access. */ }
    }
  }
  return ids;
}

async function broker(request, videoId, signal) {
  if (!request || !['GET', 'POST'].includes(request.method) || typeof request.url !== 'string' || request.url.length > 8192) throw new Error('Запрос субтитров запрещён.');
  const url = validatePublicUrl(request.url);
  if (!['www.youtube.com', 'youtube.com'].includes(url.hostname)) throw new Error('Адрес сервиса субтитров запрещён.');
  const watch = url.pathname === '/watch' && url.searchParams.get('v') === videoId && request.method === 'GET';
  const captions = url.pathname === '/api/timedtext' && url.searchParams.get('v') === videoId && request.method === 'GET';
  const player = url.pathname === '/youtubei/v1/player' && request.method === 'POST' && request.payload?.videoId === videoId;
  if (!watch && !captions && !player) throw new Error('Операция сервиса субтитров запрещена.');
  const consent = request.consent || '';
  if (typeof consent !== 'string' || consent.length > 300 || (consent && !/^YES\+[A-Za-z0-9_+.-]+$/.test(consent))) throw new Error('Некорректный consent сервиса субтитров.');
  // The embedded public YouTube client key is not an application/user secret.
  return serviceRequest(url.href, { method: request.method, payload: player ? { context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } }, videoId } : undefined,
    headers: { accept: 'text/html,application/json,text/xml', 'accept-language': 'en-US', ...(consent ? { cookie: `CONSENT=${consent}` } : {}) }, maxBytes: 3_000_000 }, signal);
}

async function localTranscript(videoId, signal) {
  return new Promise((resolve, reject) => {
    const lifecycle = new AbortController();
    const requestSignal = AbortSignal.any([signal, lifecycle.signal]);
    const worker = spawn(fileURLToPath(new URL('./bin/kakuoku-media-sandbox', import.meta.url)), ['/opt/kakuoku-youtube/bin/python3', '-I', '-B', '/app/server/youtube-worker.py'], { cwd: '/', env: {}, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '', result, failure, requests = 0, handling = false;
    const abort = () => { failure ||= new Error('Получение субтитров прервано или превысило 60 секунд.'); worker.kill('SIGKILL'); };
    const timer = setTimeout(abort, 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    worker.stdin.on('error', () => {});
    worker.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 600_000) { failure = new Error('Слишком большой ответ обработчика субтитров.'); worker.kill('SIGKILL'); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (value.request) {
            if (handling || ++requests > 6) throw new Error('Превышен лимит запросов субтитров.');
            handling = true;
            broker(value.request, videoId, requestSignal).then(response => { if (!worker.killed) worker.stdin.write(JSON.stringify(response) + '\n'); }, () => { if (!worker.killed) worker.stdin.write('{"error":"YouTubeNetworkError"}\n'); }).finally(() => { handling = false; });
          } else if (value.result) result = value.result;
          else throw new Error(value.error === 'YouTubeNetworkError' ? 'Не удалось обратиться к YouTube: ограничение сети, HTTP или размера ответа. Субтитры не получены.' : ['RequestBlocked', 'IpBlocked'].includes(value.error) ? 'YouTube заблокировал получение субтитров с этого IP. Выберите другой провайдер в настройках.' : 'Субтитры недоступны: у ролика их нет, доступ ограничен или YouTube изменил протокол.');
        } catch (error) { failure = error; worker.kill('SIGKILL'); }
      }
    });
    worker.on('error', () => { failure = new Error('Локальная библиотека субтитров недоступна. Используйте production-контейнер.'); });
    worker.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); lifecycle.abort();
      if (code === 125) reject(new Error('Linux/Docker не разрешает безопасный обработчик субтитров (Landlock/seccomp).'));
      else if (failure || code !== 0 || !Array.isArray(result?.segments) || !result.segments.length) reject(failure || new Error('Субтитры не получены.'));
      else resolve(result);
    });
    worker.stdin.write(JSON.stringify({ videoId }) + '\n');
  });
}

async function hostedTranscript(videoId, key, signal) {
  if (!key) throw new Error('Добавьте ключ Supadata в настройках инструментов.');
  const headers = { 'x-api-key': key };
  const url = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&mode=native&text=false`;
  let value;
  const read = async endpoint => {
    const response = await serviceRequest(endpoint, { headers }, signal);
    let data;
    try { data = JSON.parse(response.text); } catch { throw new Error('Supadata вернул некорректный ответ.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Supadata вернул некорректный ответ.');
    return data;
  };
  value = await read(url);
  if (value.jobId) {
    if (typeof value.jobId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value.jobId)) throw new Error('Supadata вернул некорректный ID задания.');
    const job = value.jobId;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(new Error('Получение субтитров прервано.')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1500);
        signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      });
      value = await read(`https://api.supadata.ai/v1/transcript/${job}`);
      if (value.status === 'completed' || value.content) break;
      if (value.status === 'failed') throw new Error('Supadata не смог получить субтитры.');
    }
  }
  if (!Array.isArray(value.content) || !value.content.length) throw new Error('Supadata не вернул субтитры за отведённое время.');
  const segments = []; let remaining = 32_000;
  for (const item of value.content) {
    if (!remaining || segments.length >= 1000) break;
    if (typeof item.text !== 'string' || !Number.isFinite(item.offset) || item.offset < 0 || !Number.isFinite(item.duration) || item.duration < 0) throw new Error('Некорректный формат субтитров Supadata.');
    const text = item.text.slice(0, Math.min(2000, remaining)); remaining -= text.length;
    segments.push({ text, start: item.offset / 1000, duration: item.duration / 1000 });
  }
  return { language: String(value.lang || '').slice(0, 30), generated: null, segments, truncated: segments.length < value.content.length || remaining === 0 };
}

export async function youtubeTranscript(videoId, note, config, signal = new AbortController().signal) {
  if (config.mode !== 'research' || config.tools.youtubeProvider === 'off') throw new Error('Инструмент YouTube отключён.');
  if (typeof videoId !== 'string' || !idPattern.test(videoId) || !youtubeIds(note).has(videoId)) throw new Error('Можно читать только ролики из ссылок пользователя в этой заметке.');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const provider = config.tools.youtubeProvider;
  if (!['local', 'supadata'].includes(provider)) throw new Error('Провайдер YouTube недоступен.');
  const result = provider === 'local' ? await localTranscript(videoId, deadline) : await hostedTranscript(videoId, config.tools.keys.supadata, deadline);
  return { url: `https://www.youtube.com/watch?v=${videoId}`, title: `YouTube · ${videoId}`, provider, ...result, understanding: 'captions-only', untrusted: true };
}
