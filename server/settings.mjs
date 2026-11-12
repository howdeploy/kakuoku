import { validatePublicUrl } from './web.mjs';
import { aiModels } from '../shared/ai-models.mjs';
import { defaultTags, normalizeTagCatalog } from '../shared/tags.mjs';

export const defaults = {
  endpoint: 'https://api.ghostmetal.io/v1',
  model: 'glm-5.3-long',
  visionModel: 'same',
  mode: 'research',
  researchMaxCalls: 12,
  tags: defaultTags,
  tools: { searchProvider: 'builtin', youtubeProvider: 'local' },
  prompts: {
    chat: 'Ты — внимательный собеседник в личной тематической записной книжке Kakuoku. Отвечай по-русски, кратко и по существу. Помогай осмыслить, проверить и дополнить мысли пользователя. Отделяй факты от предложений, называй неопределённость. Проверяй присланные ссылки, когда доступны инструменты исследования, и подкрепляй найденное прямыми HTTPS-ссылками. Не используй HTML.',
    preview: 'Суммируй всю переписку: о чём тема, что уже выяснено, что важно сохранить, какой вопрос открыт. Только содержательная выжимка, без приветствия, метакомментариев, Markdown и слов «в этой заметке». 2–4 коротких абзаца, максимум 700 символов. Не приписывай пользователю предложения агента как принятые решения. Сохрани язык переписки.',
    sorting: 'Найди заметки об одной конкретной теме, которые полезно собрать в одну. Не объединяй разные темы по одному общему слову. Сохрани важные факты, ссылки, ограничения, различия мнений и нерешённые вопросы; не принимай предложения агента за решения пользователя. Текст по-русски, без Markdown и вступлений.',
  },
};

function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }

export function openSettings(db) {
  db.exec('CREATE TABLE IF NOT EXISTS app_settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
  const stored = () => {
    const row = db.prepare('SELECT body FROM app_settings WHERE id=1').get();
    return row ? JSON.parse(row.body) : { ...defaults, apiKey: null };
  };
  function read() {
    const value = stored();
    return { ...value, tags: value.tags ?? defaults.tags, researchMaxCalls: value.researchMaxCalls ?? defaults.researchMaxCalls, tools: { ...defaults.tools, ...value.tools, keys: { ...value.tools?.keys } }, apiKey: value.apiKey ?? process.env.GHOSTMETAL_API_KEY ?? '', model: value.model ?? process.env.GHOSTMETAL_MODEL ?? defaults.model, visionModel: value.visionModel ?? defaults.visionModel };
  }
  function publicSettings() {
    const { endpoint, mode, prompts, apiKey, tools, researchMaxCalls, model, visionModel, tags } = read();
    return { endpoint, mode, prompts, researchMaxCalls, model, visionModel, tags, hasApiKey: Boolean(apiKey), tools: { searchProvider: tools.searchProvider, youtubeProvider: tools.youtubeProvider, hasKeys: Object.fromEntries(['tavily', 'brave', 'supadata'].map(name => [name, Boolean(tools.keys[name])])) } };
  }
  function save(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Ожидается объект настроек.');
    const value = stored();
    if (input.tags !== undefined) value.tags = normalizeTagCatalog(input.tags);
    if (input.model !== undefined) {
      if (!aiModels.some(model => model.id === input.model) && input.model !== read().model) invalid('Выберите доступную модель чата.');
      value.model = input.model;
    }
    if (input.visionModel !== undefined) {
      if (!['same', 'off', ...aiModels.filter(model => model.vision).map(model => model.id)].includes(input.visionModel)) invalid('Выберите модель анализа изображений.');
      value.visionModel = input.visionModel;
    }
    if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) invalid('Укажите HTTPS-эндпоинт API.');
    let url;
    try { url = validatePublicUrl(input.endpoint.trim()); }
    catch { invalid('Нужен публичный HTTPS-эндпоинт без логина и нестандартного порта.'); }
    if (url.search || url.hash) invalid('Эндпоинт не должен содержать параметры или фрагмент.');
    value.endpoint = url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    if (!['chat', 'research', 'notes'].includes(input.mode)) invalid('Выберите режим агента.');
    value.mode = input.mode;
    if (input.researchMaxCalls !== undefined) {
      if (!Number.isInteger(input.researchMaxCalls) || input.researchMaxCalls < 4 || input.researchMaxCalls > 12) invalid('Лимит исследования: целое число от 4 до 12 обращений.');
      value.researchMaxCalls = input.researchMaxCalls;
    }
    const prompts = {};
    for (const key of Object.keys(defaults.prompts)) {
      if (typeof input.prompts?.[key] !== 'string' || !input.prompts[key].trim() || input.prompts[key].length > 12000) invalid('Каждый промпт должен содержать от 1 до 12 000 символов.');
      prompts[key] = input.prompts[key].trim();
    }
    value.prompts = prompts;
    if (input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') invalid('Некорректное действие с ключом.');
    if (input.apiKey !== undefined) {
      if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096 || /[\s\x00-\x1f\x7f-\uffff]/.test(input.apiKey)) invalid('API-ключ должен содержать печатные символы без пробелов.');
      if (input.clearApiKey) invalid('Нельзя одновременно удалить и заменить ключ.');
      value.apiKey = input.apiKey;
    } else if (input.clearApiKey) value.apiKey = '';
    if (input.tools !== undefined) {
      const tools = input.tools;
      if (!tools || typeof tools !== 'object' || Array.isArray(tools) || Object.keys(tools).some(key => !['searchProvider', 'youtubeProvider', 'keys', 'clearKeys'].includes(key))) invalid('Некорректные настройки инструментов.');
      if (!['builtin', 'tavily', 'brave', 'off'].includes(tools.searchProvider) || !['local', 'supadata', 'off'].includes(tools.youtubeProvider)) invalid('Выберите поддерживаемого провайдера инструментов.');
      const names = ['tavily', 'brave', 'supadata'];
      const keys = tools.keys ?? {};
      const clear = tools.clearKeys ?? [];
      if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).some(name => !names.includes(name)) || !Array.isArray(clear) || clear.some(name => !names.includes(name))) invalid('Некорректное действие с ключами инструментов.');
      const nextKeys = { ...value.tools?.keys };
      for (const name of names) {
        if (keys[name] !== undefined) {
          if (typeof keys[name] !== 'string' || !keys[name] || keys[name].length > 4096 || /[\s\x00-\x1f\x7f-\uffff]/.test(keys[name]) || clear.includes(name)) invalid('Ключ инструмента должен содержать печатные символы без пробелов; нельзя заменить и удалить его одновременно.');
          nextKeys[name] = keys[name];
        } else if (clear.includes(name)) nextKeys[name] = '';
      }
      value.tools = { searchProvider: tools.searchProvider, youtubeProvider: tools.youtubeProvider, keys: nextKeys };
    }
    db.prepare('INSERT INTO app_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(value));
    return publicSettings();
  }
  return { read, publicSettings, save };
}
