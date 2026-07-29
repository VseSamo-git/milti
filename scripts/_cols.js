/** Разово: колонки таблицы. Аргумент — имя таблицы в схеме kosmos. */
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
const table = process.argv[2] || 'places';
try {
  const r = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='kosmos' AND table_name=${table} ORDER BY ordinal_position`;
  console.log(`kosmos.${table}:`);
  for (const c of r) console.log(`  ${c.column_name} : ${c.data_type}`);
} finally { await sql.end({ timeout: 5 }); }
