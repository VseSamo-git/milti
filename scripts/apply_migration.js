/**
 * Накатить одну миграцию из db/migrations/. Аргумент — имя файла.
 * Пример: node run.js ./scripts/apply_migration.js 003_places_store_locators.sql
 */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';

const file = process.argv[2];
if (!file) throw new Error('укажите файл миграции, напр. 003_places_store_locators.sql');

const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });

try {
  const text = await readFile(`db/migrations/${file}`, 'utf8');
  await sql.unsafe(text);
  console.log(`миграция ${file} применена`);
} finally {
  await sql.end();
}
