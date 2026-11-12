const samples = [
  {
    title: 'Маленький дом у моря', color: 'blue', avatar: 1, tags: ['путешествия', 'дом', 'места', 'планы'],
    summary: 'Место, где можно выдохнуть.\n\nНебольшой дом, море в пешей доступности и рабочий стол у окна. Пока смотрю на Португалию и север Испании.\n\nХочется пожить месяц, а не проскочить туристом. Следующий шаг — сравнить районы и бюджет на осень.',
    thoughts: ['Хочу на месяц к морю. Не в отель, а в маленький дом с кухней. Нужен стабильный интернет и минимум людей.', 'Португалия или север Испании. Вот куда смотреть: https://www.visitportugal.com/ — пока просто сохрани ссылку.'],
    answer: 'Пример ответа: собрала пожелания в одну заметку. Осталось определиться с месяцем, бюджетом и тем, насколько близко хочется жить к воде. Ссылку ещё нужно проверить.',
  },
  {
    title: 'Не забыть, зачем всё это', color: 'yellow', avatar: 0, tags: ['мысли', 'привычки', 'отдых'],
    summary: 'Делать меньше.\nЗамечать больше.\n\nНе превращать каждую мысль в задачу. Иногда сохранить её — уже достаточно.',
    thoughts: ['Кажется, я слишком часто превращаю интерес в обязательство. Хочу оставить место вещам, которые делаю просто так.', 'Фраза на сегодня: делать меньше, замечать больше.'],
    answer: 'Пример ответа: пусть эта заметка будет местом для мыслей без дедлайна. Ничего не нужно решать прямо сейчас.',
  },
  {
    title: 'Свой уголок интернета', color: 'pink', avatar: 2, tags: ['сайты', 'идеи', 'дизайн', 'творчество'],
    summary: 'Личный сайт, в котором чувствуешь себя дома.\n\nДневник, полка любимых ссылок и немного странных находок. Без ленты рекомендаций и гонки за цифрами.\n\nСначала — одна живая страница. Потом всё остальное.',
    thoughts: ['Хочу личный сайт: дневник, ссылки, музыка. Не портфолио и не витрина услуг.', 'Больше всего нравится идея маленького интернета: https://neocities.org/'],
    answer: 'Пример ответа: ядро идеи — место для себя. Можно начать с главной страницы и полки ссылок, а дневник добавить, когда появится первая запись.',
  },
  {
    title: 'Что послушать вечером', color: 'lavender', avatar: 4, tags: ['музыка', 'отдых', 'ссылки'],
    summary: 'Звук для медленного вечера.\n\nЯпонский эмбиент, тёплый джаз и записи дождя. Без вокала, который перетягивает внимание.\n\nHiroshi Yoshimura — начать с Green. Дальше собрать небольшую полку альбомов.',
    thoughts: ['Хочу список спокойной музыки без вокала. Сохранить Hiroshi Yoshimura — Green.'],
    answer: 'Пример ответа: записала альбом и настроение. Позже можно собрать подборку и проверить ссылки на прослушивание.',
  },
  {
    title: 'Заметки о внимании', color: 'mint', avatar: 5, tags: ['мысли', 'привычки', 'идеи'],
    summary: 'Мысль не обязана быть законченной.\n\nБлокнот нужен, чтобы разгрузить голову, а не ещё раз её организовать. Хочется собирать обрывки, возвращаться к ним и видеть, что между ними общего.',
    thoughts: ['Кажется, хорошая записная книжка не требует сразу придумывать папку и тег. Просто бросаешь туда мысль и идёшь дальше.'],
    answer: 'Пример ответа: сохранила. Общая нить здесь — меньше действий между мыслью и записью.',
  },
  {
    title: 'Кофе, который хочется повторить', color: 'white', avatar: 3, tags: ['кофе', 'рецепты', 'еда'],
    summary: 'Эфиопия. Мытая обработка.\n\nВ чашке — что-то цветочное, немного персика и никакой горечи.\n\nЗапомнить: 15 г кофе, 250 г воды, 93 °C. В следующий раз попробовать чуть крупнее помол.',
    thoughts: ['Сегодня удачный V60: Эфиопия, 15/250, 93 градуса. Надо чуть крупнее помол в следующий раз.'],
    answer: 'Пример ответа: рецепт сохранён. В следующем заваривании меняем только помол — так будет проще сравнить.',
  },
];

export function seedDemo(store, catalog) {
  // Persist the seed marker: deleting demo notes must not bring them back on restart.
  store.db.exec('CREATE TABLE IF NOT EXISTS demo_meta (key TEXT PRIMARY KEY)');
  const seeded = store.db.prepare('SELECT key FROM demo_meta WHERE key=?');
  if (!seeded.get('seeded') && store.list().length === 0) for (const sample of samples.toReversed()) {
    const note = store.create(sample);
    for (const text of sample.thoughts) store.addMessage(note.id, { text });
    store.addMessage(note.id, { text: sample.answer, role: 'assistant' });
    store.summarize(note.id, sample.summary, store.note(note.id).revision, 'example', '', sample.tags.filter(tag => catalog.includes(tag)));
  }
  store.db.prepare('INSERT OR IGNORE INTO demo_meta VALUES(?)').run('seeded');
  if (seeded.get('tags-seeded')) return;
  for (const note of store.list()) {
    const sample = samples.find(sample => sample.title === note.title && sample.summary === note.summary);
    if (sample && note.summary_source === 'example' && !note.tags.length) store.summarize(note.id, note.summary, note.revision, note.summary_source, note.summary_key, sample.tags.filter(tag => catalog.includes(tag)));
  }
  store.db.prepare('INSERT INTO demo_meta VALUES(?)').run('tags-seeded');
}
