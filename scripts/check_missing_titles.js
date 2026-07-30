// Где по каждому листу витрины пусто в названии? Считаем NULL/(без названия).
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
// [лист, колонка-название]
const SHEETS = [
  ['База', 'Название'],
  ['На проверку', 'Название'],
  ['БЦ средние 5-10к', 'Название БЦ'],
  ['ТЦ с супермаркетом', 'Название ТЦ'],
  ['Конкуренты', 'Сеть'],
  ['Открытые точки', 'Название'],
  ['Закрытые точки', 'Название'],
];
try {
  for (const [sheet, col] of SHEETS) {
    try {
      const [{ total }] = await sql.unsafe(`SELECT count(*)::int total FROM vitrina."${sheet}"`);
      const [{ missing }] = await sql.unsafe(
        `SELECT count(*)::int missing FROM vitrina."${sheet}" WHERE "${col}" IS NULL OR "${col}"='(без названия)' OR trim("${col}")=''`);
      console.log(`${sheet.padEnd(22)} всего ${String(total).padStart(5)}  без названия ${missing}`);
    } catch (e) {
      console.log(`${sheet.padEnd(22)} ОШИБКА: ${String(e.message).slice(0, 80)}`);
    }
  }
  // Отдельно — из чего состоит «База» по типам, и где там пусто (места vs объекты)
  console.log('\n--- «База» без названия по типу объекта ---');
  const rows = await sql.unsafe(
    `SELECT "Тип объекта" tip, count(*)::int c FROM vitrina."База"
     WHERE "Название" IS NULL OR "Название"='(без названия)'
     GROUP BY 1 ORDER BY 2 DESC`);
  for (const r of rows) console.log(`  ${String(r.tip).padEnd(18)} ${r.c}`);
} finally { await sql.end({ timeout: 5 }); }
