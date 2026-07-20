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
 *   node run.js ./scripts/build_vitrina.js
 */
import { loadConfig } from '../src/config.js';
import { NocodbClient, num, text } from '../src/lib/nocodb.js';
import { Registry } from '../src/lib/registry.js';

const cfg = loadConfig();
const client = new NocodbClient(cfg);
const registry = new Registry(cfg);

// Числовые типы Postgres, которые должны стать числами и в витрине:
// иначе NocoDB отсортирует площади как строки и поставит «900» выше «10000».
const NUMERIC = new Set(['integer', 'bigint', 'numeric', 'double precision', 'real', 'smallint']);

try {
  const views = await registry.sql`
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'vitrina' AND table_name ~ '^[1-9] '
    ORDER BY table_name`;

  console.log(`листов к сборке: ${views.length}`);
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

    const columns = cols.map((c, i) => {
      const col = NUMERIC.has(c.data_type) ? num(c.column_name) : text(c.column_name);
      return i === 0 ? { ...col, pv: true } : col;
    });

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

    console.log(`✓ ${view}: ${rows.length} строк, ${cols.length} колонок`);
  }

  console.log('');
  console.log(`Витрина готова: ${cfg.nocodbUrl}`);
} finally {
  await registry.close();
}
