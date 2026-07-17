/**
 * Накатить схему kosmos на Postgres. Идемпотентно: CREATE IF NOT EXISTS.
 */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: 'require', max: 1 });

try {
  const schema = await readFile('db/schema.sql', 'utf8');
  await sql.unsafe(schema);
  console.log('схема применена');

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'kosmos' ORDER BY table_name
  `;
  console.log('таблицы:', tables.map((t) => t.table_name).join(', '));

  const views = await sql`
    SELECT table_name FROM information_schema.views WHERE table_schema = 'kosmos'
  `;
  console.log('виды   :', views.map((v) => v.table_name).join(', ') || '—');
} finally {
  await sql.end();
}
