/** Разово: строки ключевых вьюх витрины + разбивка Базы по типам. */
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  for (const v of ['База', 'На проверку', 'Открытые точки', 'Закрытые точки']) {
    const [{ count }] = await sql.unsafe(`SELECT count(*)::int FROM vitrina."${v}"`);
    console.log(`${v}: ${count}`);
  }
  console.log('\n=== База по типам ===');
  const byType = await sql.unsafe(`SELECT "Тип объекта" t, count(*)::int c FROM vitrina."База" GROUP BY 1 ORDER BY 2 DESC`);
  console.table(byType);
  console.log('=== На проверку: внешние vs реестр ===');
  const chk = await sql.unsafe(`SELECT "Что это" t, count(*)::int c FROM vitrina."На проверку" GROUP BY 1 ORDER BY 2 DESC`);
  console.table(chk);
} finally { await sql.end({ timeout: 5 }); }
