/**
 * Создать структуру «БАЗЫ» в NocoDB — семь списков Димы.
 *
 * Идемпотентно: существующие таблицы пропускаются, данные не трогаются.
 * Наполнение — отдельный скрипт (push_nocodb.js), потому что структура
 * создаётся один раз, а данные обновляются каждое воскресенье.
 *
 * ПОЧЕМУ ЕСТЬ И «Адрес», И «Координаты» — они закрывают разные дыры,
 * причём у двух типов источников дыры ПРОТИВОПОЛОЖНЫЕ. Проверено на живой
 * базе 2026-07-20:
 *   конкуренты (store-locator'ы) — адрес 634/635, координаты 482/635:
 *     French Bakery (153 точки) координат не публикует вообще;
 *   НИИ/ВУЗы/колледжи (OSM) — координаты 100%, адрес у 140/472, 108/364, 64/286:
 *     тег адреса в OSM заполняют редко.
 * Адрес при этом лежит в РАЗНЫХ столбцах: store-locator отдаёт готовую строку
 * (places.address), OSM — теги (places.street + house). Поэтому колонка «Адрес»
 * собирается каскадом, как во вью v_competitors: address -> здание -> street+house.
 * Ни одно поле не покрывает всё, поэтому обе колонки nullable: где нет адреса,
 * точку находит координата, и наоборот. Пустая ячейка честнее выдуманной.
 *
 * Запуск:
 *   node run.js ./scripts/setup_nocodb.js
 */
import { loadConfig } from '../src/config.js';
import { NocodbClient, num, select, text } from '../src/lib/nocodb.js';

// Статусы объектов недвижимости и статусы точек конкурентов различаются:
// здание не «закрывается», а точка сети не «строится».
const STATUS_OBJECT = ['действует', 'новый', 'строится', 'редевелопмент'];
const STATUS_POINT = ['активна', 'новая точка', 'кандидат_на_закрытие', 'закрыта'];

const CHAINS = [
  'drinkit', 'french bakery', 'братья караваевы', 'prime', 'муму', 'здрасте',
  'шоколадница', 'bodro coffee', 'parle market', 'правда кофе', 'дни недели',
];

// Первая колонка каждой таблицы помечается pv: это то, что NocoDB
// показывает как «имя строки». Без неё витрина выглядит безымянной.
const primary = (col) => ({ ...col, pv: true });

export const SCHEMA = [
  ['БЦ Москвы', [
    primary(text('Название БЦ')), text('Адрес'),
    num('Общая площадь, м²'), select('Статус', STATUS_OBJECT),
    text('Дата запуска'), text('Источник площади'), text('Примечание'),
  ]],
  ['Офисные здания', [
    primary(text('Адрес')), num('Общая площадь, м²'),
    select('Статус', STATUS_OBJECT), text('Дата запуска'),
    text('Источник площади'), text('Примечание'),
  ]],
  ['Офисы компаний', [
    primary(text('Название компании')), text('Адрес'),
    num('Общая площадь офиса, м²'), num('Кол-во сотрудников'),
    select('Статус', STATUS_OBJECT), text('Примечание'),
  ]],
  ['НИИ', [
    primary(text('Название НИИ')), text('Адрес'), text('Координаты'),
    num('Общая площадь, м²'), select('Статус', STATUS_OBJECT), text('Примечание'),
  ]],
  ['ВУЗы', [
    primary(text('Название ВУЗа')), text('Адрес'), text('Координаты'),
    num('Общая площадь, м²'), num('Кол-во студентов'),
    select('Статус', STATUS_OBJECT), text('Примечание'),
  ]],
  ['ТЦ с супермаркетом', [
    primary(text('Название ТЦ')), text('Адрес'), text('Продуктовый супермаркет'),
    num('Общая площадь, м²'), select('Статус', STATUS_OBJECT), text('Примечание'),
  ]],
  ['Конкуренты', [
    primary(text('Название точки')), select('Сеть', CHAINS),
    text('Адрес'), text('Координаты'), select('Статус', STATUS_POINT),
    text('Дата изменения'), text('Источник'),
  ]],
];

const client = new NocodbClient(loadConfig());
const existing = await client.tables();

console.log(`в базе уже таблиц: ${existing.size}`);

for (const [title, columns] of SCHEMA) {
  if (existing.has(title)) {
    console.log(`— «${title}»: уже есть, пропускаю`);
    continue;
  }
  const id = await client.createTable(title, columns);

  // Проверяем, что создалось, а не верим ответу: опции SingleSelect —
  // самое хрупкое место, и молча пустой список хуже явной ошибки.
  const created = await client.columns(id);
  const selects = created.filter((c) => c.uidt === 'SingleSelect');
  const broken = selects.filter((c) => !(c.colOptions?.options?.length > 0));

  console.log(
    `✓ «${title}»: ${created.length} колонок, ` +
      `списков выбора ${selects.length}${broken.length ? ` — БЕЗ ОПЦИЙ: ${broken.map((c) => c.title).join(', ')}` : ''}`
  );
}

console.log('');
console.log('Структура готова. Дальше: node run.js ./scripts/push_nocodb.js');
