export const defaultTags = [
  'работа', 'проекты', 'идеи', 'планы', 'задачи', 'исследование', 'обучение',
  'программирование', 'дизайн', 'технологии', 'ai', 'сайты', 'творчество',
  'тексты', 'музыка', 'кино', 'книги', 'игры', 'фото', 'видео',
  'путешествия', 'места', 'дом', 'покупки', 'финансы', 'здоровье', 'спорт',
  'еда', 'кофе', 'рецепты', 'отношения', 'мысли', 'привычки', 'отдых',
  'природа', 'ссылки',
];

export function normalizeTagCatalog(input) {
  const invalid = () => { throw Object.assign(new Error('Нужно до 64 уникальных тегов: буквы, цифры, дефис или подчёркивание, до 24 символов каждый.'), { status: 400 }); };
  if (!Array.isArray(input) || input.length > 128 || input.some(tag => typeof tag !== 'string' || tag.length > 100)) invalid();
  const tags = input.map(tag => tag.trim().normalize('NFKC').toLowerCase().replace(/^#/, '')).filter(Boolean);
  if (tags.length > 64 || new Set(tags).size !== tags.length || tags.some(tag => tag.length > 24 || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag))) invalid();
  return tags;
}

export function validTagSelection(tags, catalog) {
  return Array.isArray(tags) && tags.length >= Math.min(3, catalog.length) && tags.length <= Math.min(5, catalog.length) && new Set(tags).size === tags.length && tags.every(tag => catalog.includes(tag));
}
