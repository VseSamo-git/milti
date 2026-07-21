/**
 * Собрать витрину Димы в NocoDB: семь листов из его задания.
 *
 * ИСТОЧНИК ПРАВДЫ — СХЕМА vitrina В POSTGRES. Каждому вью соответствует
 * один лист. Колонки листа берутся из колонок вью, а не дублируются здесь:
 * поменял SQL — поменялась витрина, править скрипт не надо.
 *
 * ПОЧЕМУ КОПИЯ, А НЕ ОКНО. Правильнее было бы подключить Postgres как
 * внешний источник — тогда копии нет вовсе. Так и было сделано, и на
 * схеме kosmos это работало: 11 таблиц импортировались. Но вью из схемы
 * vitrina NocoDB не импортирует — проверено экспериментом: два тестовых
 * вью (латиницей и кириллицей) не подхватились ни одно, значит дело не
 * в именах. Бороться дальше дороже, чем перезаливать: строк около двух
 * тысяч, заливка занимает минуту, а лимита строк на своём сервере нет.
 * Витрина обновляется воскресным конвейером — рассинхрон живёт неделю
 * максимум, и это цена, которую видно и можно назвать.
 *
 * Запуск:
 *   node run.js ./scripts/build_vitrina.js            — все семь листов
 *   node run.js ./scripts/build_vitrina.js 7          — только лист 7
 *   node run.js ./scripts/build_vitrina.js "7 Конкуренты"
 *
 * Точечная пересборка бережёт остальные листы: полный прогон дропает и
 * создаёт КАЖДУЮ таблицу заново, а Дима уже мог начать работать в базе.
 */
import { loadConfig } from '../src/config.js';
import { NocodbClient, num, select, text } from '../src/lib/nocodb.js';
import { Registry } from '../src/lib/registry.js';
import { SHEET_VIEWS } from '../src/lib/vitrina_views.js';

const cfg = loadConfig();
const client = new NocodbClient(cfg);
const registry = new Registry(cfg);

// Числовые типы Postgres, которые должны стать числами и в витрине:
// иначе NocoDB отсортирует площади как строки и поставит «900» выше «10000».
const NUMERIC = new Set(['integer', 'bigint', 'numeric', 'double precision', 'real', 'smallint']);

// Текстовая колонка с малым числом различных значений — это на самом деле
// справочник: «Статус», «Тип», «Сеть», «Достоверность». В витрине они должны
// быть плашками выбора, а не серым текстом: так их видно, по ним фильтруют
// в один клик, и опечатка в фильтре становится невозможной.
// Порог 15: у «Сети» одиннадцать значений, у адреса — тысячи.
const MAX_ENUM_VALUES = 15;

async function enumOptions(registry, view, column) {
  const rows = await registry.sql.unsafe(
    `SELECT DISTINCT "${column}" AS v FROM vitrina."${view}"
     WHERE "${column}" IS NOT NULL LIMIT ${MAX_ENUM_VALUES + 1}`
  );
  // Одно значение на всю колонку — это не справочник, а константа:
  // фильтровать по ней нечего, плашка только занимает место.
  if (rows.length < 2 || rows.length > MAX_ENUM_VALUES) return null;

  // dtxp перечисляет опции через запятую и обрамляет апострофами, поэтому
  // значение с любым из этих символов он разрежет на куски. Поймано на
  // живых данных: «офисное использование установлено городом (перечень
  // 700-ПП), на картах как БЦ не значится» превратилось в две битые опции
  // и уронило заливку. Такие колонки оставляем текстом.
  const values = rows.map((r) => String(r.v));
  if (values.some((v) => v.includes("'") || v.includes(','))) return null;

  return values.sort();
}

try {
  const allViews = await registry.sql`
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'vitrina' AND table_name ~ '^[1-9] '
    ORDER BY table_name`;

  // Необязательный фильтр: номер листа ('7') или полное имя ('7 Конкуренты').
  const only = (process.argv[2] || '').trim();
  const views = only
    ? allViews.filter((v) => v.table_name === only || v.table_name.startsWith(`${only} `))
    : allViews;
  if (only && views.length === 0) {
    throw new Error(`лист «${only}» не найден. Есть: ${allViews.map((v) => v.table_name).join(', ')}`);
  }

  console.log(`листов к сборке: ${views.length}${only ? ` (фильтр «${only}»)` : ''}`);
  const existing = await client.tables();

  for (const { table_name: view } of views) {
    const cols = await registry.sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'vitrina' AND table_name = ${view}
      ORDER BY ordinal_position`;

    const rows = await registry.sql.unsafe(`SELECT * FROM vitrina."${view}"`);

    // Пересобираем лист с нуля: так витрина всегда соответствует вью,
    // а не накапливает следы прошлых прогонов.
    if (existing.has(view)) await client.deleteTable(existing.get(view));

    const columns = [];
    for (const [i, c] of cols.entries()) {
      let col;
      if (NUMERIC.has(c.data_type)) {
        col = num(c.column_name);
      } else {
        const options = await enumOptions(registry, view, c.column_name);
        col = options ? select(c.column_name, options) : text(c.column_name);
      }
      columns.push(i === 0 ? { ...col, pv: true } : col);
    }

    const tableId = await client.createTable(view, columns);

    if (rows.length > 0) {
      await client.insert(
        tableId,
        rows.map((r) => {
          const out = {};
          for (const c of cols) {
            const v = r[c.column_name];
            // NULL остаётся NULL: пустая ячейка честнее выдуманной.
            out[c.column_name] = v === null || v === undefined ? null : v;
          }
          return out;
        }),
        { onProgress: (d, t) => { if (d % 400 === 0 || d === t) console.log(`   ${view}: ${d}/${t}`); } }
      );
    }

    // Срезы создаём ПОСЛЕ заливки: фильтр по пустой таблице выглядит
    // сломанным, и первое впечатление у Димы будет «ничего не работает».
    const defs = SHEET_VIEWS[view] || [];
    for (const def of defs) await client.createView(tableId, def);

    const selects = columns.filter((c) => c.uidt === 'SingleSelect').length;
    console.log(
      `✓ ${view}: ${rows.length} строк, ${cols.length} колонок ` +
        `(плашек ${selects}, срезов ${defs.length})`
    );
  }

  console.log('');
  console.log(`Витрина готова: ${cfg.nocodbUrl}`);
} finally {
  await registry.close();
}
