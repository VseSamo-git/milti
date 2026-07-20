/**
 * Выложить готовые списки из Postgres в витрину NocoDB.
 *
 * НАПРАВЛЕНИЕ ОДНО: Postgres -> NocoDB. Обратно ничего не читаем.
 * Postgres считает (SQL, констрейнты, вычитание), NocoDB показывает.
 * Дима правит вердикты у себя — их мы не затираем, потому что пишем
 * только в те таблицы и только те строки, которые породил конвейер.
 *
 * ЗАЩИТА ОТ ДУБЛЕЙ: если в таблице уже есть строки, заливка пропускается.
 * Перезалить принудительно: --force (удаляет всё и пишет заново).
 * Инкрементальное обновление — задача воскресного конвейера, не этого шага.
 *
 * Запуск:
 *   node run.js ./scripts/push_nocodb.js competitors
 *   node run.js ./scripts/push_nocodb.js education
 *   node run.js ./scripts/push_nocodb.js all
 *   node run.js ./scripts/push_nocodb.js all --force
 */
import { loadConfig } from '../src/config.js';
import { formatCoords, NocodbClient } from '../src/lib/nocodb.js';
import { Registry } from '../src/lib/registry.js';

const cfg = loadConfig();
const client = new NocodbClient(cfg);
const registry = new Registry(cfg);

const force = process.argv.includes('--force');
const stage = process.argv.find((a) => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]) || 'all';

/**
 * Адрес точки. Приоритет — колонке address: её заполняют store-locator'ы
 * официальных сайтов, и там адрес полный. У точек из OSM address пуст,
 * зато иногда есть теги street/house — собираем из них. Если нет ничего,
 * возвращаем null: пустая ячейка честнее выдуманной.
 */
function addressOf(row) {
  if (row.address) return row.address;
  if (!row.street) return null;
  return row.house ? `${row.street}, ${row.house}` : row.street;
}

/**
 * Залить таблицу, если она пуста.
 * @returns {Promise<number>} сколько строк залито (0 = пропущено)
 */
async function fill(tables, title, rows) {
  const id = tables.get(title);
  if (!id) {
    console.log(`— «${title}»: таблицы нет, сначала setup_nocodb.js`);
    return 0;
  }

  const already = await client.count(id);
  if (already > 0) {
    if (!force) {
      console.log(`— «${title}»: уже ${already} строк, пропускаю (--force чтобы перезалить)`);
      return 0;
    }
    // Без очистки --force дописал бы строки поверх существующих и
    // удвоил таблицу. Сначала стираем, потом пишем.
    const removed = await client.clear(id);
    console.log(`   «${title}»: стёрто ${removed} старых строк`);
  }

  const sent = await client.insert(id, rows, {
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) console.log(`   ${title}: ${done}/${total}`);
    },
  });
  console.log(`✓ «${title}»: залито ${sent}`);
  return sent;
}

async function stageCompetitors(tables) {
  const rows = await registry.sql`
    SELECT name, chain, street, house, address, lat, lon, status, source
    FROM kosmos.places WHERE kind = 'конкурент'
    ORDER BY chain, name`;

  console.log(`конкурентов в базе: ${rows.length}`);
  return fill(tables, 'Конкуренты', rows.map((r) => ({
    'Название точки': r.name,
    'Сеть': r.chain,
    'Адрес': addressOf(r),
    'Координаты': formatCoords(r.lat, r.lon),
    'Статус': r.status,
    // Источник пишем как есть: сайт сети или OSM. Дима должен видеть,
    // откуда строка, чтобы знать, чему доверять.
    'Источник': r.source,
  })));
}

async function stageEducation(tables) {
  const nii = await registry.sql`
    SELECT name, street, house, address, lat, lon FROM kosmos.places
    WHERE kind = 'нии' AND status = 'активна' ORDER BY name`;
  console.log(`НИИ в базе: ${nii.length}`);
  await fill(tables, 'НИИ', nii.map((r) => ({
    'Название НИИ': r.name,
    'Адрес': addressOf(r),
    'Координаты': formatCoords(r.lat, r.lon),
    'Статус': 'действует',
    'Примечание': 'площадь не установлена — нужна связка с адресным реестром',
  })));

  // Колледжи идут вместе с ВУЗами: Дима просил ВУЗы, но колледж с 2000
  // студентов для островка — тот же трафик. Помечаем видом в примечании,
  // чтобы Дима мог отфильтровать, а не искать их отдельно.
  const vuz = await registry.sql`
    SELECT name, kind, street, house, address, lat, lon FROM kosmos.places
    WHERE kind IN ('вуз', 'колледж') AND status = 'активна' ORDER BY kind, name`;
  console.log(`ВУЗов и колледжей в базе: ${vuz.length}`);
  await fill(tables, 'ВУЗы', vuz.map((r) => ({
    'Название ВУЗа': r.name,
    'Адрес': addressOf(r),
    'Координаты': formatCoords(r.lat, r.lon),
    'Статус': 'действует',
    'Примечание': r.kind === 'колледж' ? 'колледж' : 'ВУЗ',
  })));
}

try {
  const tables = await client.tables();

  if (stage === 'competitors' || stage === 'all') await stageCompetitors(tables);
  if (stage === 'education' || stage === 'all') await stageEducation(tables);

  console.log('');
  console.log('© OpenStreetMap contributors, ODbL.');
} finally {
  await registry.close();
}
