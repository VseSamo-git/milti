import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
const LIST = ['База','На проверку','8 БЦ средние 5-10к','6 ТЦ с супермаркетом','7 Конкуренты','Открытые точки','Закрытые точки'];
try {
  for (const v of LIST) {
    try {
      const [{ count }] = await sql.unsafe(`SELECT count(*)::int FROM vitrina."${v}"`);
      const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='vitrina' AND table_name=${v} ORDER BY ordinal_position`;
      console.log(`\n■ ${v}: ${count} строк`);
      console.log(`   колонки: ${cols.map(c=>c.column_name).join(', ')}`);
    } catch(e){ console.log(`\n■ ${v}: НЕТ вью`); }
  }
} finally { await sql.end({ timeout: 5 }); }
