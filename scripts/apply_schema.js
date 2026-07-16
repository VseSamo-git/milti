/**
 * Применить схему реестра к Postgres.
 *
 * Идемпотентно: всё через CREATE ... IF NOT EXISTS и CREATE OR REPLACE VIEW.
 *
 * Запуск: node scripts/apply_schema.js
 */
import { readFile } from 'node:fs/promises';

import postgres from 'postgres';

import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { onnotice: () => {} });

try {
  const schema = await readFile('db/schema.sql', 'utf8');
  await sql.unsafe(schema);
  console.log('схема применена');

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'kosmos' ORDER BY table_name
  `;
  console.log('таблицы и виды:', tables.map((t) => t.table_name).join(', '));

  // Проверяем, что инвариант провенанса действительно механический,
  // а не декларативный: площадь без источника не должна записаться.
  let constraintWorks = false;
  try {
    await sql`
      INSERT INTO kosmos.objects (cadastral_no, area_sqm)
      VALUES ('00:00:0000000:0', 5000)
    `;
  } catch (error) {
    constraintWorks = /area_needs_source/.test(error.message);
  }

  if (constraintWorks) {
    console.log('проверка: площадь без источника не записывается — ОК');
  } else {
    await sql`DELETE FROM kosmos.objects WHERE cadastral_no = '00:00:0000000:0'`;
    throw new Error(
      'ИНВАРИАНТ ПРОВЕНАНСА НЕ РАБОТАЕТ: площадь без источника записалась. ' +
        'Проверьте CHECK-констрейнты в db/schema.sql — на них держится вся ' +
        'честность реестра.'
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
